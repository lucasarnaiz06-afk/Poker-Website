import type { User } from "@prisma/client";
import { prisma } from "../db/prisma";
import { writeAuditLog } from "../auth/audit";
import { decryptSecret, encryptSecret } from "../auth/crypto";
import { verifyUserPassword } from "../auth/passwords";
import { AUTH_RATE_LIMITS, checkRateLimits, formatRetryAfter, rateLimitKey, recordRateLimitAttempt } from "../auth/rate-limit";
import {
  buildTotpUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotpCode,
} from "../auth/totp";
import { fail, type ActionResult, type RequestContext } from "./common";

type TwoFactorUser = Pick<User, "id" | "totpSecret" | "totpLastCounter">;

/**
 * Checks a TOTP code (replay-protected) or an unused recovery code (consumed on success).
 */
export async function verifySecondFactor(
  user: TwoFactorUser,
  rawCode: string,
): Promise<{ ok: true; method: "totp" | "recovery" } | { ok: false }> {
  const code = (rawCode ?? "").trim();

  if (!user.totpSecret || code.length === 0 || code.length > 32) {
    return { ok: false };
  }

  if (/^\d[\d\s]{5,7}$/.test(code)) {
    const counter = verifyTotpCode(decryptSecret(user.totpSecret), code, user.totpLastCounter);

    if (counter === null) {
      return { ok: false };
    }

    // Conditional update so two concurrent requests can't both use the same code.
    const updated = await prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ totpLastCounter: null }, { totpLastCounter: { lt: counter } }],
      },
      data: { totpLastCounter: counter },
    });

    return updated.count === 1 ? { ok: true, method: "totp" } : { ok: false };
  }

  if (normalizeRecoveryCode(code).length !== 10) {
    return { ok: false };
  }

  const consumed = await prisma.recoveryCode.updateMany({
    where: { userId: user.id, codeHash: hashRecoveryCode(code), usedAt: null },
    data: { usedAt: new Date() },
  });

  return consumed.count === 1 ? { ok: true, method: "recovery" } : { ok: false };
}

async function storeRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();

  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
    }),
  ]);

  return codes;
}

/** Step 1: create (or replace) a pending secret. Not active until confirmed with a code. */
export async function beginTotpSetup(
  userId: string,
): Promise<ActionResult<{ secret: string; otpauthUri: string }>> {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || user.deletedAt) {
    return fail("Account not found.", "NOT_FOUND");
  }

  if (user.totpEnabled) {
    return fail("Two-factor authentication is already on.", "ALREADY_ENABLED");
  }

  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: encryptSecret(secret), totpLastCounter: null },
  });

  const label = user.username ?? user.email ?? "player";
  return { ok: true, secret, otpauthUri: buildTotpUri(secret, label) };
}

/** Step 2: confirm the authenticator works; turns 2FA on and returns fresh recovery codes (shown once). */
export async function confirmTotpSetup(
  userId: string,
  code: string,
  ctx: RequestContext,
): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const key = rateLimitKey("sensitiveAction", "acct", `totp-setup:${userId}`);
  const limit = await checkRateLimits([key]);

  if (!limit.allowed) {
    return fail(`Too many attempts. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`, "RATE_LIMITED");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user?.totpSecret || user.totpEnabled) {
    return fail("Start the setup again.", "NO_PENDING_SETUP");
  }

  const counter = verifyTotpCode(decryptSecret(user.totpSecret), code, null);

  if (counter === null) {
    await recordRateLimitAttempt(key, AUTH_RATE_LIMITS.sensitiveAction);
    return fail("That code didn't match. Check your device's clock and try again.", "INVALID_CODE");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { totpEnabled: true, totpLastCounter: counter },
  });
  const recoveryCodes = await storeRecoveryCodes(userId);
  await writeAuditLog({ userId, action: "auth.2fa_enabled", ip: ctx.ip });
  return { ok: true, recoveryCodes };
}

/** Requires a current 2FA code (or recovery code) and, if the account has one, the password. */
async function verifySensitive(
  userId: string,
  input: { code: string; password?: string | null },
): Promise<ActionResult<{ user: User }>> {
  const key = rateLimitKey("sensitiveAction", "acct", `2fa-manage:${userId}`);
  const limit = await checkRateLimits([key]);

  if (!limit.allowed) {
    return fail(`Too many attempts. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`, "RATE_LIMITED");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user?.totpEnabled) {
    return fail("Two-factor authentication is off.", "NOT_ENABLED");
  }

  if (user.passwordHash && !(await verifyUserPassword(input.password ?? "", user.passwordHash))) {
    await recordRateLimitAttempt(key, AUTH_RATE_LIMITS.sensitiveAction);
    return fail("Your password or code is incorrect.", "INVALID_CREDENTIALS");
  }

  const factor = await verifySecondFactor(user, input.code);

  if (!factor.ok) {
    await recordRateLimitAttempt(key, AUTH_RATE_LIMITS.sensitiveAction);
    return fail("Your password or code is incorrect.", "INVALID_CREDENTIALS");
  }

  return { ok: true, user };
}

export async function disableTotp(
  userId: string,
  input: { code: string; password?: string | null },
  ctx: RequestContext,
): Promise<ActionResult> {
  const check = await verifySensitive(userId, input);

  if (!check.ok) {
    return check;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null, totpLastCounter: null },
    }),
    prisma.recoveryCode.deleteMany({ where: { userId } }),
  ]);
  await writeAuditLog({ userId, action: "auth.2fa_disabled", ip: ctx.ip });
  return { ok: true };
}

export async function regenerateRecoveryCodes(
  userId: string,
  input: { code: string; password?: string | null },
  ctx: RequestContext,
): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const check = await verifySensitive(userId, input);

  if (!check.ok) {
    return check;
  }

  const recoveryCodes = await storeRecoveryCodes(userId);
  await writeAuditLog({ userId, action: "auth.recovery_codes_regenerated", ip: ctx.ip });
  return { ok: true, recoveryCodes };
}

export async function countUnusedRecoveryCodes(userId: string) {
  return prisma.recoveryCode.count({ where: { userId, usedAt: null } });
}
