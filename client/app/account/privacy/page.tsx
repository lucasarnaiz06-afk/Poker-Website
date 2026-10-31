import { Download } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { Section } from "../_components/section";
import { DeleteAccountForm } from "./delete-account-form";

export const metadata: Metadata = { title: "Privacy" };

export default async function PrivacyPage() {
  const { account } = await requireUser({ callbackUrl: "/account/privacy" });

  return (
    <>
      <Section title="Download your data" description="Profile, wallet history, hands you played, notes and security log as JSON.">
        <Button asChild variant="secondary" leftIcon={<Download />}>
          <a href="/account/privacy/export" download>
            Download JSON
          </a>
        </Button>
      </Section>
      <Section
        title="Delete account"
        tone="danger"
        description="Removes your email, password, profile and sessions. Hands you played stay in other players' history under an anonymous name. This can't be undone."
      >
        <DeleteAccountForm confirmWord={account.username ?? "DELETE"} hasPassword={account.hasPassword} />
      </Section>
    </>
  );
}
