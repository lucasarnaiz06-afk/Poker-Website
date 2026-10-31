import {
  getSessionCookieName,
  getSessionCookieOptions,
  getSessionTokenFromCookieHeader,
  PENDING_TWO_FACTOR_COOKIE,
  shouldUseSecureCookies,
} from "@poker-platform/shared/auth/cookies";
import { signValue, verifySignedValue } from "@poker-platform/shared/auth";
import { cookies } from "next/headers";

/**
 * The NextAuth session cookie, written by our own logins (password, email verification) with exactly the
 * name and attributes NextAuth v4 uses, so getServerSession() and the socket server both accept it.
 * authOptions.cookies.sessionToken is built from the same helpers.
 */
export const sessionCookie = {
  name: getSessionCookieName(),
  options: getSessionCookieOptions(),
};

export function setSessionCookie(sessionToken: string, expires: Date) {
  cookies().set(sessionCookie.name, sessionToken, { ...sessionCookie.options, expires });
}

export function clearSessionCookie() {
  cookies().set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
}

export function getSessionTokenFromRequestCookies(): string | null {
  const store = cookies();
  return store.get(sessionCookie.name)?.value ?? getSessionTokenFromCookieHeader(store.toString()) ?? null;
}

const pendingOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/auth",
  secure: shouldUseSecureCookies(),
};

export function setPendingTwoFactorCookie(value: string) {
  cookies().set(PENDING_TWO_FACTOR_COOKIE, value, { ...pendingOptions, maxAge: 10 * 60 });
}

export function getPendingTwoFactorCookie() {
  return cookies().get(PENDING_TWO_FACTOR_COOKIE)?.value ?? null;
}

export function clearPendingTwoFactorCookie() {
  cookies().set(PENDING_TWO_FACTOR_COOKIE, "", { ...pendingOptions, maxAge: 0 });
}

/**
 * The address a password sign-up was sent a verification link to, so /auth/check-email can name it and offer
 * "Resend email" without a session. httpOnly, signed (can't be pointed at someone else's address), 1 hour.
 */
const PENDING_VERIFY_COOKIE = "pp-verify-email";
const PENDING_VERIFY_TTL_MS = 60 * 60_000;

export function setPendingVerifyEmailCookie(email: string) {
  const payload = `verify:${Buffer.from(email.trim().toLowerCase(), "utf8").toString("base64url")}`;
  cookies().set(PENDING_VERIFY_COOKIE, signValue(payload, PENDING_VERIFY_TTL_MS), {
    ...pendingOptions,
    maxAge: PENDING_VERIFY_TTL_MS / 1000,
  });
}

export function getPendingVerifyEmail(): string | null {
  const payload = verifySignedValue(cookies().get(PENDING_VERIFY_COOKIE)?.value);

  if (!payload?.startsWith("verify:")) {
    return null;
  }

  const email = Buffer.from(payload.slice("verify:".length), "base64url").toString("utf8");
  return email.includes("@") && email.length <= 254 ? email : null;
}
