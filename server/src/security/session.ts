import {
  getAuthenticatedSessionFromCookieHeader,
  type AuthenticatedSession,
} from "@poker-platform/shared/auth";

export async function authenticateCookieHeader(
  cookieHeader?: string | string[] | null,
): Promise<AuthenticatedSession | null> {
  const normalizedCookieHeader = Array.isArray(cookieHeader)
    ? cookieHeader.join("; ")
    : cookieHeader;

  return getAuthenticatedSessionFromCookieHeader(normalizedCookieHeader);
}
