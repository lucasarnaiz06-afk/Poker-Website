import { z } from "zod";
import { prisma } from "../db/prisma";
import { writeAuditLog } from "../auth/audit";
import { generateToken, hashToken, hmacDigest, signValue, verifySignedValue } from "../auth/crypto";
import { isAllowedEmailDomain, resolveAllowedEmailDomains } from "../auth/email-domain";
import { buildLinkEmail, sendMail } from "../auth/mailer";
import { checkPasswordStrength, hashUserPassword, PASSWORD_MAX_LENGTH, verifyUserPassword } from "../auth/passwords";
import {
  AUTH_RATE_LIMITS,
  checkRateLimits,
  clearRateLimit,
  formatRetryAfter,
  ipRateLimitKeys,
  rateLimitKey,
  recordRateLimitAttempt,
  REGISTRATION_GLOBAL_KEY,
  registrationGlobalPolicy,
} from "../auth/rate-limit";
import { createDatabaseSession } from "../auth/session";
import { grantSignupBonus } from "../wallet/bonuses";
import { defaultAvatarId } from "./avatars";
import {
  fail,
  getAppBaseUrl,
  isUniqueViolation,
  MINUTE_MS,
  zodFailure,
  type ActionResult,
  type RequestContext,
} from "./common";
import { verifySecondFactor } from "./two-factor";
import { usernameSchema } from "./username";

export const EMAIL_TOKEN_TTL_MS = 30 * MINUTE_MS;
const PENDING_2FA_TTL_MS = 10 * MINUTE_MS;

const GENERIC_LOGIN_ERROR = "Incorrect email/username or password.";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("Enter a valid email address."));

const passwordInputSchema = z.string().min(1, "Enter a password.").max(PASSWORD_MAX_LENGTH);

export const registerInputSchema = z
  .object({ email: emailSchema, username: usernameSchema, password: passwordInputSchema })
  .strict();

export const loginInputSchema = z
  .object({ identifier: z.string().trim().min(1).max(254), password: passwordInputSchema })
  .strict();

export type SessionGrant = { sessionToken: string; expires: Date };

// ---------------------------------------------------------------------------
// Email helpers
// ---------------------------------------------------------------------------

async function issueEmailVerification(userId: string, email: string, ctx?: RequestContext) {
  const token = generateToken();
  await prisma.emailVerificationToken.create({
    data: { userId, email, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS) },
  });

  await sendMail(
    buildLinkEmail({
      to: email,
      subject: "Verify your email",
      intro: "Confirm your email address to finish creating your Poker Platform account. The link expires in 30 minutes.",
      actionLabel: "Verify email",
      url: `${getAppBaseUrl(ctx)}/auth/verify?token=${encodeURIComponent(token)}`,
    }),
  );
}

async function sendExistingAccountNotice(email: string, ctx?: RequestContext) {
  await sendMail(
    buildLinkEmail({
      to: email,
      subject: "You already have an account",
      intro: "Someone (hopefully you) tried to create a Poker Platform account with this email, but it already has one. Sign in, or reset your password if you forgot it.",
      actionLabel: "Reset password",
      url: `${getAppBaseUrl(ctx)}/auth/forgot`,
    }),
  );
}

/** Sends a new verification link, rate limited per account. */
export async function resendEmailVerification(userId: string, ctx: RequestContext): Promise<ActionResult> {
  const key = rateLimitKey("emailSend", "acct", userId);
  const limit = await checkRateLimits([key]);

  if (!limit.allowed) {
    return fail(`Please wait ${formatRetryAfter(limit.retryAfterSeconds)} before requesting another email.`, "RATE_LIMITED");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user?.email || user.emailVerified || user.deletedAt) {
    return { ok: true };
  }

  await recordRateLimitAttempt(key, AUTH_RATE_LIMITS.emailSend);
  await issueEmailVerification(user.id, user.email, ctx);
  return { ok: true };
}

/**
 * "Resend email" on the check-email page (no session yet, so by address). Rate limited per address and per
 * IP. Same answer whether or not an unverified account uses the address (no account enumeration).
 */
