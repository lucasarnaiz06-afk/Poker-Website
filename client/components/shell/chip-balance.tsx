"use client";

import { Gift } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { claimDailyBonusAction } from "@/app/account/actions";
import { Button } from "@/components/ui/button";
import { Chips } from "@/components/ui/chips";
import { cn } from "@/components/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";

const pillClass = cn(
  "relative inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface-2 pl-2 pr-3 text-[13px] font-medium text-fg",
  "transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
);

function balanceLabel(balance: number) {
  return `Chip balance: ${balance.toLocaleString("en-US")} chips.`;
}

/**
 * Wallet balance pill. Links to the wallet; when today's daily bonus is waiting it shows a dot and opens a
 * small popover that claims it in one click. Renders nothing when the balance is unknown.
 */
export function ChipBalancePill({
  balance,
  dailyBonus = null,
  className,
}: {
  balance: number | null;
  dailyBonus?: { amount: number; streak: number } | null;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [claimed, setClaimed] = useState(false);

  if (balance === null) {
    return null;
  }

  if (!dailyBonus || claimed) {
    return (
      <Link href="/account/wallet" className={cn(pillClass, className)} aria-label={`${balanceLabel(balance)} Open wallet`}>
        <Chips amount={balance} compact icon />
      </Link>
    );
  }

  function claim() {
    startTransition(async () => {
      const result = await claimDailyBonusAction();
      toast({ title: result.ok ? "Daily bonus claimed" : "Couldn't claim the bonus", description: result.message, tone: result.ok ? "success" : "error" });

      if (result.ok) {
        setClaimed(true);
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(pillClass, className)} aria-label={`${balanceLabel(balance)} Daily bonus ready`}>
        <Chips amount={balance} compact icon />
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent" aria-hidden>
            <Gift className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-fg">Daily bonus ready</p>
            <p className="mt-0.5 text-muted">
              <Chips amount={dailyBonus.amount} signed /> · day {dailyBonus.streak} streak
            </p>
          </div>
        </div>
        <Button className="mt-4" fullWidth onClick={claim} loading={pending}>
          Claim {dailyBonus.amount.toLocaleString("en-US")} chips
        </Button>
        <Link
          href="/account/wallet"
          onClick={() => setOpen(false)}
          className="mt-2 block rounded-md py-1 text-center text-xs text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Open wallet
        </Link>
      </PopoverContent>
    </Popover>
  );
}
