"use server";

import {
  completeTwoFactorLogin,
  loginWithPassword,
  registerWithPassword,
  requestPasswordReset,
  resendVerificationForEmail,
  resetPassword,
  verifyEmailToken,
} from "@poker-platform/shared/accounts";
import { deleteSessionByToken } from "@poker-platform/shared/auth";
import { redirect } from "next/navigation";
import {
  clearPendingTwoFactorCookie,
  getPendingTwoFactorCookie,
  getPendingVerifyEmail,
  getSessionTokenFromRequestCookies,
  setPendingTwoFactorCookie,
  setPendingVerifyEmailCookie,
  setSessionCookie,
} from "@/lib/auth/cookies";
import { getRequestContext } from "@/lib/auth/request";
import { safeCallbackUrl } from "@/lib/auth/session";

/**
 * Auth server actions. Next.js only accepts server actions as same-origin POSTs (Origin is checked
 * against Host), which covers CSRF. All input is validated with zod inside the shared services.
 */

export type AuthFormState = {
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

/** Replaces any previous session cookie (prevents session fixation / stale sessions). */
async function startSession(sessionToken: string, expires: Date) {
  const previous = getSessionTokenFromRequestCookies();

  if (previous && previous !== sessionToken) {
    await deleteSessionByToken(previous).catch(() => undefined);
  }

  setSessionCookie(sessionToken, expires);
}

export async function passwordSignInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const callbackUrl = safeCallbackUrl(text(formData, "callbackUrl"));
  const result = await loginWithPassword(
    { identifier: text(formData, "identifier", 254), password: text(formData, "password", 256) },
    getRequestContext(),
  );

  if (!result.ok) {
    return { error: result.error, code: result.code };
  }

  if (result.twoFactorRequired) {
    setPendingTwoFactorCookie(result.pendingToken);
    redirect(`/auth/two-factor?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  await startSession(result.sessionToken, result.expires);
  redirect(callbackUrl);
}

export async function twoFactorAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const callbackUrl = safeCallbackUrl(text(formData, "callbackUrl"));
  const result = await completeTwoFactorLogin(getPendingTwoFactorCookie(), text(formData, "code", 32), getRequestContext());

  if (!result.ok) {
    if (result.code === "PENDING_EXPIRED") {
      clearPendingTwoFactorCookie();
    }

    return { error: result.error, code: result.code };
  }

  clearPendingTwoFactorCookie();
  await startSession(result.sessionToken, result.expires);
  redirect(callbackUrl);
}

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = text(formData, "password", 256);

  if (password !== text(formData, "confirmPassword", 256)) {
    return { error: "Passwords don't match.", fieldErrors: { confirmPassword: "Passwords don't match." } };
  }

  const email = text(formData, "email", 254);
  const result = await registerWithPassword(
    { email, username: text(formData, "username", 40), password },
    getRequestContext(),
  );

  if (!result.ok) {
    return { error: result.error, code: result.code, fieldErrors: result.fieldErrors };
  }

  setPendingVerifyEmailCookie(email);
  redirect("/auth/check-email?type=verify");
}

/** "Resend email" on the check-email page, for the address the sign-up used (from its signed cookie). */
export async function resendVerificationAction(_prev: AuthFormState, _formData: FormData): Promise<AuthFormState> {
  const email = getPendingVerifyEmail();

  if (!email) {
    return { error: "This page expired. Sign in or create your account again to get a new link.", code: "EXPIRED" };
  }

  const result = await resendVerificationForEmail(email, getRequestContext());

  if (!result.ok) {
    return { error: result.error, code: result.code };
  }

  return { ok: true, message: "Sent. It can take a minute to arrive; check spam too." };
}

export async function forgotPasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const result = await requestPasswordReset({ email: text(formData, "email", 254) }, getRequestContext());

  if (!result.ok) {
    return { error: result.error, code: result.code, fieldErrors: result.fieldErrors };
  }

  return { ok: true, message: "If an account uses that email, we sent a reset link. It expires in 30 minutes." };
}

export async function resetPasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = text(formData, "password", 256);

  if (password !== text(formData, "confirmPassword", 256)) {
    return { error: "Passwords don't match.", fieldErrors: { confirmPassword: "Passwords don't match." } };
  }

  const result = await resetPassword({ token: text(formData, "token", 256), password }, getRequestContext());

  if (!result.ok) {
    return { error: result.error, code: result.code, fieldErrors: result.fieldErrors };
  }

  redirect("/auth/signin?notice=password-reset");
}

export async function verifyEmailAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const result = await verifyEmailToken(text(formData, "token", 256), getRequestContext());

  if (!result.ok) {
    if (result.code === "SIGN_IN_REQUIRED") {
      redirect("/auth/signin?notice=email-verified");
    }

    return { error: result.error, code: result.code };
  }

  await startSession(result.sessionToken, result.expires);
  // Password sign-ups (username already chosen) get a short welcome step; others pick a username first.
  redirect(result.needsOnboarding ? "/onboarding" : "/welcome");
}
