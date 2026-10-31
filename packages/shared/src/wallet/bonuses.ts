import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { credit, getChipsOnTables, WalletError, type LedgerWriteResult, type TxClient } from "./wallet-service";

export const SIGNUP_BONUS = 10_000;
export const DAILY_BONUS_BASE = 2_000;
export const DAILY_BONUS_STREAK_STEP = 250;
export const DAILY_BONUS_STREAK_MAX_EXTRA = 1_500;
export const REFILL_TARGET = 2_000;
export const REFILL_THRESHOLD = 200;

/** UTC calendar day "YYYY-MM-DD". */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function previousUtcDayKey(date: Date): string {
  return utcDayKey(new Date(date.getTime() - 24 * 60 * 60 * 1000));
}

export function startOfUtcDay(date: Date): Date {
  return new Date(`${utcDayKey(date)}T00:00:00.000Z`);
}

export function dailyBonusAmount(streak: number): number {
  const extra = Math.min(Math.max(streak - 1, 0) * DAILY_BONUS_STREAK_STEP, DAILY_BONUS_STREAK_MAX_EXTRA);
  return DAILY_BONUS_BASE + extra;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Bonuses go to active, onboarded accounts that aren't in a cool-off or self-exclusion. */
async function assertBonusEligible(tx: TxClient, userId: string, now: Date) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { status: true, deletedAt: true, username: true, responsibleGaming: true },
  });

  if (!user) {
    throw new WalletError("USER_NOT_FOUND", "User not found.");
  }

  if (user.deletedAt || user.status !== "ACTIVE" || !user.username) {
    throw new WalletError("ACCOUNT_RESTRICTED", "This account can't receive bonuses.");
  }

  const limits = user.responsibleGaming;

  if (
    limits &&
    (limits.selfExcludedPermanent ||
      (limits.selfExcludedUntil && limits.selfExcludedUntil > now) ||
      (limits.coolOffUntil && limits.coolOffUntil > now))
  ) {
    throw new WalletError("ACCOUNT_RESTRICTED", "Bonuses are paused during a break or self-exclusion.");
  }
}

/**
 * Signup bonus eligibility: an active, onboarded (username chosen) account with a proven inbox. Password
 * accounts must verify their email; magic-link sign-ins set emailVerified, and OAuth (Google) accounts are
 * verified by the provider (unverified Google emails are refused at sign-in).
 */
export async function isSignupBonusEligible(userId: string, tx: TxClient = prisma): Promise<boolean> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      deletedAt: true,
      username: true,
      emailVerified: true,
      accounts: { where: { type: { in: ["oauth", "oidc"] } }, select: { id: true }, take: 1 },
    },
  });

  return Boolean(
    user &&
      !user.deletedAt &&
      user.status === "ACTIVE" &&
      user.username &&
      (user.emailVerified || user.accounts.length > 0),
  );
}

/**
 * One-time 10,000 chip welcome bonus. Idempotent (refKey `signup:<userId>`), and a no-op returning null
 * until the account is eligible (see isSignupBonusEligible), so callers can invoke it after both email
 * verification and onboarding: the bonus lands exactly once, on whichever happens last.
 */
export async function grantSignupBonus(userId: string): Promise<LedgerWriteResult | null> {
  if (!(await isSignupBonusEligible(userId))) {
    return null;
  }

  return credit({ userId, amount: SIGNUP_BONUS, type: "SIGNUP_BONUS", refKey: `signup:${userId}` });
}

export type DailyBonusStatus = {
  day: string;
  claimedToday: boolean;
  /** Streak after today's claim (if claimed) or the streak a claim now would give. */
  streak: number;
  /** Amount claimed today, or the amount available now. */
  amount: number;
  nextResetAt: Date;
};

