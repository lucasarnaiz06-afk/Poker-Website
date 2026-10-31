import { prisma } from "../db/prisma";
import { hmacDigest } from "./crypto";

/**
 * DB-backed rate limiting for auth endpoints (works across processes, survives restarts).
 *
 * Each key counts attempts in a fixed window. After `freeAttempts` the key is locked with exponential
 * backoff: baseLockMs * 2^(n-1), capped at maxLockMs. Successful logins clear the per-account key.
 */
export type RateLimitPolicy = {
  windowMs: number;
  freeAttempts: number;
  baseLockMs: number;
  maxLockMs: number;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const AUTH_RATE_LIMITS = {
  loginIp: { windowMs: 15 * MINUTE, freeAttempts: 20, baseLockMs: 30_000, maxLockMs: HOUR },
  loginAccount: { windowMs: HOUR, freeAttempts: 5, baseLockMs: 30_000, maxLockMs: HOUR },
  twoFactor: { windowMs: 15 * MINUTE, freeAttempts: 5, baseLockMs: 30_000, maxLockMs: HOUR },
  registerIp: { windowMs: HOUR, freeAttempts: 5, baseLockMs: 5 * MINUTE, maxLockMs: 6 * HOUR },
  /**
   * Per normalized email address, whatever IP the attempts come from. The attempt that exceeds
   * freeAttempts still runs and sets the lock, so this allows 3 sign-ups per address per hour.
   */
  registerEmail: { windowMs: HOUR, freeAttempts: 2, baseLockMs: 10 * MINUTE, maxLockMs: 6 * HOUR },
  /** Site-wide sign-up ceiling (20/minute); see registrationGlobalPolicy for the env override. */
  registerGlobal: { windowMs: MINUTE, freeAttempts: 19, baseLockMs: MINUTE, maxLockMs: 15 * MINUTE },
  resetIp: { windowMs: HOUR, freeAttempts: 5, baseLockMs: 5 * MINUTE, maxLockMs: 6 * HOUR },
  resetAccount: { windowMs: HOUR, freeAttempts: 3, baseLockMs: 10 * MINUTE, maxLockMs: 6 * HOUR },
  emailSend: { windowMs: HOUR, freeAttempts: 3, baseLockMs: 10 * MINUTE, maxLockMs: 6 * HOUR },
  sensitiveAction: { windowMs: 15 * MINUTE, freeAttempts: 5, baseLockMs: 60_000, maxLockMs: HOUR },
} satisfies Record<string, RateLimitPolicy>;

export type RateLimitScope = keyof typeof AUTH_RATE_LIMITS;

/** Builds a key that never contains raw identifiers (emails/usernames/IPs are HMAC-ed). */
export function rateLimitKey(scope: RateLimitScope, kind: "ip" | "acct", value: string | null | undefined) {
  const normalized = (value ?? "unknown").trim().toLowerCase();
  return `${scope}:${kind}:${hmacDigest("rate-limit", normalized).slice(0, 32)}`;
}

/**
 * Per-IP key, or none when the client IP is unknown. getClientIp() returns null unless trusted proxies are
 * configured (forwarding headers are client-controlled otherwise); sharing one "unknown" bucket would turn
 * every per-IP limit into a site-wide lockout anyone could trigger, so we skip IP limits and rely on the
 * per-account / per-email / global limits instead.
 */
export function ipRateLimitKeys(scope: RateLimitScope, ip: string | null | undefined): string[] {
  return ip?.trim() ? [rateLimitKey(scope, "ip", ip)] : [];
}

/** Site-wide registration policy, `REGISTRATION_RATE_LIMIT_PER_MINUTE` sign-ups per minute (default 20). */
export function registrationGlobalPolicy(env: NodeJS.ProcessEnv = process.env): RateLimitPolicy {
  const configured = Number.parseInt(env.REGISTRATION_RATE_LIMIT_PER_MINUTE ?? "", 10);
  const base = AUTH_RATE_LIMITS.registerGlobal;

  // The attempt that crosses freeAttempts is still allowed (it sets the lock), hence the -1.
  return Number.isInteger(configured) && configured > 0 ? { ...base, freeAttempts: configured - 1 } : base;
}

export const REGISTRATION_GLOBAL_KEY = "registerGlobal:global:all";

export type RateLimitStatus = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export async function checkRateLimit(key: string, now = new Date()): Promise<RateLimitStatus> {
  const row = await prisma.authRateLimit.findUnique({ where: { key } });

  if (row?.lockedUntil && row.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000)),
    };
  }

  return { allowed: true };
}

export async function checkRateLimits(keys: string[], now = new Date()): Promise<RateLimitStatus> {
  let worst: RateLimitStatus = { allowed: true };

  for (const key of keys) {
    const status = await checkRateLimit(key, now);

    if (!status.allowed && (worst.allowed || status.retryAfterSeconds > worst.retryAfterSeconds)) {
      worst = status;
    }
  }

  return worst;
}

/** Records one attempt (atomic upsert) and applies a lockout when the free attempts are used up. */
export async function recordRateLimitAttempt(
  key: string,
  policy: RateLimitPolicy,
  now = new Date(),
): Promise<{ count: number; lockedUntil: Date | null }> {
  const windowStartCutoff = new Date(now.getTime() - policy.windowMs);
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "AuthRateLimit" ("key", "count", "windowStart", "updatedAt")
    VALUES (${key}, 1, ${now}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "AuthRateLimit"."windowStart" < ${windowStartCutoff}
          AND ("AuthRateLimit"."lockedUntil" IS NULL OR "AuthRateLimit"."lockedUntil" < ${now})
        THEN 1 ELSE "AuthRateLimit"."count" + 1 END,
      "windowStart" = CASE
        WHEN "AuthRateLimit"."windowStart" < ${windowStartCutoff}
          AND ("AuthRateLimit"."lockedUntil" IS NULL OR "AuthRateLimit"."lockedUntil" < ${now})
        THEN ${now} ELSE "AuthRateLimit"."windowStart" END,
      "updatedAt" = ${now}
    RETURNING "count"
  `;
  const count = Number(rows[0]?.count ?? 1);
  let lockedUntil: Date | null = null;

  if (count > policy.freeAttempts) {
    const exponent = Math.min(count - policy.freeAttempts - 1, 20);
    const lockMs = Math.min(policy.baseLockMs * 2 ** exponent, policy.maxLockMs);
    lockedUntil = new Date(now.getTime() + lockMs);
    await prisma.authRateLimit.update({ where: { key }, data: { lockedUntil } });
  }

  if (Math.random() < 0.01) {
    void pruneRateLimits(now).catch(() => undefined);
  }

  return { count, lockedUntil };
}

export async function clearRateLimit(key: string) {
  await prisma.authRateLimit.deleteMany({ where: { key } });
}

export async function pruneRateLimits(now = new Date()) {
  await prisma.authRateLimit.deleteMany({
    where: {
      updatedAt: { lt: new Date(now.getTime() - 24 * HOUR) },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
  });
}

export function formatRetryAfter(seconds: number) {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
