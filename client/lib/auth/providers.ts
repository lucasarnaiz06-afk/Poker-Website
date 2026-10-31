import {
  AUTH_RATE_LIMITS,
  buildLinkEmail,
  checkRateLimit,
  isEmailDeliveryConfigured,
  rateLimitKey,
  recordRateLimitAttempt,
  sendMail,
} from "@poker-platform/shared/auth";
import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import { tryDevRequestOrigin } from "./request";

/**
 * Development only: NextAuth builds magic links from NEXTAUTH_URL, which may be an offline tunnel. Point the
 * link (and its callbackUrl) at the origin the request came in on instead. Production links are unchanged.
 */
export function devLinkForRequestOrigin(url: string, requestOrigin: string | null): string {
  if (!requestOrigin) {
    return url;
  }

  try {
    const link = new URL(url);
    const configuredOrigin = link.origin;
    const rewritten = new URL(`${link.pathname}${link.search}${link.hash}`, requestOrigin);
    const callback = rewritten.searchParams.get("callbackUrl");

    if (callback?.startsWith(configuredOrigin)) {
      rewritten.searchParams.set("callbackUrl", `${requestOrigin}${callback.slice(configuredOrigin.length)}`);
    }

    return rewritten.toString();
  } catch {
    return url;
  }
}


export type EnabledAuthProviders = {
  /** Magic link. Always available in development (links are printed to the console). */
  email: boolean;
  google: boolean;
  password: true;
};

export function getEnabledAuthProviders(): EnabledAuthProviders {
  return {
    email: isEmailDeliveryConfigured(),
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    password: true,
  };
}

export function createAuthProviders(): NextAuthOptions["providers"] {
  const enabled = getEnabledAuthProviders();
  const providers: NextAuthOptions["providers"] = [];

  if (enabled.email) {
    providers.push(
      EmailProvider({
        // Delivery goes through our mailer (console in dev, SMTP in production); `server` is unused.
        server: {},
        from: process.env.EMAIL_FROM ?? "Poker Platform <noreply@localhost>",
        maxAge: 30 * 60,
        async sendVerificationRequest({ identifier, url }) {
          // Stop email bombing: a few links per address per hour (NextAuth reports a generic EmailSignin error).
          const key = rateLimitKey("emailSend", "acct", `magic:${identifier}`);

          if (!(await checkRateLimit(key)).allowed) {
            throw new Error("Too many sign-in emails requested for this address.");
          }

          await recordRateLimitAttempt(key, AUTH_RATE_LIMITS.emailSend);
          await sendMail(
            buildLinkEmail({
              to: identifier,
              subject: "Your sign-in link",
              intro: "Click the button to sign in to Poker Platform. The link expires in 30 minutes and works once.",
              actionLabel: "Sign in",
              url: devLinkForRequestOrigin(url, tryDevRequestOrigin()),
            }),
          );
        },
      }),
    );
  }

  if (enabled.google) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      }),
    );
  }

  return providers;
}
