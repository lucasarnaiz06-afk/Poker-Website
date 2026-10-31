"use server";

import { completeOnboarding, isUsernameAvailable } from "@poker-platform/shared/accounts";
import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request";
import { requireUser, safeCallbackUrl } from "@/lib/auth/session";
import type { AuthFormState } from "../auth/actions";

export async function onboardingAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const user = await requireUser({ allowWithoutUsername: true, callbackUrl: "/onboarding" });
  const read = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.slice(0, 64) : "";
  };
  const displayName = read("displayName").trim();

  const result = await completeOnboarding(
    user.userId,
    { username: read("username"), avatar: read("avatar"), ...(displayName ? { displayName } : {}) },
    getRequestContext(),
  );

  if (!result.ok) {
    return { error: result.error, code: result.code, fieldErrors: result.fieldErrors };
  }

  redirect(safeCallbackUrl(read("callbackUrl")));
}

/** Debounced availability hint for the onboarding form. Requires a session. */
export async function checkUsernameAction(username: string): Promise<boolean> {
  await requireUser({ allowWithoutUsername: true, callbackUrl: "/onboarding" });
  return typeof username === "string" && username.length <= 40 ? isUsernameAvailable(username) : false;
}
