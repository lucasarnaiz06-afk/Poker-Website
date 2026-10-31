import { countUnusedRecoveryCodes, listActiveSessions } from "@poker-platform/shared/accounts";
import type { Metadata } from "next";
import { Badge } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { Section } from "../_components/section";
import { PasswordForm } from "./password-form";
import { SessionsList } from "./sessions-list";
import { TwoFactorSection } from "./two-factor-section";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const { userId, account, sessionToken } = await requireUser({ callbackUrl: "/account/security" });
  const [sessions, unusedCodes] = await Promise.all([
    listActiveSessions(userId, sessionToken),
    account.totpEnabled ? countUnusedRecoveryCodes(userId) : Promise.resolve(0),
  ]);

  return (
    <>
      <Section title="Email" description="Used to sign in and recover your account. Never shown to other players.">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-fg">{account.email ?? "No email"}</span>
          {account.email ? (
            <Badge tone={account.emailVerified ? "accent" : "warning"}>{account.emailVerified ? "Verified" : "Unverified"}</Badge>
          ) : null}
          {account.linkedProviders.includes("google") ? <Badge tone="outline">Google linked</Badge> : null}
        </div>
      </Section>
      <Section
        title="Password"
        description={account.hasPassword ? "Changing it signs out your other devices." : "Add a password to sign in without an email link."}
      >
        <PasswordForm hasPassword={account.hasPassword} />
      </Section>
      <Section title="Two-factor authentication">
        <TwoFactorSection enabled={account.totpEnabled} hasPassword={account.hasPassword} unusedCodes={unusedCodes} />
      </Section>
      <Section title="Active sessions" description="Devices currently signed in to your account.">
        <SessionsList
          sessions={sessions.map((session) => ({
            id: session.id,
            createdAt: session.createdAt.toISOString(),
            expires: session.expires.toISOString(),
            userAgent: session.userAgent,
            current: session.current,
          }))}
        />
      </Section>
    </>
  );
}
