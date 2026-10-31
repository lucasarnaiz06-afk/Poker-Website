import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { writeAuditLog } from "../auth/audit";
import { verifyUserPassword } from "../auth/passwords";
import { AUTH_RATE_LIMITS, checkRateLimits, formatRetryAfter, rateLimitKey, recordRateLimitAttempt } from "../auth/rate-limit";
import { defaultAvatarId } from "./avatars";
import { fail, type ActionResult, type RequestContext } from "./common";
import { parsePreferences } from "./preferences";

/** Everything we hold about the user, without secrets (password hash, TOTP secret, tokens). */
export async function exportUserData(userId: string, ctx: RequestContext) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      accounts: { select: { provider: true, type: true } },
      sessions: { select: { id: true, createdAt: true, expires: true, userAgent: true } },
      ledgerEntries: { orderBy: { createdAt: "asc" } },
      dailyBonusClaims: { orderBy: { day: "asc" } },
      responsibleGaming: true,
      notesWritten: { select: { subjectId: true, text: true, color: true, updatedAt: true } },
      lobbySeats: { select: { lobbyId: true, seatNumber: true, chipStack: true, status: true, joinedAt: true, leftAt: true } },
      auditLogs: { select: { action: true, createdAt: true, meta: true }, orderBy: { createdAt: "asc" }, take: 5000 },
    },
  });

  if (!user || user.deletedAt) {
    return null;
  }

  const hands = await prisma.handPlayer.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      hand: { select: { lobbyId: true, handNumber: true, variant: true, smallBlind: true, bigBlind: true, startedAt: true, endedAt: true, boards: true } },
    },
  });

  await writeAuditLog({ userId, action: "account.data_exported", ip: ctx.ip });

  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      role: user.role,
      status: user.status,
      chipBalance: user.chipBalance,
      hasPassword: Boolean(user.passwordHash),
      totpEnabled: user.totpEnabled,
      preferences: parsePreferences(user.preferences),
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
      usernameChangedAt: user.usernameChangedAt,
    },
    linkedAccounts: user.accounts,
    sessions: user.sessions,
    responsibleGaming: user.responsibleGaming,
    ledger: user.ledgerEntries,
    dailyBonusClaims: user.dailyBonusClaims,
    tableSeats: user.lobbySeats,
    hands: hands.map((row) => ({
      ...row.hand,
      seat: row.seat,
      position: row.position,
      startingStack: row.startingStack,
      endingStack: row.endingStack,
      net: row.net,
      holeCards: row.holeCards,
      shown: row.shown,
      createdAt: row.createdAt,
    })),
    notes: user.notesWritten,
    securityLog: user.auditLogs,
  };
}

const deleteSchema = z
  .object({
    confirmation: z.string().trim().max(64),
    password: z.string().max(128).optional(),
  })
  .strict();

/**
 * Deletes the account by anonymizing it: personal data, credentials, sessions, linked logins and notes are
 * removed; ledger and hand rows are kept (they're other players' history too) under an anonymous name.
 * Requires typing the username (or "DELETE" if none) and the password when the account has one.
 */
export async function deleteAccount(userId: string, raw: unknown, ctx: RequestContext): Promise<ActionResult> {
  const parsed = deleteSchema.safeParse(raw);

  if (!parsed.success) {
    return fail("Confirm the deletion.", "INVALID_INPUT");
  }

  const key = rateLimitKey("sensitiveAction", "acct", `delete:${userId}`);
  const limit = await checkRateLimits([key]);

  if (!limit.allowed) {
    return fail(`Too many attempts. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`, "RATE_LIMITED");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || user.deletedAt) {
    return fail("Account not found.", "NOT_FOUND");
  }

  const expected = user.username ?? "DELETE";

  if (parsed.data.confirmation.toLowerCase() !== expected.toLowerCase()) {
    return fail(`Type ${expected} to confirm.`, "CONFIRMATION_MISMATCH", { confirmation: "Doesn't match." });
  }

  if (user.passwordHash && !(await verifyUserPassword(parsed.data.password ?? "", user.passwordHash))) {
    await recordRateLimitAttempt(key, AUTH_RATE_LIMITS.sensitiveAction);
    return fail("Your password is incorrect.", "INVALID_CREDENTIALS", { password: "Incorrect password." });
  }

  const seated = await prisma.lobbyPlayer.count({
    where: { userId, status: { in: ["JOINED", "SEATED"] }, leftAt: null, chipStack: { gt: 0 } },
  });

  if (seated > 0) {
    return fail("Leave your tables (and cash out) before deleting your account.", "SEATED");
  }

  const anonymousName = `deleted_${randomBytes(6).toString("hex")}`;
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        username: anonymousName,
        displayName: "Deleted player",
        name: "Deleted player",
        email: null,
        emailVerified: null,
        image: null,
        avatar: defaultAvatarId(anonymousName),
        bio: null,
        passwordHash: null,
        passwordChangedAt: null,
        totpSecret: null,
        totpEnabled: false,
        totpLastCounter: null,
        preferences: {},
        deletedAt: now,
      },
    }),
    prisma.session.deleteMany({ where: { userId } }),
    prisma.account.deleteMany({ where: { userId } }),
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.passwordResetToken.deleteMany({ where: { userId } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId } }),
    prisma.playerNote.deleteMany({ where: { OR: [{ ownerId: userId }, { subjectId: userId }] } }),
    prisma.wallet.deleteMany({ where: { userId } }),
  ]);
  await writeAuditLog({ userId, action: "account.deleted", ip: ctx.ip });
  return { ok: true };
}