export async function resendVerificationForEmail(rawEmail: unknown, ctx: RequestContext): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(rawEmail);

  if (!parsed.success) {
    return fail("Enter a valid email address.", "INVALID_EMAIL");
  }

  const email = parsed.data;
  const ipKeys = ipRateLimitKeys("registerIp", ctx.ip);
  const emailKey = rateLimitKey("emailSend", "acct", `verify:${normalizeEmailForLimits(email)}`);
  const limit = await checkRateLimits([...ipKeys, emailKey]);

  if (!limit.allowed) {
    return fail(`Please wait ${formatRetryAfter(limit.retryAfterSeconds)} before requesting another email.`, "RATE_LIMITED");
  }

  await Promise.all([
    ...ipKeys.map((key) => recordRateLimitAttempt(key, AUTH_RATE_LIMITS.registerIp)),
    recordRateLimitAttempt(emailKey, AUTH_RATE_LIMITS.emailSend),
  ]);

  const user = await prisma.user.findUnique({ where: { email } });

  if (user && !user.emailVerified && !user.deletedAt && user.status === "ACTIVE") {
    await issueEmailVerification(user.id, email, ctx);
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

/**
 * Canonical form of an address for rate limiting: lowercase, "+tag" sub-addressing removed, so
 * "a+1@x.org" and "a+2@x.org" share one bucket. Provider-specific rules (e.g. Gmail dots) are not applied.
 */
export function normalizeEmailForLimits(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");

  if (at <= 0) {
    return lower;
  }

  const local = lower.slice(0, at).split("+")[0] || lower.slice(0, at);
  return `${local}${lower.slice(at)}`;
}

/**
 * Creates an unverified password account and emails a verification link. To avoid account enumeration the
 * result is the same whether or not the email is already registered (an existing owner gets a notice
 * email instead). Usernames are public, so "username taken" is reported directly.
 */
export async function registerWithPassword(raw: unknown, ctx: RequestContext): Promise<ActionResult> {
  const parsed = registerInputSchema.safeParse(raw);

  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  const { email, username, password } = parsed.data;
  const ipKeys = ipRateLimitKeys("registerIp", ctx.ip);
  const emailKey = rateLimitKey("registerEmail", "acct", normalizeEmailForLimits(email));
  const limit = await checkRateLimits([...ipKeys, emailKey, REGISTRATION_GLOBAL_KEY]);

  if (!limit.allowed) {
    return fail(`Too many sign-up attempts. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`, "RATE_LIMITED");
  }

  const strength = checkPasswordStrength(password, { username, email });

  if (!strength.ok) {
    return fail(strength.error, "WEAK_PASSWORD", { password: strength.error });
  }

  if (!isAllowedEmailDomain(email, resolveAllowedEmailDomains())) {
    return fail("Sign-up is limited to approved email domains.", "DOMAIN_NOT_ALLOWED", {
      email: "This email domain isn't allowed.",
    });
  }

  await Promise.all([
    ...ipKeys.map((key) => recordRateLimitAttempt(key, AUTH_RATE_LIMITS.registerIp)),
    recordRateLimitAttempt(emailKey, AUTH_RATE_LIMITS.registerEmail),
    recordRateLimitAttempt(REGISTRATION_GLOBAL_KEY, registrationGlobalPolicy()),
  ]);

  const usernameOwner = await prisma.user.findUnique({ where: { username }, select: { id: true } });

  if (usernameOwner) {
    return fail("That username is taken.", "USERNAME_TAKEN", { username: "That username is taken." });
  }

  // Hash before the existence check so both branches take the same time (no timing-based enumeration).
  const passwordHash = await hashUserPassword(password);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  if (existing) {
    await sendExistingAccountNotice(email, ctx);
    await writeAuditLog({ userId: existing.id, action: "auth.register", ip: ctx.ip, meta: { existing: true } });
    return { ok: true };
  }

  try {
    const user = await prisma.user.create({
      data: {
        email,
        username,
        displayName: username,
        name: username,
        avatar: defaultAvatarId(username),
        passwordHash,
        passwordChangedAt: new Date(),
      },
    });
    await issueEmailVerification(user.id, email, ctx);
    await writeAuditLog({ userId: user.id, action: "auth.register", ip: ctx.ip });
  } catch (error) {
    if (isUniqueViolation(error, "username")) {
      return fail("That username is taken.", "USERNAME_TAKEN", { username: "That username is taken." });
    }

    if (isUniqueViolation(error, "email")) {
      return { ok: true };
    }

    throw error;
  }

  return { ok: true };
}

/**
 * Consumes a verification link (single use, 30 min) and signs the user in. Called from a POST (button on
 * /auth/verify) so link scanners that prefetch the URL don't consume it.
 */
export async function verifyEmailToken(
  token: string,
  ctx: RequestContext,
): Promise<ActionResult<SessionGrant & { userId: string; needsOnboarding: boolean }>> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) {
    return fail("This link is invalid or has expired.", "INVALID_TOKEN");
  }

  const now = new Date();
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!record || record.usedAt || record.expiresAt <= now || record.user.deletedAt) {
    return fail("This link is invalid or has expired.", "INVALID_TOKEN");
  }

  // Mark used atomically: only one concurrent request can flip usedAt from null.
  const claimed = await prisma.emailVerificationToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now },
  });

  if (claimed.count !== 1 || record.user.email !== record.email) {
    return fail("This link is invalid or has expired.", "INVALID_TOKEN");
  }

  if (record.user.status !== "ACTIVE") {
    return fail("This account can't sign in.", "ACCOUNT_RESTRICTED");
  }

  await prisma.user.update({ where: { id: record.userId }, data: { emailVerified: record.user.emailVerified ?? now } });
  await writeAuditLog({ userId: record.userId, action: "auth.email_verified", ip: ctx.ip });

  // Password accounts get the signup bonus once the email is verified (and onboarding is done); the grant
  // re-checks eligibility and is idempotent, so whichever of verification/onboarding comes last pays it.
  await grantSignupBonus(record.userId);

  if (record.user.totpEnabled) {
    // Don't bypass 2FA through an email link: verify the email, then require a normal sign-in.
    return fail("Email verified. Sign in to continue.", "SIGN_IN_REQUIRED");
  }

  const session = await createDatabaseSession({ userId: record.userId, ip: ctx.ip, userAgent: ctx.userAgent });
  return { ok: true, ...session, userId: record.userId, needsOnboarding: !record.user.username };
}

