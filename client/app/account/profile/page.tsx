import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { Section } from "../_components/section";
import { ProfileForm, UsernameForm } from "./profile-forms";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { account } = await requireUser({ callbackUrl: "/account/profile" });
  const username = account.username ?? "";

  return (
    <>
      <Section title="Profile" description="How other players see you.">
        <ProfileForm
          displayName={account.displayName ?? username}
          bio={account.bio ?? ""}
          avatar={account.avatar}
          username={username}
        />
      </Section>
      <Section title="Username" description="Your unique handle and profile URL.">
        <UsernameForm username={username} nextChangeAt={account.nextUsernameChangeAt?.toISOString() ?? null} />
      </Section>
    </>
  );
}
