import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Command center (operator console) sessions.
 *
 * After a correct COMMAND_CENTER_PASSWORD the browser gets a signed, expiring token:
 *   v1.<issuedAtMs>.<32 random bytes, base64url>.<HMAC-SHA256>
 * The MAC is keyed with NEXTAUTH_SECRET and also covers a hash of the current password, so rotating either
 * one invalidates every outstanding session. Without NEXTAUTH_SECRET the command center stays disabled
 * (no hard-coded fallback key). Logout additionally revokes the token's nonce in this process.
 *
 * The cookie is httpOnly, SameSite=Strict, Secure in production, and only sent to /command (page, login,
 * logout) and /api/command (data routes) — under two names, since one cookie can only carry one path.
 */
const PAGE_COOKIE = { name: "cc-session", path: "/command" } as const;
const API_COOKIE = { name: "cc-api-session", path: "/api/command" } as const;
const LEGACY_COOKIE = { name: "command-center-session", path: "/" } as const;

export const COMMAND_CENTER_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const TOKEN_VERSION = "v1";
/** Tolerated clock skew for tokens "issued in the future". */
const MAX_FUTURE_SKEW_MS = 60_000;

function getCommandCenterPassword() {
  return process.env.COMMAND_CENTER_PASSWORD?.trim() ?? "";
}

function getCommandCenterSecret(): string | null {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  return secret ? secret : null;
}

function safeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();

  return timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}

function sign(secret: string, password: string, issuedAt: string, nonce: string) {
  const passwordTag = createHash("sha256").update(`command-center-password:${password}`, "utf8").digest("base64url");

  return createHmac("sha256", secret)
    .update(`command-center-session:${TOKEN_VERSION}:${issuedAt}:${nonce}:${passwordTag}`, "utf8")
    .digest("base64url");
}

/** Nonces revoked by logout (process-local, kept until the token would have expired anyway). */
const revoked: Map<string, number> = ((globalThis as { __commandCenterRevoked?: Map<string, number> })
  .__commandCenterRevoked ??= new Map());

function pruneRevoked(now: number) {
  for (const [nonce, expiresAt] of revoked) {
    if (expiresAt <= now) {
      revoked.delete(nonce);
    }
  }
}

type VerifiedToken = { nonce: string; expiresAt: number };

/** Exported for tests. Returns the token's nonce/expiry when it is authentic, current and not revoked. */
export function verifyCommandCenterToken(
  token: string | undefined | null,
  options: { secret?: string | null; password?: string; now?: number } = {},
): VerifiedToken | null {
  const secret = options.secret === undefined ? getCommandCenterSecret() : options.secret;
  const password = options.password ?? getCommandCenterPassword();
  const now = options.now ?? Date.now();

  if (!secret || !password || typeof token !== "string" || token.length > 200) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) {
    return null;
  }

  const [, issuedAtRaw, nonce, mac] = parts as [string, string, string, string];

  if (!/^\d{1,15}$/.test(issuedAtRaw) || !/^[A-Za-z0-9_-]{43}$/.test(nonce) || !safeEqual(mac, sign(secret, password, issuedAtRaw, nonce))) {
    return null;
  }

  const issuedAt = Number(issuedAtRaw);
  const expiresAt = issuedAt + COMMAND_CENTER_SESSION_TTL_MS;

  if (issuedAt > now + MAX_FUTURE_SKEW_MS || expiresAt <= now || revoked.has(nonce)) {
    return null;
  }

  return { nonce, expiresAt };
}

/** Exported for tests. */
export function createCommandCenterToken(
  options: { secret?: string | null; password?: string; now?: number } = {},
): string | null {
  const secret = options.secret === undefined ? getCommandCenterSecret() : options.secret;
  const password = options.password ?? getCommandCenterPassword();

  if (!secret || !password) {
    return null;
  }

  const issuedAt = String(options.now ?? Date.now());
  const nonce = randomBytes(32).toString("base64url");

  return `${TOKEN_VERSION}.${issuedAt}.${nonce}.${sign(secret, password, issuedAt, nonce)}`;
}