// ---------------------------------------------------------------------------
// Password login (+ 2FA step)
// ---------------------------------------------------------------------------

export type PasswordLoginResult = ActionResult<
  | ({ twoFactorRequired: false } & SessionGrant)
  | { twoFactorRequired: true; pendingToken: string }
>;

export async function loginWithPassword(raw: unknown, ctx: RequestContext): Promise<PasswordLoginResult> {
  const parsed = loginInputSchema.safeParse(raw);

  if (!parsed.success) {
    return fail(GENERIC_LOGIN_ERROR, "INVALID_CREDENTIALS");
  }

  const identifier = parsed.data.identifier.toLowerCase();
  const ipKeys = ipRateLimitKeys("loginIp", ctx.ip);
  const accountKey = rateLimitKey("loginAccount", "acct", identifier);
  const limit = await checkRateLimits([...ipKeys, accountKey]);

  if (!limit.allowed) {
    await writeAuditLog({ action: "auth.login_blocked", ip: ctx.ip, meta: { identifierHash: hmacDigest("audit", identifier).slice(0, 16) } });
    return fail(`Too many attempts. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`, "RATE_LIMITED");
  }

  const user = await prisma.user.findFirst({
    where: identifier.includes("@") ? { email: identifier } : { username: identifier },
  });
  const passwordOk = await verifyUserPassword(parsed.data.password, user?.deletedAt ? null : user?.passwordHash);

  if (!user || user.deletedAt || !passwordOk) {
    await Promise.all([
      ...ipKeys.map((key) => recordRateLimitAttempt(key, AUTH_RATE_LIMITS.loginIp)),
      recordRateLimitAttempt(accountKey, AUTH_RATE_LIMITS.loginAccount),
    ]);
    await writeAuditLog({ userId: user?.id ?? null, action: "auth.login_failed", ip: ctx.ip });
    return fail(GENERIC_LOGIN_ERROR, "INVALID_CREDENTIALS");
  }

  // The password is correct from here on, so specific messages don't leak anything to a guesser.
  await clearRateLimit(accountKey);

  if (user.status !== "ACTIVE") {
    return fail("This account can't sign in. Contact support if you think this is a mistake.", "ACCOUNT_RESTRICTED");
  }

  if (!user.emailVerified) {
    await resendEmailVerification(user.id, ctx);
    return fail("Verify your email first. We sent you a new link.", "EMAIL_NOT_VERIFIED");
  }

  if (user.totpEnabled) {
    return {
      ok: true,
      twoFactorRequired: true,
      pendingToken: signValue(`2fa_${user.id}_${generateToken(9)}`, PENDING_2FA_TTL_MS),
    };
  }

  const session = await createDatabaseSession({ userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent });
  await writeAuditLog({ userId: user.id, action: "auth.login", ip: ctx.ip, meta: { method: "password" } });
  return { ok: true, twoFactorRequired: false, ...session };
}

