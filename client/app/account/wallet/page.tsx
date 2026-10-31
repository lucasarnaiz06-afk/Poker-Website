import { getDailyBonusStatus, getRefillStatus, listLedger, REFILL_TARGET, REFILL_THRESHOLD } from "@poker-platform/shared/wallet";
import type { LedgerEntryType } from "@prisma/client";
import { ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button, Chips, EmptyState, LocalTime, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { Section } from "../_components/section";
import { ClaimDailyButton, ClaimRefillButton, NextBonusCountdown } from "./bonus-buttons";

export const metadata: Metadata = { title: "Wallet" };

const TYPE_LABELS: Record<LedgerEntryType, string> = {
  SIGNUP_BONUS: "Welcome bonus",
  DAILY_BONUS: "Daily bonus",
  REFILL: "Refill",
  BUY_IN: "Buy-in",
  CASH_OUT: "Cash-out",
  REBUY: "Rebuy",
  ADJUSTMENT: "Adjustment",
  REFUND: "Refund",
};

export default async function WalletPage({ searchParams }: { searchParams?: { cursor?: string | string[] } }) {
  const { userId, account } = await requireUser({ callbackUrl: "/account/wallet" });
  const cursor = typeof searchParams?.cursor === "string" && searchParams.cursor.length < 64 ? searchParams.cursor : null;
  const [daily, refill, ledger] = await Promise.all([
    getDailyBonusStatus(userId),
    getRefillStatus(userId),
    listLedger(userId, { cursor, take: 20 }).catch(() => listLedger(userId, { take: 20 })),
  ]);

  return (
    <>
      <Section title="Balance" description="Play-money chips. No cash value; they can't be bought or withdrawn.">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-subtle">Wallet</p>
            <Chips amount={account.chipBalance} icon className="text-3xl font-semibold text-gold" />
          </div>
          {refill.chipsOnTables > 0 ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-subtle">On tables</p>
              <Chips amount={refill.chipsOnTables} className="text-lg text-fg" />
            </div>
          ) : null}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Daily bonus" description="Claim once per day (resets 00:00 UTC). Streaks add +250/day, up to +1,500.">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted">{daily.claimedToday ? "Claimed today" : "Available now"}</p>
              <p className="text-lg font-semibold text-fg">
                <Chips amount={daily.amount} signed={!daily.claimedToday} /> · day {daily.streak} streak
              </p>
            </div>
            {daily.claimedToday ? (
              <NextBonusCountdown resetAt={daily.nextResetAt.toISOString()} />
            ) : (
              <ClaimDailyButton disabled={false} label="Claim" />
            )}
          </div>
        </Section>
        <Section
          title="Refill"
          description={`Below ${REFILL_THRESHOLD.toLocaleString("en-US")} chips in total? Top back up to ${REFILL_TARGET.toLocaleString("en-US")} once a day.`}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted">
              {refill.claimedToday
                ? "Used today."
                : refill.eligible
                  ? `You can refill ${refill.amount.toLocaleString("en-US")} chips.`
                  : "Not needed right now."}
            </p>
            {refill.claimedToday ? (
              <NextBonusCountdown resetAt={daily.nextResetAt.toISOString()} label="Next refill in" />
            ) : refill.eligible ? (
              <ClaimRefillButton disabled={false} label="Refill" />
            ) : null}
          </div>
        </Section>
      </div>

      <Section title="History">
        {ledger.entries.length === 0 ? (
          <EmptyState icon={<ReceiptText />} title="No transactions yet" description="Bonuses, buy-ins and cash-outs will show up here." />
        ) : (
          <div className="space-y-4">
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  <TH numeric>Amount</TH>
                  <TH numeric>Balance</TH>
                </TR>
              </THead>
              <TBody>
                {ledger.entries.map((entry) => (
                  <TR key={entry.id}>
                    <TD className="whitespace-nowrap text-muted">
                      <LocalTime value={entry.createdAt} format="relative" />
                    </TD>
                    <TD>
                      {TYPE_LABELS[entry.type]}
                      {entry.lobbyId ? (
                        <span className="ml-1 text-subtle">· table</span>
                      ) : null}
                    </TD>
                    <TD numeric>
                      <Chips amount={entry.delta} signed />
                    </TD>
                    <TD numeric>
                      <Chips amount={entry.balanceAfter} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="flex justify-between gap-2">
              {cursor ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/account/wallet">Newest</Link>
                </Button>
              ) : (
                <span />
              )}
              {ledger.nextCursor ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/account/wallet?cursor=${encodeURIComponent(ledger.nextCursor)}`}>Older</Link>
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
