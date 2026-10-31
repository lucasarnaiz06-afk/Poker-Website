import { z } from "zod";
import { prisma } from "../db/prisma";
import { writeAuditLog } from "../auth/audit";
import { grantSignupBonus } from "../wallet/bonuses";
import { AVATAR_IDS, defaultAvatarId } from "./avatars";
import { DAY_MS, fail, isUniqueViolation, zodFailure, type ActionResult, type RequestContext } from "./common";
import { mergePreferences, parsePreferences, preferencesUpdateSchema, type Preferences } from "./preferences";
import { bioSchema, displayNameSchema, USERNAME_CHANGE_COOLDOWN_DAYS, usernameSchema } from "./username";

const avatarSchema = z.enum(AVATAR_IDS as [string, ...string[]], "Pick one of the avatars.");

export const onboardingInputSchema = z
  .object({
    username: usernameSchema,
    avatar: avatarSchema,
    displayName: displayNameSchema.optional(),
  })
  .strict();

/** Safe account view for the owner (no secrets). */
export type AccountView = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  username: string | null;
  displayName: string | null;
  avatar: string;
  bio: string | null;
  role: "USER" | "MOD" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "BANNED";
  chipBalance: number;
  hasPassword: boolean;
  totpEnabled: boolean;
  preferences: Preferences;
  createdAt: Date;
  usernameChangedAt: Date | null;
  nextUsernameChangeAt: Date | null;
  linkedProviders: string[];
};

export async function getAccountView(userId: string, now = new Date()): Promise<AccountView | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { accounts: { select: { provider: true } } },
  });

  if (!user || user.deletedAt) {
    return null;
  }

  const nextChange = user.usernameChangedAt
    ? new Date(user.usernameChangedAt.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * DAY_MS)
    : null;

  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    username: user.username,
    displayName: user.displayName ?? user.name,
    avatar: user.avatar ?? defaultAvatarId(user.id),
    bio: user.bio,
    role: user.role,
    status: user.status,
    chipBalance: user.chipBalance,
    hasPassword: Boolean(user.passwordHash),
    totpEnabled: user.totpEnabled,
    preferences: parsePreferences(user.preferences),
    createdAt: user.createdAt,
    usernameChangedAt: user.usernameChangedAt,
    nextUsernameChangeAt: nextChange && nextChange > now ? nextChange : null,
    linkedProviders: user.accounts.map((account) => account.provider),
  };
}

/**
 * First-time setup after any sign-in method: choose username + avatar. Grants the 10,000 chip signup
 * bonus if the email is verified (idempotent; calling again with the same username is a no-op that still
 * ensures the bonus). Unverified password accounts get it from verifyEmailToken instead.
 */
export async function completeOnboarding(userId: string, raw: unknown, ctx: RequestContext): Promise<ActionResult> {
  const parsed = onboardingInputSchema.safeParse(raw);

  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  const { username, avatar } = parsed.data;
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || user.deletedAt) {
    return fail("Account not found.", "NOT_FOUND");
  }

  if (user.username && user.username !== username) {
    return fail("You already chose a username. Change it from your account settings.", "ALREADY_ONBOARDED");
  }

  if (!user.username) {
    const displayName = parsed.data.displayName ?? username;

    try {
      const updated = await prisma.user.updateMany({
        where: { id: userId, username: null },
        data: { username, avatar, displayName, name: displayName },
      });

      if (updated.count === 0) {
        return fail("You already chose a username.", "ALREADY_ONBOARDED");
      }
    } catch (error) {
      if (isUniqueViolation(error, "username")) {
        return fail("That username is taken.", "USERNAME_TAKEN", { username: "That username is taken." });
      }

      throw error;
    }

    await writeAuditLog({ userId, action: "account.onboarded", ip: ctx.ip, meta: { username } });
  } else {
    await prisma.user.update({ where: { id: userId }, data: { avatar } });
  }

  await grantSignupBonus(userId);
  return { ok: true };
}

export async function isUsernameAvailable(raw: string): Promise<boolean> {
  const parsed = usernameSchema.safeParse(raw);

  if (!parsed.success) {
    return false;
  }

  const existing = await prisma.user.findUnique({ where: { username: parsed.data }, select: { id: true } });
  return !existing;
}

export const profileUpdateSchema = z
  .object({
    displayName: displayNameSchema,
    bio: bioSchema,
    avatar: avatarSchema,
  })
  .partial()
  .strict();

export async function updateProfile(userId: string, raw: unknown, ctx: RequestContext): Promise<ActionResult> {
  const parsed = profileUpdateSchema.safeParse(raw);

  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  const data = parsed.data;
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.displayName !== undefined ? { displayName: data.displayName, name: data.displayName } : {}),
      ...(data.bio !== undefined ? { bio: data.bio || null } : {}),
      ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
    },
  });
  await writeAuditLog({ userId, action: "account.profile_updated", ip: ctx.ip, meta: { fields: Object.keys(data) } });
  return { ok: true };
}

/** Username change with a 30-day cooldown. */
export async function changeUsername(
  userId: string,
  raw: unknown,
  ctx: RequestContext,
  now = new Date(),
): Promise<ActionResult> {
  const parsed = z.object({ username: usernameSchema }).strict().safeParse(raw);

  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || user.deletedAt) {
    return fail("Account not found.", "NOT_FOUND");
  }

  if (user.username === parsed.data.username) {
    return { ok: true };
  }

  if (user.usernameChangedAt && now.getTime() - user.usernameChangedAt.getTime() < USERNAME_CHANGE_COOLDOWN_DAYS * DAY_MS) {
    const next = new Date(user.usernameChangedAt.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * DAY_MS);
    return fail(`You can change your username again on ${next.toISOString().slice(0, 10)}.`, "COOLDOWN");
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { username: parsed.data.username, usernameChangedAt: now },
    });
  } catch (error) {
    if (isUniqueViolation(error, "username")) {
      return fail("That username is taken.", "USERNAME_TAKEN", { username: "That username is taken." });
    }

    throw error;
  }

  await writeAuditLog({
    userId,
    action: "account.username_changed",
    ip: ctx.ip,
    meta: { from: user.username, to: parsed.data.username },
  });
  return { ok: true };
}

export async function getPreferences(userId: string): Promise<Preferences> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
  return parsePreferences(user?.preferences);
}

export async function updatePreferences(userId: string, raw: unknown): Promise<ActionResult<{ preferences: Preferences }>> {
  const parsed = preferencesUpdateSchema.safeParse(raw);

  if (!parsed.success) {
    return zodFailure(parsed.error);
  }

  const current = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });

  if (!current) {
    return fail("Account not found.", "NOT_FOUND");
  }

  const preferences = mergePreferences(current.preferences, parsed.data);
  await prisma.user.update({ where: { id: userId }, data: { preferences } });
  return { ok: true, preferences };
}
