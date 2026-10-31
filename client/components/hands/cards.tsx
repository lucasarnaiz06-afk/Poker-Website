"use client";

import type { PublicCard } from "@poker-platform/shared/types";
import { PlayingCard } from "@/components/table/playing-card";
import { cn } from "@/components/ui/cn";

const RANKS = new Set(["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]);
const SUITS = new Set(["c", "d", "h", "s"]);

export function toPublicCard(code: string): PublicCard | null {
  const rank = code[0];
  const suit = code[1];
  if (!rank || !suit || !RANKS.has(rank) || !SUITS.has(suit)) return null;
  return { rank, suit } as PublicCard;
}

/** A row of playing cards from codes ("As"). `null` codes / missing cards render as backs. */
export function CardRow({
  cards,
  width = 26,
  count,
  className,
  dimmed,
  gap = "gap-0.5",
}: {
  cards: readonly string[] | null;
  width?: number;
  /** Number of backs to show when cards are hidden. */
  count?: number;
  className?: string;
  dimmed?: boolean;
  gap?: string;
}) {
  const list: Array<string | null> = cards && cards.length > 0 ? [...cards] : Array.from({ length: count ?? 0 }, () => null);
  if (list.length === 0) return <span className="text-subtle">—</span>;
  return (
    <span className={cn("inline-flex", gap, className)}>
      {list.map((code, i) => (
        <PlayingCard key={`${code ?? "back"}-${i}`} card={code ? toPublicCard(code) : null} width={width} dimmed={dimmed} />
      ))}
    </span>
  );
}

const SUIT_SYMBOL: Record<string, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };
const SUIT_TONE: Record<string, string> = { c: "text-suit-green", d: "text-suit-blue", h: "text-suit-red", s: "text-fg" };

/** Compact text cards ("A♠ K♦") for lists and the action log. */
export function CardText({ cards, className }: { cards: readonly string[]; className?: string }) {
  return (
    <span className={cn("inline-flex gap-1 font-mono text-[13px] font-semibold", className)}>
      {cards.map((c, i) => (
        <span key={`${c}-${i}`} className={SUIT_TONE[c[1] ?? ""] ?? "text-fg"}>
          {c[0] === "T" ? "10" : c[0]}
          {SUIT_SYMBOL[c[1] ?? ""] ?? ""}
        </span>
      ))}
    </span>
  );
}

/** Replaces card codes inside a sentence ("shows As Kd") with coloured glyphs. */
export function TextWithCards({ text }: { text: string }) {
  const parts = text.split(/\b([2-9TJQKA][cdhs])\b/g);
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <CardText key={i} cards={[part]} className="mx-px" /> : <span key={i}>{part}</span>))}
    </>
  );
}
