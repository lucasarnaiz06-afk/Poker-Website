export const NEXTAUTH_SESSION_COOKIE_NAMES = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "authjs.session-token",
  "__Secure-authjs.session-token",
] as const;

export function parseCookieHeader(cookieHeader?: string | null) {
  if (!cookieHeader) {
    return new Map<string, string>();
  }

  return cookieHeader.split(";").reduce((cookies, cookiePart) => {
    const [name, ...valueParts] = cookiePart.trim().split("=");

    if (!name || valueParts.length === 0) {
      return cookies;
    }

    const rawValue = valueParts.join("=");

    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      cookies.set(name, rawValue);
    }

    return cookies;
  }, new Map<string, string>());
}

/**
 * Every session token present in the header, the configured cookie name first. A browser can hold a stale
 * cookie under another name (e.g. after NEXTAUTH_URL switched between http and https), so callers that
 * validate tokens should try each in order rather than trusting the first name that happens to exist.
 */
export function getSessionTokensFromCookieHeader(cookieHeader?: string | null): string[] {
  const cookies = parseCookieHeader(cookieHeader);
  const preferred = getSessionCookieName();
  const names = [preferred, ...NEXTAUTH_SESSION_COOKIE_NAMES.filter((name) => name !== preferred)];
  const tokens: string[] = [];

  for (const cookieName of names) {
    const token = cookies.get(cookieName);

    if (token && !tokens.includes(token)) {
      tokens.push(token);
    }
  }

  return tokens;
}

export function getSessionTokenFromCookieHeader(
  cookieHeader?: string | null,
): string | null {
  return getSessionTokensFromCookieHeader(cookieHeader)[0] ?? null;
}

/** Session lifetime shared by NextAuth (database strategy) and password/verification logins. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Mirrors NextAuth v4: secure cookies (and the `__Secure-` prefix) when NEXTAUTH_URL is https.
 * Edge-safe (used by middleware).
 */
export function shouldUseSecureCookies(nextAuthUrl = process.env.NEXTAUTH_URL): boolean {
  return Boolean(nextAuthUrl?.trim().toLowerCase().startsWith("https://"));
}

export function getSessionCookieName(secure = shouldUseSecureCookies()): string {
  return secure ? "__Secure-next-auth.session-token" : "next-auth.session-token";
}

export function getSessionCookieOptions(secure = shouldUseSecureCookies()) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
  };
}

/** Short-lived cookie that carries the signed "password ok, 2FA pending" state between login steps. */
export const PENDING_TWO_FACTOR_COOKIE = "pp-2fa-pending";
