import { safeHttpOrigin, type RequestContext } from "@poker-platform/shared/accounts";
import { headers } from "next/headers";

/**
 * Client IP for rate limiting / audit hashing, or null when it can't be known.
 *
 * Next route handlers and server actions can't see the socket peer address, and Next only fills in
 * X-Forwarded-For when the request didn't carry one, so with no proxy in front every forwarding header
 * (X-Forwarded-For, X-Real-IP) is client-controlled. Hence:
 * - TRUSTED_PROXY_COUNT=0 (default): ignore forwarding headers and return null. Per-IP limits are then
 *   skipped (see ipRateLimitKeys) and the per-account / per-email / site-wide limits apply.
 * - TRUSTED_PROXY_COUNT=N: each trusted proxy appends the address it saw, so the client is the Nth entry
 *   from the right; anything further left was supplied by the client. A shorter chain means the proxy
 *   setup doesn't match the config, so we return null rather than trust a forged entry.
 */
export function getClientIp(headerList: Pick<Headers, "get"> = headers()): string | null {
  const trusted = Math.max(0, Number.parseInt(process.env.TRUSTED_PROXY_COUNT ?? "0", 10) || 0);

  if (trusted === 0) {
    return null;
  }

  const forwarded = (headerList.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (forwarded.length < trusted) {
    return null;
  }

  return forwarded[forwarded.length - trusted]?.slice(0, 64) || null;
}

/**
 * Development only: the origin the browser used (Origin header, else Host), so links in dev emails point at
 * the server you're actually on. Always null in production (links come from NEXTAUTH_URL there).
 */
export function getDevRequestOrigin(headerList: Pick<Headers, "get"> = headers()): string | null {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const origin = safeHttpOrigin(headerList.get("origin"));

  if (origin) {
    return origin;
  }

  const host = headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") === "https" ? "https" : "http";
  return host ? safeHttpOrigin(`${proto}://${host}`) : null;
}

/** getDevRequestOrigin() that returns null outside a request scope (where headers() throws). */
export function tryDevRequestOrigin(): string | null {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  try {
    return getDevRequestOrigin();
  } catch {
    return null;
  }
}

export function getRequestContext(): RequestContext {
  const headerList = headers();

  return {
    ip: getClientIp(headerList),
    userAgent: headerList.get("user-agent")?.slice(0, 300) ?? null,
    appOrigin: getDevRequestOrigin(headerList),
  };
}

/** Allowed origins for state-changing route handlers (server actions are origin-checked by Next). */
function allowedOrigins(): string[] {
  return [process.env.NEXTAUTH_URL, process.env.CLIENT_ORIGIN, ...(process.env.CLIENT_ORIGINS ?? "").split(",")]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value));
}

/**
 * CSRF guard for route handlers: the Origin (or Sec-Fetch-Site) must show a same-origin request.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = request.headers.get("origin");

  if (!origin) {
    // Browsers always send Origin on cross-site POSTs; a missing Origin with no cross-site signal is a
    // same-origin GET/navigation.
    return request.method === "GET" || request.method === "HEAD" || fetchSite === "same-origin";
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const allowed = new Set(allowedOrigins());

  try {
    const originUrl = new URL(origin);
    return allowed.has(originUrl.origin) || (host !== null && originUrl.host === host);
  } catch {
    return false;
  }
}