let warnedMissingSecret = false;

export function isCommandCenterEnabled() {
  if (!getCommandCenterPassword()) {
    return false;
  }

  if (!getCommandCenterSecret()) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.error("Command center disabled: NEXTAUTH_SECRET must be set to sign command center sessions.");
    }
    return false;
  }

  return true;
}

function readSessionToken() {
  const jar = cookies();
  return jar.get(API_COOKIE.name)?.value ?? jar.get(PAGE_COOKIE.name)?.value ?? null;
}

export function hasCommandCenterSession() {
  return isCommandCenterEnabled() && verifyCommandCenterToken(readSessionToken()) !== null;
}

export function isValidCommandCenterPassword(candidate: string) {
  const password = getCommandCenterPassword();

  if (!password) {
    return false;
  }

  return safeEqual(candidate.trim(), password);
}

function cookieAttributes(path: string) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path,
  };
}

export function setCommandCenterSessionCookie() {
  if (!isCommandCenterEnabled()) {
    return;
  }

  const token = createCommandCenterToken();

  if (!token) {
    return;
  }

  const jar = cookies();
  const maxAge = Math.floor(COMMAND_CENTER_SESSION_TTL_MS / 1000);

  for (const cookie of [PAGE_COOKIE, API_COOKIE]) {
    jar.set({ name: cookie.name, value: token, maxAge, ...cookieAttributes(cookie.path) });
  }
  // Drop the pre-v1 static cookie if the browser still has it.
  jar.set({ name: LEGACY_COOKIE.name, value: "", expires: new Date(0), ...cookieAttributes(LEGACY_COOKIE.path) });
}

export function clearCommandCenterSessionCookie() {
  const now = Date.now();
  const verified = verifyCommandCenterToken(readSessionToken(), { now });

  if (verified) {
    pruneRevoked(now);
    revoked.set(verified.nonce, verified.expiresAt);
  }

  const jar = cookies();

  for (const cookie of [PAGE_COOKIE, API_COOKIE, LEGACY_COOKIE]) {
    jar.set({ name: cookie.name, value: "", expires: new Date(0), ...cookieAttributes(cookie.path) });
  }
}

// ---------------------------------------------------------------------------
// Login throttling (the password is checked here, not by the game server's /admin lockout)
// ---------------------------------------------------------------------------

const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURES_PER_CLIENT = 10;
/** Site-wide ceiling so rotating client IPs can't brute force the password. */
const LOGIN_FAILURES_GLOBAL = 30;

const loginFailures: Map<string, number[]> = ((globalThis as { __commandCenterLoginFailures?: Map<string, number[]> })
  .__commandCenterLoginFailures ??= new Map());

function recentFailures(key: string, now: number) {
  const recent = (loginFailures.get(key) ?? []).filter((at) => now - at < LOGIN_FAILURE_WINDOW_MS);
  loginFailures.set(key, recent);
  return recent;
}

/** `clientIp` is getClientIp() (null without trusted proxies: then only the global ceiling applies). */
export function isCommandCenterLoginLocked(clientIp: string | null, now = Date.now()) {
  return (
    recentFailures("*", now).length >= LOGIN_FAILURES_GLOBAL ||
    (clientIp !== null && recentFailures(`ip:${clientIp}`, now).length >= LOGIN_FAILURES_PER_CLIENT)
  );
}

export function recordCommandCenterLoginFailure(clientIp: string | null, now = Date.now()) {
  if (loginFailures.size > 10_000) {
    for (const key of loginFailures.keys()) {
      if (key !== "*" && recentFailures(key, now).length === 0) loginFailures.delete(key);
    }
  }

  recentFailures("*", now).push(now);

  if (clientIp !== null) {
    recentFailures(`ip:${clientIp}`, now).push(now);
  }
}
