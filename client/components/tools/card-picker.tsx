"use client";

import { X } from "lucide-react";
import { usePreferences, type DeckStyle } from "@/components/table/preferences";
import { cn } from "@/components/ui/cn";

export const PICKER_RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
export const PICKER_SUITS = [
  { key: "s", symbol: "♠", name: "spades", tone: "text-fg" },
  { key: "h", symbol: "♥", name: "hearts", tone: "text-suit-red" },
  { key: "d", symbol: "♦", name: "diamonds", tone: "text-suit-blue" },
  { key: "c", symbol: "♣", name: "clubs", tone: "text-suit-green" },
] as const;

const RANK_NAME: Record<string, string> = { A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "Ten" };

/** Suit colour for the viewer's deck style (same preference as the table): two-colour decks use red/black. */
function suitTone(key: string, deck: DeckStyle, onWhite = false) {
  const black = onWhite ? "text-[#1b1f27]" : "text-fg";
  if (key === "s") return black;
  if (key === "h") return "text-suit-red";
  if (deck === "four-color") return key === "d" ? "text-suit-blue" : "text-suit-green";
  return key === "d" ? "text-suit-red" : black;
}

export function cardName(code: string) {
  const suit = PICKER_SUITS.find((s) => s.key === code[1]);
  return `${RANK_NAME[code[0]!] ?? code[0]} of ${suit?.name ?? ""}`;
}

/** Full deck grid. Cards already used elsewhere are disabled. */
export function DeckGrid({ used, onPick, disabled }: { used: ReadonlySet<string>; onPick: (card: string) => void; disabled?: boolean }) {
  const [{ deck }] = usePreferences();

  return (
    <div className="space-y-1" role="group" aria-label="Pick a card">
      {PICKER_SUITS.map((suit) => (
        <div key={suit.key} className="grid gap-[3px]" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
          {PICKER_RANKS.map((rank) => {
            const code = `${rank}${suit.key}`;
            const taken = used.has(code);
            return (
              <button
                key={code}
                type="button"
                disabled={taken || disabled}
                onClick={() => onPick(code)}
                aria-label={cardName(code)}
                className={cn(
                  "flex h-9 flex-col items-center justify-center rounded-md border border-line bg-surface-2 text-[11px] font-semibold leading-none transition-colors sm:h-11 sm:text-sm",
                  "hover:border-accent/60 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  "disabled:cursor-not-allowed disabled:opacity-25",
                  suitTone(suit.key, deck),
                )}
              >
                <span>{rank === "T" ? "10" : rank}</span>
                <span className="text-[10px] sm:text-xs">{suit.symbol}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A row of card slots. The active slot (if any) receives the next picked card. */
export function CardSlots({
  cards,
  active,
  onSelect,
  onClear,
  label,
  size = "md",
}: {
  cards: Array<string | null>;
  active: number | null;
  onSelect: (index: number) => void;
  onClear: (index: number) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const [{ deck }] = usePreferences();

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {cards.map((card, i) => {
        const suit = card ? PICKER_SUITS.find((s) => s.key === card[1]) : null;
        return (
          <div key={i} className="relative">
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-label={card ? `${label}: ${cardName(card)}. Click to replace.` : `${label}: empty slot ${i + 1}`}
              aria-pressed={active === i}
              className={cn(
                "flex flex-col items-center justify-center rounded-md border font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                size === "md" ? "h-14 w-10 text-base" : "h-11 w-8 text-sm",
                card ? "border-black/10 bg-[#fbfbfa]" : "border-dashed border-line bg-surface-2 text-subtle",
                active === i && "ring-2 ring-accent ring-offset-2 ring-offset-surface",
                suit && suitTone(suit.key, deck, true),
              )}
            >
              {card ? (
                <>
                  <span>{card[0] === "T" ? "10" : card[0]}</span>
                  <span className="text-sm">{suit?.symbol}</span>
                </>
              ) : (
                <span className="text-lg">+</span>
              )}
            </button>
            {card ? (
              <button
                type="button"
                onClick={() => onClear(i)}
                aria-label={`Remove ${cardName(card)}`}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface-3 text-muted ring-1 ring-line hover:text-fg"
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
