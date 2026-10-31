import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { defaultAvatarId } from "@poker-platform/shared/accounts/avatars";
import {
  getEmailDomain,
  getSessionCookieName,
  getSessionCookieOptions,
  isAllowedEmailDomain,
  resolveAllowedEmailDomains,
  SESSION_MAX_AGE_SECONDS,
  shouldUseSecureCookies,
  writeAuditLog,
} from "@poker-platform/shared/auth";
import { prisma } from "@poker-platform/shared/db";
import type { NextAuthOptions, Profile } from "next-auth";
import { createAuthProviders } from "./providers";
import { tryDevRequestOrigin } from "./request";

function hasExplicitlyUnverifiedEmail(profile?: Profile): boolean {
  if (!profile || !("email_verified" in profile)) {
    return false;
  }

  return profile.email_verified === false;
}

const useSecureCookies = shouldUseSecureCookies();

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: createAuthProviders(),
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
    verifyRequest: "/auth/check-email",
  },
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: 24 * 60 * 60,
  },
  // Same cookie name/attributes as client/lib/auth/cookies.ts (password + email-verification logins).
  useSecureCookies,
  cookies: {
    sessionToken: {
      name: getSessionCookieName(useSecureCookies),
      options: getSessionCookieOptions(useSecureCookies),
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    // NextAuth's default, except that in development the origin the request came in on also counts (and is the
    // base for relative URLs), so redirects don't go to NEXTAUTH_URL when that is an offline tunnel.
    async redirect({ url, baseUrl }) {
      const devOrigin = tryDevRequestOrigin();
      const base = devOrigin ?? baseUrl;

      if (url.startsWith("/") && !url.startsWith("//")) {
        return `${base}${url}`;
      }

      try {
        const origin = new URL(url).origin;
        return origin === baseUrl || origin === devOrigin ? url : base;
      } catch {
        return base;
      }
    },
    async signIn({ user, account, profile, email: emailParams }) {
      if (hasExplicitlyUnverifiedEmail(profile)) {
        return false;
      }

      const email = user.email?.trim().toLowerCase();

      if (!email || !isAllowedEmailDomain(email, resolveAllowedEmailDomains())) {
        return false;
      }

      const existing = await prisma.user.findUnique({ where: { email } });

      if (existing && (existing.deletedAt || existing.status !== "ACTIVE")) {
        return false;
      }

      // Email link used (not just requested): if someone registered this email with a password but never
      // verified it, that password wasn't proven to belong to the inbox owner. Drop it.
      if (
        account?.provider === "email" &&
        existing?.passwordHash &&
        !existing.emailVerified &&
        !emailParams?.verificationRequest
      ) {
        await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: null } });
        await writeAuditLog({ userId: existing.id, action: "auth.unverified_password_cleared" });
      }

      return true;
    },
    async session({ session, user }) {
      const record = user as typeof user & {
        username?: string | null;
        displayName?: string | null;
        avatar?: string | null;
        role?: "USER" | "MOD" | "ADMIN";
      };

      if (session.user) {
        session.user.id = user.id;
        session.user.name = record.displayName ?? user.name ?? null;
        session.user.emailDomain = getEmailDomain(user.email);
        session.user.username = record.username ?? null;
        session.user.avatar = record.avatar ?? null;
        session.user.role = record.role ?? "USER";
      }

      return session;
    },
  },
  events: {
    async createUser({ user }) {
      await prisma.user.update({ where: { id: user.id }, data: { avatar: defaultAvatarId(user.id) } }).catch(() => undefined);
    },
    async signIn({ user, account }) {
      await writeAuditLog({
        userId: user.id,
        action: account?.provider === "email" ? "auth.login" : "auth.oauth_signin",
        meta: { method: account?.provider ?? "unknown" },
      });
    },
  },
};
