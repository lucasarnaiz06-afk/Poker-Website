import { getResponsibleGamingLimits } from "@poker-platform/shared/accounts";
import type { Metadata } from "next";
import { Alert } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { Section } from "../_components/section";
import { CoolOffButtons, LimitsForm, SelfExclusionButtons } from "./limits-forms";

export const metadata: Metadata = { title: "Limits" };

function formatDate(date: Date) {
  return date.toUTCString().replace(" GMT", " UTC");
}

export default async function LimitsPage() {
  const { userId } = await requireUser({ callbackUrl: "/account/limits" });
  const limits = await getResponsibleGamingLimits(userId);
  const excluded = limits.selfExcludedPermanent || limits.selfExcludedUntil;

  return (
    <>
      {excluded ? (
        <Alert tone="warning" title="Self-excluded">
          {limits.selfExcludedPermanent ? "You have permanently excluded yourself from play." : `Until ${formatDate(limits.selfExcludedUntil!)}.`}
        </Alert>
      ) : limits.coolOffUntil ? (
        <Alert tone="info" title="On a break">
          Until {formatDate(limits.coolOffUntil)}.
        </Alert>
      ) : null}

      <Section title="Limits" description="Even with play money, it's healthy to set limits.">
        {limits.pendingDailyLossLimit ? (
          <Alert tone="info" className="mb-4">
            Your loss limit changes to{" "}
            {limits.pendingDailyLossLimit.value === null ? "no limit" : `${limits.pendingDailyLossLimit.value.toLocaleString("en-US")} chips`}{" "}
            on {formatDate(limits.pendingDailyLossLimit.effectiveAt)}.
          </Alert>
        ) : null}
        <LimitsForm dailyLossLimit={limits.dailyLossLimit} sessionReminderMinutes={limits.sessionReminderMinutes} />
      </Section>

      <Section title="Take a break" description="Pause play for a while. Your account and chips stay as they are.">
        <CoolOffButtons />
      </Section>

      <Section title="Self-exclusion" description="Block yourself from playing for a long period." tone="danger">
        <SelfExclusionButtons />
      </Section>
    </>
  );
}
