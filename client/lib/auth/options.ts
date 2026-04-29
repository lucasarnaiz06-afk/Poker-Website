import { PrismaAdapter } from "@next-auth/prisma-adapter";
import {
  getEmailDomain,
  isAllowedEmailDomain,
  prisma,
  resolveAllowedEmailDomains,
} from "@poker-platform/shared";
import type { NextAuthOptions, Profile } from "next-auth";
import { createAuthProviders } from "./providers";

function hasExplicitlyUnverifiedEmail(profile?: Profile): boolean {
  if (!profile || !("email_verified" in profile)) {
    return false;
  }

  return profile.email_verified === false;
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: createAuthProviders(),
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ user, profile }) {
      if (hasExplicitlyUnverifiedEmail(profile)) {
        return false;
      }

      const allowedEmailDomains = resolveAllowedEmailDomains();

      return isAllowedEmailDomain(user.email, allowedEmailDomains);
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.emailDomain = getEmailDomain(user.email);
      }

      return session;
    },
  },
};