export async function getDailyBonusStatus(userId: string, now = new Date()): Promise<DailyBonusStatus> {
  const day = utcDayKey(now);
  const [today, yesterday] = await Promise.all([
    prisma.dailyBonusClaim.findUnique({ where: { userId_day: { userId, day } } }),
    prisma.dailyBonusClaim.findUnique({ where: { userId_day: { userId, day: previousUtcDayKey(now) } } }),
  ]);
  const nextResetAt = new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000);

  if (today) {
    return { day, claimedToday: true, streak: today.streak, amount: today.amount, nextResetAt };
  }

  const streak = (yesterday?.streak ?? 0) + 1;
  return { day, claimedToday: false, streak, amount: dailyBonusAmount(streak), nextResetAt };
}

/**
 * Daily bonus: 2,000 + 250 per consecutive day (max +1,500). One per UTC day; claiming on consecutive
 * days grows the streak, missing a day resets it to 1.
 */
export async function claimDailyBonus(
  userId: string,
  now = new Date(),
): Promise<LedgerWriteResult & { streak: number }> {
  const day = utcDayKey(now);

  try {
    return await prisma.$transaction(async (tx) => {
      await assertBonusEligible(tx, userId, now);

      const yesterday = await tx.dailyBonusClaim.findUnique({
        where: { userId_day: { userId, day: previousUtcDayKey(now) } },
      });
      const streak = (yesterday?.streak ?? 0) + 1;
      const amount = dailyBonusAmount(streak);

      await tx.dailyBonusClaim.create({ data: { userId, day, streak, amount } });
      const result = await credit(
        { userId, amount, type: "DAILY_BONUS", refKey: `daily:${userId}:${day}`, meta: { streak, day } },
        tx,
      );

      return { ...result, streak };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new WalletError("ALREADY_CLAIMED", "You already claimed today's bonus.");
    }

    throw error;
  }
}

export type RefillStatus = {
  eligible: boolean;
  claimedToday: boolean;
  balance: number;
  chipsOnTables: number;
  /** Chips a refill would grant now (0 when not eligible). */
  amount: number;
};

export async function getRefillStatus(userId: string, now = new Date()): Promise<RefillStatus> {
  const [user, chipsOnTables, claimed] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { chipBalance: true } }),
    getChipsOnTables(userId),
    prisma.ledgerEntry.findUnique({ where: { refKey: `refill:${userId}:${utcDayKey(now)}` }, select: { id: true } }),
  ]);
  const balance = user?.chipBalance ?? 0;
  const total = balance + chipsOnTables;
  const eligible = Boolean(user) && !claimed && total < REFILL_THRESHOLD;

  return {
    eligible,
    claimedToday: Boolean(claimed),
    balance,
    chipsOnTables,
    amount: eligible ? REFILL_TARGET - total : 0,
  };
}

/**
 * Once per UTC day, when wallet + chips on tables < 200, tops total holdings back up to 2,000.
 * The user row is locked (FOR UPDATE) so concurrent buy-ins can't race the eligibility check.
 */
export async function claimRefill(userId: string, now = new Date()): Promise<LedgerWriteResult> {
  const refKey = `refill:${userId}:${utcDayKey(now)}`;

  try {
    return await prisma.$transaction(async (tx) => {
      await assertBonusEligible(tx, userId, now);

      const locked = await tx.$queryRaw<Array<{ chipBalance: number }>>`
        SELECT "chipBalance" FROM "User" WHERE "id" = ${userId} FOR UPDATE
      `;
      const balance = Number(locked[0]?.chipBalance ?? 0);
      const existing = await tx.ledgerEntry.findUnique({ where: { refKey }, select: { id: true } });

      if (existing) {
        throw new WalletError("ALREADY_CLAIMED", "You already used today's refill.");
      }

      const total = balance + (await getChipsOnTables(userId, tx));

      if (total >= REFILL_THRESHOLD) {
        throw new WalletError(
          "NOT_ELIGIBLE",
          `Refills are available when you have fewer than ${REFILL_THRESHOLD} chips in total.`,
        );
      }

      return credit(
        { userId, amount: REFILL_TARGET - total, type: "REFILL", refKey, meta: { before: total } },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new WalletError("ALREADY_CLAIMED", "You already used today's refill.");
    }

    throw error;
  }
}
