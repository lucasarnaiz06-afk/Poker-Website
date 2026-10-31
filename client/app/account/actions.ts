"use server";

import {
  beginTotpSetup,
  changePassword,
  changeUsername,
  confirmTotpSetup,
  deleteAccount,
  disableTotp,
  regenerateRecoveryCodes,
  revokeSession,
  selfExclude,
  signOutEverywhere,
  startCoolOff,
  updatePreferences,
  updateProfile,
  updateResponsibleGamingLimits,
  type CoolOffDuration,
  type Preferences,
  type SelfExclusionDuration,
} from "@poker-platform/shared/accounts";
import { claimDailyBonus, claimRefill, WalletError } from "@poker-platform/shared/wallet";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { clearSessionCookie } from "@/lib/auth/cookies";
import { getRequestContext } from "@/lib/auth/request";
import { requireUser } from "@/lib/auth/session";

/**
 * Account server actions. Each one re-authenticates (server actions are public POST endpoints), validates
 * input with zod in the shared services, and only ever acts on the signed-in user's own account.
 */

export type AccountFormState = {
  ok?: boolean;
  error?: string;
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function text(formData: FormData, key: string, max = 512): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.slice(0, max) : "";
}

function refresh() {
  revalidatePath("/account", "layout");
}

// Profile ---------------------------------------------------------------------

export async function updateProfileAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser({ callbackUrl: "/account/profile" });
  const result = await updateProfile(
    user.userId,
    {
      displayName: text(formData, "displayName", 64),
      bio: text(formData, "bio", 400),
      avatar: text(formData, "avatar", 16),
    },
    getRequestContext(),
  );

  if (!result.ok) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }

  refresh();
  return { ok: true, message: "Profile saved." };
}

export async function changeUsernameAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser({ callbackUrl: "/account/profile" });
  const result = await changeUsername(user.userId, { username: text(formData, "username", 40) }, getRequestContext());

  if (!result.ok) {
    return { error: result.error, code: result.code, fieldErrors: result.fieldErrors };
  }

  refresh();
  return { ok: true, message: "Username changed." };
}

// Security --------------------------------------------------------------------

export async function changePasswordAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser({ callbackUrl: "/account/security" });
  const newPassword = text(formData, "newPassword", 256);

  if (newPassword !== text(formData, "confirmPassword", 256)) {
    return { error: "Passwords don't match.", fieldErrors: { confirmPassword: "Passwords don't match." } };
  }

  const current = formData.get("currentPassword");
  const result = await changePassword(
    user.userId,
    { newPassword, ...(typeof current === "string" ? { currentPassword: current.slice(0, 256) } : {}) },
    { ...getRequestContext(), currentSessionToken: user.sessionToken },
  );

  if (!result.ok) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }

  refresh();
  return { ok: true, message: user.account.hasPassword ? "Password changed. Other devices were signed out." : "Password set." };
}

export async function beginTotpSetupAction(): Promise<
  { ok: true; secret: string; qrSvg: string } | { ok: false; error: string }
> {
  const user = await requireUser({ callbackUrl: "/account/security" });
  const result = await beginTotpSetup(user.userId);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const qrSvg = await QRCode.toString(result.otpauthUri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { ok: true, secret: result.secret, qrSvg };
}

export type RecoveryCodesState = (AccountFormState & { recoveryCodes?: string[] }) | null;

export async function confirmTotpAction(_prev: RecoveryCodesState, formData: FormData): Promise<RecoveryCodesState> {
  const user = await requireUser({ callbackUrl: "/account/security" });
  const result = await confirmTotpSetup(user.userId, text(formData, "code", 16), getRequestContext());

  if (!result.ok) {
    return { error: result.error };
  }

  // No revalidation here: the page would re-render as "enabled" and drop the one-time recovery codes.
  // The client refreshes after the user confirms they saved them.
  return { ok: true, recoveryCodes: result.recoveryCodes };
}

export async function disableTotpAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser({ callbackUrl: "/account/security" });
  const result = await disableTotp(
    user.userId,
    { code: text(formData, "code", 32), password: text(formData, "password", 256) || null },
    getRequestContext(),
  );

  if (!result.ok) {
    return { error: result.error };
  }

  refresh();
  return { ok: true, message: "Two-factor authentication is off." };
}

