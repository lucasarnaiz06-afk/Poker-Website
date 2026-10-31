import type { ResponsibleGamingLimits } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { writeAuditLog } from "../auth/audit";
import { startOfUtcDay } from "../wallet/bonuses";
import { DAY_MS, fail, zodFailure, type ActionResult, type RequestContext } from "./common";

/**
 * Responsible-gaming tools. Tightening a limit applies immediately; loosening or removing the daily
 * loss limit only applies after 24 hours. Cool-off and self-exclusion cannot be undone early.
 */

export const LIMIT_LOOSEN_DELAY_MS = DAY_MS;
export const COOL_OFF_DURATIONS = { "24h": DAY_MS, "7d": 7 * DAY_MS } as const;
export const SELF_EXCLUSION_DURATIONS = { "30d": 30 * DAY_MS, "90d": 90 * DAY_MS, permanent: null } as const;
export type CoolOffDuration = keyof typeof COOL_OFF_DURATIONS;
export type SelfExclusionDuration = keyof typeof SELF_EXCLUSION_DURATIONS;

export type EffectiveLimits = {
  dailyLossLimit: number | null;
  pendingDailyLossLimit: { value: number | null; effectiveAt: Date } | null;
  sessionReminderMinutes: number | null;
  coolOffUntil: Date | null;
  selfExcludedUntil: Date | null;
  selfExcludedPermanent: boolean;
};

function effectiveLimits(row: ResponsibleGamingLimits | null, now: Date): EffectiveLimits {
  if (!row) {
    return {
      dailyLossLimit: null,
      pendingDailyLossLimit: null,
      sessionReminderMinutes: null,
      coolOffUntil: null,
      selfExcludedUntil: null,
      selfExcludedPermanent: false,
    };
  }

  const pendingDue = row.pendingDailyLossLimitAt && row.pendingDailyLossLimitAt <= now;

  return {
    dailyLossLimit: pendingDue ? row.pendingDailyLossLimit : row.dailyLossLimit,
    pendingDailyLossLimit:
      row.pendingDailyLossLimitAt && !pendingDue
        ? { value: row.pendingDailyLossLimit, effectiveAt: row.pendingDailyLossLimitAt }
        : null,
    sessionReminderMinutes: row.sessionReminderMinutes,
    coolOffUntil: row.coolOffUntil && row.coolOffUntil > now ? row.coolOffUntil : null,
    selfExcludedUntil: row.selfExcludedUntil && row.selfExcludedUntil > now ? row.selfExcludedUntil : null,
    selfExcludedPermanent: row.selfExcludedPermanent,
  };
}

export async function getResponsibleGamingLimits(userId: string, now = new Date()): Promise<EffectiveLimits> {
  const row = await prisma.responsibleGamingLimits.findUnique({ where: { userId } });
  return effectiveLimits(row, now);
}

/** Net chips won/lost today (UTC) from completed hands. Negative = loss. */
export async function getTodayNet(userId: string, now = new Date()): Promise<number> {
  const result = await prisma.handPlayer.aggregate({
    where: { userId, createdAt: { gte: startOfUtcDay(now) } },
    _sum: { net: true },
  });

  return result._sum.net ?? 0;
}

const limitsUpdateSchema = z
  .object({
    dailyLossLimit: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
    sessionReminderMinutes: z.number().int().min(10).max(24 * 60).nullable().optional(),
  })
  .strict();

export async function updateResponsibleGamingLimits(
  userId: string,
  raw: unknown,
  ctx: RequestContext,
  now = new Date(),
): Promise<ActionResult<{ limits: EffectiveLimits; delayed: boolean }>> {
  const parsed = limitsUpdateSchema.safeParse(raw);

  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  const existing = await prisma.responsibleGamingLimits.findUnique({ where: { userId } });
  const current = effectiveLimits(existing, now);
  const data: Partial<ResponsibleGamingLimits> = {};
  let delayed = false;

  // Fold a pending change that has come due into the stored value.
  if (existing?.pendingDailyLossLimitAt && existing.pendingDailyLossLimitAt <= now) {
    data.dailyLossLimit = existing.pendingDailyLossLimit;
    data.pendingDailyLossLimit = null;
    data.pendingDailyLossLimitAt = null;
  }

  if (parsed.data.dailyLossLimit !== undefined) {
    const next = parsed.data.dailyLossLimit;
    const isTighter = next !== null && (current.dailyLossLimit === null || next <= current.dailyLossLimit);

    if (isTighter) {
      data.dailyLossLimit = next;
      data.pendingDailyLossLimit = null;
      data.pendingDailyLossLimitAt = null;
    } else if (next !== current.dailyLossLimit) {
      data.pendingDailyLossLimit = next;
      data.pendingDailyLossLimitAt = new Date(now.getTime() + LIMIT_LOOSEN_DELAY_MS);
      delayed = true;
    }
  }

  if (parsed.data.sessionReminderMinutes !== undefined) {
    data.sessionReminderMinutes = parsed.data.sessionReminderMinutes;
  }

  const row = await prisma.responsibleGamingLimits.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  await writeAuditLog({ userId, action: "account.limits_updated", ip: ctx.ip, meta: { ...parsed.data, delayed } });
  return { ok: true, limits: effectiveLimits(row, now), delayed };
}

