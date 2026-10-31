import { defaultAvatarId } from "@poker-platform/shared/accounts/avatars";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser, safeCallbackUrl } from "@/lib/auth/session";
import { AuthCard } from "../auth/_components/auth-card";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage({ searchParams }: { searchParams?: { callbackUrl?: string | string[] } }) {
  const callbackUrl = safeCallbackUrl(searchParams?.callbackUrl);
  const user = await requireUser({ allowWithoutUsername: true, callbackUrl: "/onboarding" });

  if (user.account.username) {
    redirect(callbackUrl);
  }

  const suggested = user.account.displayName ?? "";

  return (
    <AuthCard title="Pick your name" description="Choose how other players see you at the table.">
      <OnboardingForm
        callbackUrl={callbackUrl}
        suggestedName={suggested.slice(0, 32)}
        defaultAvatar={user.account.avatar ?? defaultAvatarId(user.userId)}
      />
    </AuthCard>
  );
}