export async function regenerateRecoveryCodesAction(_prev: RecoveryCodesState, formData: FormData): Promise<RecoveryCodesState> {
  const user = await requireUser({ callbackUrl: "/account/security" });
  const result = await regenerateRecoveryCodes(
    user.userId,
    { code: text(formData, "code", 32), password: text(formData, "password", 256) || null },
    getRequestContext(),
  );

  if (!result.ok) {
    return { error: result.error };
  }

  return { ok: true, recoveryCodes: result.recoveryCodes };
}

export async function revokeSessionAction(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser({ callbackUrl: "/account/security" });

  if (typeof sessionId !== "string" || sessionId.length > 64) {
    return { ok: false, error: "Invalid session." };
  }

  const result = await revokeSession(user.userId, sessionId, getRequestContext());
  refresh();
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function signOutEverywhereAction(): Promise<void> {
  const user = await requireUser({ callbackUrl: "/account/security" });
  await signOutEverywhere(user.userId, getRequestContext());
  clearSessionCookie();
  redirect("/auth/signin?notice=signed-out");
}

// Preferences -----------------------------------------------------------------

export async function updatePreferencesAction(
  update: Partial<Preferences>,
): Promise<{ ok: true; preferences: Preferences } | { ok: false; error: string }> {
  const user = await requireUser({ callbackUrl: "/account/preferences" });
  const result = await updatePreferences(user.userId, update);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  refresh();
  return { ok: true, preferences: result.preferences };
}

// Wallet ----------------------------------------------------------------------

export async function claimDailyBonusAction(): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser({ callbackUrl: "/account/wallet" });

  try {
    const result = await claimDailyBonus(user.userId);
    refresh();
    return { ok: true, message: `+${result.entry.delta.toLocaleString("en-US")} chips. Day ${result.streak} streak.` };
  } catch (error) {
    if (error instanceof WalletError) {
      return { ok: false, message: error.message };
    }

    throw error;
  }
}

export async function claimRefillAction(): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser({ callbackUrl: "/account/wallet" });

  try {
    const result = await claimRefill(user.userId);
    refresh();
    return { ok: true, message: `+${result.entry.delta.toLocaleString("en-US")} chips refilled.` };
  } catch (error) {
    if (error instanceof WalletError) {
      return { ok: false, message: error.message };
    }

    throw error;
  }
}

// Limits ----------------------------------------------------------------------

export async function updateLimitsAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser({ callbackUrl: "/account/limits" });
  const parseOptionalInt = (key: string) => {
    const raw = text(formData, key, 20).replace(/[,\s]/g, "");
    return raw === "" ? null : Number(raw);
  };

  const result = await updateResponsibleGamingLimits(
    user.userId,
    {
      dailyLossLimit: parseOptionalInt("dailyLossLimit"),
      sessionReminderMinutes: parseOptionalInt("sessionReminderMinutes"),
    },
    getRequestContext(),
  );

  if (!result.ok) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }

  refresh();
  return {
    ok: true,
    message: result.delayed
      ? "Saved. Raising or removing your loss limit takes effect in 24 hours."
      : "Limits saved.",
  };
}

export async function coolOffAction(duration: CoolOffDuration): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser({ callbackUrl: "/account/limits" });
  const result = await startCoolOff(user.userId, duration, getRequestContext());
  refresh();
  return result.ok
    ? { ok: true, message: `Break started until ${result.until.toUTCString()}.` }
    : { ok: false, message: result.error };
}

export async function selfExcludeAction(duration: SelfExclusionDuration): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser({ callbackUrl: "/account/limits" });
  const result = await selfExclude(user.userId, duration, getRequestContext());
  refresh();
  return result.ok
    ? { ok: true, message: result.until ? `Self-excluded until ${result.until.toUTCString()}.` : "Self-excluded permanently." }
    : { ok: false, message: result.error };
}

// Privacy ---------------------------------------------------------------------

export async function deleteAccountAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser({ callbackUrl: "/account/privacy" });
  const password = text(formData, "password", 256);
  const result = await deleteAccount(
    user.userId,
    { confirmation: text(formData, "confirmation", 64), ...(password ? { password } : {}) },
    getRequestContext(),
  );

  if (!result.ok) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }

  clearSessionCookie();
  redirect("/");
}