export async function startCoolOff(
  userId: string,
  duration: CoolOffDuration,
  ctx: RequestContext,
  now = new Date(),
): Promise<ActionResult<{ until: Date }>> {
  if (typeof duration !== "string" || !Object.hasOwn(COOL_OFF_DURATIONS, duration)) {
    return fail("Choose a cool-off length.", "INVALID_INPUT");
  }

  const existing = await prisma.responsibleGamingLimits.findUnique({ where: { userId } });
  const proposed = new Date(now.getTime() + COOL_OFF_DURATIONS[duration]);
  // Never shorten an active break.
  const until = existing?.coolOffUntil && existing.coolOffUntil > proposed ? existing.coolOffUntil : proposed;

  await prisma.responsibleGamingLimits.upsert({
    where: { userId },
    create: { userId, coolOffUntil: until },
    update: { coolOffUntil: until },
  });
  await writeAuditLog({ userId, action: "account.cool_off", ip: ctx.ip, meta: { duration, until: until.toISOString() } });
  return { ok: true, until };
}

export async function selfExclude(
  userId: string,
  duration: SelfExclusionDuration,
  ctx: RequestContext,
  now = new Date(),
): Promise<ActionResult<{ until: Date | null }>> {
  if (typeof duration !== "string" || !Object.hasOwn(SELF_EXCLUSION_DURATIONS, duration)) {
    return fail("Choose a self-exclusion length.", "INVALID_INPUT");
  }

  const existing = await prisma.responsibleGamingLimits.findUnique({ where: { userId } });
  const ms = SELF_EXCLUSION_DURATIONS[duration];
  const permanent = ms === null || Boolean(existing?.selfExcludedPermanent);
  const proposed = ms === null ? null : new Date(now.getTime() + ms);
  const until =
    permanent ? null : existing?.selfExcludedUntil && proposed && existing.selfExcludedUntil > proposed ? existing.selfExcludedUntil : proposed;

  await prisma.responsibleGamingLimits.upsert({
    where: { userId },
    create: { userId, selfExcludedUntil: until, selfExcludedPermanent: permanent },
    update: { selfExcludedUntil: until, selfExcludedPermanent: permanent },
  });
  await writeAuditLog({
    userId,
    action: "account.self_excluded",
    ip: ctx.ip,
    meta: { duration, until: until?.toISOString() ?? null, permanent },
  });
  return { ok: true, until };
}

// ---------------------------------------------------------------------------
// Runtime gate
// ---------------------------------------------------------------------------

export type PlayRestrictionCode =
  | "USER_NOT_FOUND"
  | "ACCOUNT_DELETED"
  | "ACCOUNT_SUSPENDED"
  | "ACCOUNT_BANNED"
  | "ONBOARDING_REQUIRED"
  | "SELF_EXCLUDED"
  | "COOL_OFF"
  | "DAILY_LOSS_LIMIT";

export class PlayRestrictedError extends Error {
  constructor(
    public readonly code: PlayRestrictionCode,
    message: string,
    /** When the restriction ends, if known. */
    public readonly until: Date | null = null,
  ) {
    super(message);
    this.name = "PlayRestrictedError";
  }
}

export type CanPlayResult =
  | { ok: true; sessionReminderMinutes: number | null; dailyLossRemaining: number | null }
  | { ok: false; code: PlayRestrictionCode; message: string; until: Date | null };

/** Non-throwing version of assertCanPlay (for UI). */
export async function checkCanPlay(userId: string, now = new Date()): Promise<CanPlayResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, deletedAt: true, username: true, responsibleGaming: true },
  });

  if (!user) {
    return { ok: false, code: "USER_NOT_FOUND", message: "Account not found.", until: null };
  }

  if (user.deletedAt) {
    return { ok: false, code: "ACCOUNT_DELETED", message: "This account was deleted.", until: null };
  }

  if (user.status === "BANNED") {
    return { ok: false, code: "ACCOUNT_BANNED", message: "This account is banned.", until: null };
  }

  if (user.status === "SUSPENDED") {
    return { ok: false, code: "ACCOUNT_SUSPENDED", message: "This account is suspended.", until: null };
  }

  if (!user.username) {
    return { ok: false, code: "ONBOARDING_REQUIRED", message: "Choose a username first.", until: null };
  }

  const limits = effectiveLimits(user.responsibleGaming, now);

  if (limits.selfExcludedPermanent || limits.selfExcludedUntil) {
    return {
      ok: false,
      code: "SELF_EXCLUDED",
      message: limits.selfExcludedPermanent
        ? "You have permanently self-excluded from play."
        : `You are self-excluded until ${limits.selfExcludedUntil!.toISOString()}.`,
      until: limits.selfExcludedUntil,
    };
  }

  if (limits.coolOffUntil) {
    return {
      ok: false,
      code: "COOL_OFF",
      message: `You're on a break until ${limits.coolOffUntil.toISOString()}.`,
      until: limits.coolOffUntil,
    };
  }

  let dailyLossRemaining: number | null = null;

  if (limits.dailyLossLimit !== null) {
    const lossToday = Math.max(0, -(await getTodayNet(userId, now)));
    dailyLossRemaining = Math.max(0, limits.dailyLossLimit - lossToday);

    if (dailyLossRemaining === 0) {
      const tomorrow = new Date(startOfUtcDay(now).getTime() + DAY_MS);
      return {
        ok: false,
        code: "DAILY_LOSS_LIMIT",
        message: "You've reached your daily loss limit. It resets at 00:00 UTC.",
        until: tomorrow,
      };
    }
  }

  return { ok: true, sessionReminderMinutes: limits.sessionReminderMinutes, dailyLossRemaining };
}

/**
 * Runtime gate: call before seating / buying in / dealing a user into a hand.
 * Throws PlayRestrictedError (with a user-facing message) when the user must not play.
 */
export async function assertCanPlay(userId: string, now = new Date()): Promise<void> {
  const result = await checkCanPlay(userId, now);

  if (!result.ok) {
    throw new PlayRestrictedError(result.code, result.message, result.until);
  }
}