/** Second login step: TOTP code or a recovery code. */
export async function completeTwoFactorLogin(
  pendingToken: string | null | undefined,
  code: string,
  ctx: RequestContext,
): Promise<ActionResult<SessionGrant>> {
  const payload = verifySignedValue(pendingToken);
  const userId = payload?.startsWith("2fa_") ? payload.split("_")[1] : null;

  if (!userId) {
    return fail("Your sign-in expired. Start again.", "PENDING_EXPIRED");
  }

  const key = rateLimitKey("twoFactor", "acct", userId);
  const limit = await checkRateLimits([key, ...ipRateLimitKeys("loginIp", ctx.ip)]);

  if (!limit.allowed) {
    return fail(`Too many attempts. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`, "RATE_LIMITED");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || user.deletedAt || user.status !== "ACTIVE" || !user.totpEnabled) {
    return fail("Your sign-in expired. Start again.", "PENDING_EXPIRED");
  }

  const verified = await verifySecondFactor(user, code);

  if (!verified.ok) {
    await recordRateLimitAttempt(key, AUTH_RATE_LIMITS.twoFactor);
    await writeAuditLog({ userId, action: "auth.2fa_failed", ip: ctx.ip });
    return fail("That code didn't work. Try again.", "INVALID_CODE");
  }

  await clearRateLimit(key);
  const session = await createDatabaseSession({ userId, ip: ctx.ip, userAgent: ctx.userAgent });
  await writeAuditLog({
    userId,
    action: verified.method === "recovery" ? "auth.recovery_code_used" : "auth.login",
    ip: ctx.ip,
    meta: { method: "password+2fa", factor: verified.method },
  });
  return { ok: true, ...session };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/** Always returns ok (no enumeration). Sends a 30-minute single-use link if the account exists. */
export async function requestPasswordReset(raw: unknown, ctx: RequestContext): Promise<ActionResult> {
  const parsed = z.object({ email: emailSchema }).strict().safeParse(raw);

  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  const { email } = parsed.data;
  const ipKeys = ipRateLimitKeys("resetIp", ctx.ip);
  const accountKey = rateLimitKey("resetAccount", "acct", email);
  const limit = await checkRateLimits([...ipKeys, accountKey]);

  if (!limit.allowed) {
    return fail(`Too many requests. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`, "RATE_LIMITED");
  }

  await Promise.all([
    ...ipKeys.map((key) => recordRateLimitAttempt(key, AUTH_RATE_LIMITS.resetIp)),
    recordRateLimitAttempt(accountKey, AUTH_RATE_LIMITS.resetAccount),
  ]);

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.deletedAt || user.status === "BANNED") {
    return { ok: true };
  }

  const token = generateToken();
  const now = new Date();

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS) },
    }),
  ]);

  await sendMail(
    buildLinkEmail({
      to: email,
      subject: "Reset your password",
      intro: "Use this link to choose a new password. It expires in 30 minutes and works once.",
      actionLabel: "Reset password",
      url: `${getAppBaseUrl(ctx)}/auth/reset?token=${encodeURIComponent(token)}`,
    }),
  );
  await writeAuditLog({ userId: user.id, action: "auth.password_reset_requested", ip: ctx.ip });
  return { ok: true };
}

export async function resetPassword(raw: unknown, ctx: RequestContext): Promise<ActionResult> {
  const parsed = z
    .object({ token: z.string().min(20).max(200), password: passwordInputSchema })
    .strict()
    .safeParse(raw);

  if (!parsed.success) {
    return fail("This link is invalid or has expired.", "INVALID_TOKEN");
  }

  const now = new Date();
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(parsed.data.token) },
    include: { user: true },
  });

  if (!record || record.usedAt || record.expiresAt <= now || record.user.deletedAt) {
    return fail("This link is invalid or has expired.", "INVALID_TOKEN");
  }

  const strength = checkPasswordStrength(parsed.data.password, {
    username: record.user.username,
    email: record.user.email,
  });

  if (!strength.ok) {
    return fail(strength.error, "WEAK_PASSWORD", { password: strength.error });
  }

  const passwordHash = await hashUserPassword(parsed.data.password);
  const claimed = await prisma.passwordResetToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now },
  });

  if (claimed.count !== 1) {
    return fail("This link is invalid or has expired.", "INVALID_TOKEN");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        passwordChangedAt: now,
        // Receiving the link proves control of the inbox.
        emailVerified: record.user.emailVerified ?? now,
      },
    }),
    prisma.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: now } }),
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ]);
  await clearRateLimit(rateLimitKey("loginAccount", "acct", record.user.email ?? ""));
  if (record.user.username) {
    await clearRateLimit(rateLimitKey("loginAccount", "acct", record.user.username));
  }
  await writeAuditLog({ userId: record.userId, action: "auth.password_reset", ip: ctx.ip });
  return { ok: true };
}

/** Used by /auth/reset to decide whether to show the form. Doesn't consume the token. */
export async function isPasswordResetTokenValid(token: string): Promise<boolean> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) {
    return false;
  }

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  return Boolean(record && !record.usedAt && record.expiresAt > new Date());
}
