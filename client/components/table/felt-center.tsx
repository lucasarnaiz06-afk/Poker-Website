"use client";

import type { HandView, PublicCard, TableView } from "@poker-platform/shared/types";
import { cn } from "@/components/ui/cn";
import { Trophy } from "lucide-react";
import { ChipStack } from "./bits";
import { formatAmount, formatChips, sameCard, seatName } from "./format";
import { PlayingCard } from "./playing-card";

export function Board({
  hand,
  cardW,
  gap,
  highlightBoards,
}: {
  hand: HandView;
  /** Card width per board (from the table layout). */
  cardW: number;
  gap: number;
  /** Board indexes the viewer won on (subtle highlight). */
  highlightBoards?: number[];
}) {
  const boards = hand.boards.length > 0 ? hand.boards : [[]];
  const multi = boards.length > 1;
  const w = cardW;
  return (
    <div className="flex flex-col items-center" style={{ gap: multi ? gap + 2 : 0 }}>
      {boards.map((board, b) => (
        <div key={b} className="flex items-center" style={{ gap }} aria-label={multi ? `${hand.runItTwice ? "Run" : "Board"} ${b + 1}` : "Board"} role="group">
          {multi && (
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold tabular",
                highlightBoards?.includes(b) ? "bg-gold text-black" : "bg-black/40 text-fg/80",
              )}
              aria-hidden
            >
              {b + 1}
            </span>
          )}
          {Array.from({ length: 5 }).map((_, i) => {
            const card: PublicCard | undefined = board[i];
            if (!card) {
              return (
                <div
                  key={`empty-${i}`}
                  aria-hidden
                  className="shrink-0 rounded-[0.32em] border border-white/[0.07] bg-black/[0.06]"
                  style={{ width: w, height: Math.round(w * 1.4), fontSize: w * 0.42 }}
                />
              );
            }
            // Run it twice: cards shared with board 1 are shown faded on board 2.
            const shared = hand.runItTwice && b > 0 && sameCard(card, boards[0][i]);
            return (
              <PlayingCard
                key={`${hand.handId}-${b}-${i}-${card.rank}${card.suit}`}
                card={card}
                width={w}
                animate
                delayMs={i < 3 ? i * 80 : 0}
                dimmed={shared}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Chips already collected into the pot(s); current-street bets stay in front of the seats. */
export function collectedPot(hand: HandView): number {
  return hand.pots.reduce((n, p) => n + p.amount, 0);
}

/**
 * "Pot X" is the collected pots only, so it adds up with the Main / Side amounts under it; bets on
 * the current street are shown in front of each seat. `compact` (phones, narrow pot lane) summarises
 * several side pots as "Main 1,200 · 2 side pots".
 */
export function PotDisplay({ hand, bigBlind, inBB, compact = false }: { hand: HandView; bigBlind: number; inBB: boolean; compact?: boolean }) {
  const pots = hand.pots.filter((p) => p.amount > 0);
  const total = collectedPot(hand);
  const fmt = (n: number) => formatAmount(n, bigBlind, inBB);
  const sides = pots.slice(1);
  const breakdown = pots.map((p, i) => `${i === 0 ? "Main" : `Side ${i}`} ${fmt(p.amount)}`).join(" · ");
  return (
    <div className="flex max-w-full flex-col items-center gap-1">
      <div className="flex items-center gap-2 rounded-full bg-black/35 py-1 pl-2 pr-3 ring-1 ring-white/10" aria-live="polite">
        <ChipStack count={3} />
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg/70">Pot</span>
        <span className="text-sm font-semibold text-gold tabular">{fmt(total)}</span>
      </div>
      {sides.length > 0 && (
        <p
          className="max-w-full truncate rounded-full bg-black/25 px-2 py-px text-[11px] leading-4 text-fg/75 tabular"
          aria-label={`Pots: ${breakdown}`}
          title={breakdown}
        >
          Main <span className="font-semibold text-fg">{fmt(pots[0].amount)}</span>
          {compact && sides.length > 1 ? (
            <> · {sides.length} side pots</>
          ) : (
            sides.map((p, i) => (
              <span key={i}>
                {" "}
                · Side{sides.length > 1 ? ` ${i + 1}` : ""} <span className="font-semibold text-fg">{fmt(p.amount)}</span>
              </span>
            ))
          )}
        </p>
      )}
    </div>
  );
}

type WinnerLine = { seat: number; name: string; amount: number; handName: string | null; where: string | null };

export function summarizeWinners(view: TableView): WinnerLine[] {
  const hand = view.hand;
  const result = hand?.result;
  if (!hand || !result) return [];
  const multiPot = hand.pots.length > 1 || new Set(result.winners.map((w) => w.potIndex)).size > 1;
  const multiBoard = hand.boards.length > 1;
  const lines = new Map<string, WinnerLine>();
  for (const w of result.winners) {
    const where = [
      multiPot ? (w.potIndex === 0 ? "Main pot" : `Side pot ${w.potIndex}`) : null,
      multiBoard ? `${hand.runItTwice ? "Run" : "Board"} ${w.boardIndex + 1}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;
    const key = `${w.seat}|${where}`;
    const cur = lines.get(key);
    lines.set(key, {
      seat: w.seat,
      name: seatName(view, w.seat),
      amount: (cur?.amount ?? 0) + w.amount,
      handName: cur?.handName ?? w.handName,
      where,
    });
  }
  return [...lines.values()];
}

export function sidePaymentLines(view: TableView): Array<{ text: string; tone: "accent" | "danger" | "muted" }> {
  const result = view.hand?.result;
  if (!result || result.sidePayments.length === 0) return [];
  const me = view.viewer.seat;
  const out: Array<{ text: string; tone: "accent" | "danger" | "muted" }> = [];
  const nit = result.sidePayments.filter((p) => p.reason === "NIT_GAME");
  const bounty = result.sidePayments.filter((p) => p.reason === "BOUNTY_7_2");
  if (nit.length) {
    const payer = nit[0].fromSeat;
    const total = nit.reduce((n, p) => n + p.amount, 0);
    out.push({
      text: `${seatName(view, payer)} was the last nit and pays ${formatChips(nit[0].amount)} to each player`,
      tone: "muted",
    });
    const mine = nit.find((p) => p.toSeat === me);
    if (mine) out.push({ text: `+${formatChips(mine.amount)} nit penalty`, tone: "accent" });
    if (payer === me) out.push({ text: `-${formatChips(total)} nit penalty`, tone: "danger" });
  }
  if (bounty.length) {
    const winner = bounty[0].toSeat;
    const total = bounty.reduce((n, p) => n + p.amount, 0);
    out.push({ text: `${seatName(view, winner)} collects the 7-2 bounty from ${bounty.length} players`, tone: "muted" });
    if (winner === me) out.push({ text: `+${formatChips(total)} 7-2 bounty`, tone: "accent" });
    const paid = bounty.find((p) => p.fromSeat === me);
    if (paid) out.push({ text: `-${formatChips(paid.amount)} 7-2 bounty`, tone: "danger" });
  }
  return out;
}

/** "Full House, Kings full of Sevens" -> "Full House" (compact layouts; the seat tag has more). */
const shortHand = (name: string | null) => (name ? name.split(",")[0] : null);

/**
 * Compact hand summary. It lives in a lane the table layout keeps clear (above or below the board),
 * so it never covers the board or anyone's cards; amounts also fly to the winners' seats.
 */
export function ResultBanner({
  view,
  inBB,
  maxHeight,
  compact,
  variant = "felt",
}: {
  view: TableView;
  inBB: boolean;
  maxHeight?: number;
  compact: boolean;
  /** "dock": plain rows for the action dock when the felt has no room. */
  variant?: "felt" | "dock";
}) {
  const hand = view.hand!;
  const winners = summarizeWinners(view);
  const extras = sidePaymentLines(view);
  const bb = view.settings.bigBlind;
  const uncalled = hand.result?.uncalledReturn;
  const me = view.viewer.seat;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "max-w-full overflow-hidden",
        variant === "felt"
          ? cn("animate-rise-in rounded-xl border border-gold/25 bg-black/80 text-center shadow-pop backdrop-blur-sm", compact ? "px-2.5 py-1.5" : "px-3.5 py-2")
          : "text-left",
      )}
      style={{ maxHeight }}
    >
      <ul>
        {winners.map((w, i) => {
          const mine = w.seat === me;
          const handName = compact ? shortHand(w.handName) : w.handName;
          return (
            <li
              key={i}
              className={cn(
                "flex min-w-0 items-center gap-1.5",
                variant === "felt" && "justify-center",
                compact ? "text-[12px] leading-[18px]" : "text-[13px] leading-5",
              )}
            >
              <Trophy className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
              <span className="min-w-0 truncate">
                <span className="font-semibold text-fg">{mine ? "You" : w.name}</span> <span className="text-muted">{mine ? "win" : "wins"}</span>{" "}
                <span className="font-semibold text-gold tabular">{formatAmount(w.amount, bb, inBB)}</span>
                {handName && <span className="text-muted"> · {handName}</span>}
                {w.where && <span className="text-subtle"> · {w.where}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {(extras.length > 0 || uncalled) && (
        <ul className="mt-1 space-y-0.5 border-t border-white/10 pt-1">
          {extras.map((e, i) => (
            <li
              key={i}
              className={cn(
                "text-[11px] leading-4 tabular",
                variant === "felt" ? "truncate" : "line-clamp-2",
                e.tone === "accent" ? "font-semibold text-accent" : e.tone === "danger" ? "font-semibold text-danger" : "text-muted",
              )}
            >
              {e.text}
            </li>
          ))}
          {uncalled && (
            <li className="truncate text-[11px] leading-4 text-subtle tabular">
              {formatChips(uncalled.amount)} uncalled returned to {seatName(view, uncalled.seat)}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
