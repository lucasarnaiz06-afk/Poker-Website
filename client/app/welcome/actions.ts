"use server";

import { updateProfile } from "@poker-platform/shared/accounts";
import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request";
import { requireUser } from "@/lib/auth/session";
import type { AuthFormState } from "../auth/actions";

/** Saves the avatar picked on the welcome step, then opens the lobby. */
export async function welcomeAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const user = await requireUser({ callbackUrl: "/welcome" });
  const avatar = formData.get("avatar");

  if (typeof avatar === "string" && avatar && avatar !== user.account.avatar) {
    const result = await updateProfile(user.userId, { avatar: avatar.slice(0, 16) }, getRequestContext());

    if (!result.ok) {
      return { error: result.error };
    }
  }

  redirect("/lobby");
}
