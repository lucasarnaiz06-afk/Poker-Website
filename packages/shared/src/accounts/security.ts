import { z } from "zod";
import { prisma } from "../db/prisma";
import { writeAuditLog } from "../auth/audit";
import { checkPasswordStrength, hashUserPassword, PASSWORD_MAX_LENGTH, verifyUserPassword } from "../auth/passwords";
import { AUTH_RATE_LIMITS, checkRateLimits, formatRetryAfter, rateLimitKey, recordRateLimitAttempt } from "../auth/rate-limit";
import { fail, zodFailure, type ActionResult, type RequestContext } from "./common";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().max(PASSWORD_MAX_LENGTH).optional(),
    newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

/**
 * Sets or changes the password. Accounts that already have a password must confirm the current one.
 * Other sessions are signed out (the current session token is kept).
 */
export async function changePassword(
  userId: string,
  raw: unknown,
  ctx: RequestContext & { currentSessionToken?: string | null },
): Promise<ActionResult> {
  const parsed = changePasswordSchema.safeParse(raw);

  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  const key = rateLimitKey("sensitiveAction", "acct", `password:${userId}`);
  const limit = await checkRateLimits([key]);

  if (!limit.allowed) {
    return fail(`Too many attempts. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`, "RATE_LIMITED");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || user.deletedAt) {
    return fail("Account not found.", "NOT_FOUND");
  }

  if (user.passwordHash && !(await verifyUserPassword(parsed.data.currentPassword ?? "", user.passwordHash))) {
    await recordRateLimitAttempt(key, AUTH_RATE_LIMITS.sensitiveAction);
    return fail("Your current password is incorrect.", "INVALID_CREDENTIALS", {
      currentPassword: "Incorrect password.",
    });
  }

  const strength = checkPasswordStrength(parsed.data.newPassword, { username: user.username, email: user.email });

  if (!strength.ok) {
    return fail(strength.error, "WEAK_PASSWORD", { newPassword: strength.error });
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashUserPassword(parsed.data.newPassword), passwordChangedAt: now },
    }),
    prisma.session.deleteMany({
      where: { userId, ...(ctx.currentSessionToken ? { sessionToken: { not: ctx.currentSessionToken } } : {}) },
    }),
  ]);
  await writeAuditLog({ userId, action: "auth.password_changed", ip: ctx.ip, meta: { hadPassword: Boolean(user.passwordHash) } });
  return { ok: true };
}

export type SessionSummary = {
  id: string;
  createdAt: Date;
  expires: Date;
  userAgent: string | null;
  current: boolean;
};

/** Active sessions (tokens are never returned). */
export async function listActiveSessions(userId: string, currentSessionToken?: string | null): Promise<SessionSummary[]> {
  const sessions = await prisma.session.findMany({
    where: { userId, expires: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  return sessions.map((session) => ({
    id: session.id,
    createdAt: session.createdAt,
    expires: session.expires,
    userAgent: session.userAgent,
    current: Boolean(currentSessionToken && session.sessionToken === currentSessionToken),
  }));
}

export async function revokeSession(userId: string, sessionId: string, ctx: RequestContext): Promise<ActionResult> {
  const result = await prisma.session.deleteMany({ where: { id: sessionId, userId } });

  if (result.count === 0) {
    return fail("Session not found.", "NOT_FOUND");
  }

  await writeAuditLog({ userId, action: "auth.session_revoked", ip: ctx.ip, meta: { sessionId } });
  return { ok: true };
}

/** Deletes every session for the user, including the current one. */
export async function signOutEverywhere(userId: string, ctx: RequestContext): Promise<ActionResult<{ count: number }>> {
  const result = await prisma.session.deleteMany({ where: { userId } });
  await writeAuditLog({ userId, action: "auth.logout_all", ip: ctx.ip, meta: { count: result.count } });
  return { ok: true, count: result.count };
}
