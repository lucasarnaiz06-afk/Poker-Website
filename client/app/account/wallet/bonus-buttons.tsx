"use client";

import { Clock, Gift, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, toast } from "@/components/ui";
import { formatDuration } from "@/lib/format-time";
import { claimDailyBonusAction, claimRefillAction } from "../actions";

export function ClaimDailyButton({ disabled, label }: { disabled: boolean; label: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      leftIcon={<Gift />}
      disabled={disabled}
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await claimDailyBonusAction();
          toast({ title: result.message, tone: result.ok ? "success" : "error" });
        })
      }
    >
      {label}
    </Button>
  );
}

export function ClaimRefillButton({ disabled, label }: { disabled: boolean; label: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      leftIcon={<RefreshCw />}
      disabled={disabled}
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await claimRefillAction();
          toast({ title: result.message, tone: result.ok ? "success" : "error" });
        })
      }
    >
      {label}
    </Button>
  );
}

/** Muted "Next bonus in 5h 12m" (ticks every 30 s; reloads the page when the new day starts). */
export function NextBonusCountdown({ resetAt, label = "Next bonus in" }: { resetAt: string; label?: string }) {
  const router = useRouter();
  const target = Date.parse(resetAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const left = target - now;

  useEffect(() => {
    if (left <= 0) router.refresh();
  }, [left, router]);

  return (
    <p className="inline-flex items-center gap-1.5 text-sm text-muted" role="status">
      <Clock className="h-4 w-4 text-subtle" aria-hidden />
      <span suppressHydrationWarning>
        {left > 0 ? `${label} ${formatDuration(left)}` : "Available now"}
      </span>
    </p>
  );
}
