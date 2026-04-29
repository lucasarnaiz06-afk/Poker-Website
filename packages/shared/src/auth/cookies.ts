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

export function getSessionTokenFromCookieHeader(
  cookieHeader?: string | null,
): string | null {
  const cookies = parseCookieHeader(cookieHeader);

  for (const cookieName of NEXTAUTH_SESSION_COOKIE_NAMES) {
    const token = cookies.get(cookieName);

    if (token) {
      return token;
    }
  }

  return null;
}
