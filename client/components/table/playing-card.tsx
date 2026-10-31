"use client";

import type { PublicCard } from "@poker-platform/shared/types";
import { cn } from "@/components/ui/cn";
import type { CSSProperties } from "react";
import { cardLabel, RANK_LABEL, SUIT_SYMBOL } from "./format";
import { usePreferences, type DeckStyle } from "./preferences";

const SUIT_CLASS: Record<"two-color" | "four-color", Record<PublicCard["suit"], string>> = {
  "two-color": { h: "text-suit-red", d: "text-suit-red", c: "text-suit-black", s: "text-suit-black" },
  "four-color": { h: "text-suit-red", d: "text-suit-blue", c: "text-suit-green", s: "text-suit-black" },
};

function pixelSrc(card: PublicCard) {
  const rank = card.rank === "T" ? "10" : card.rank;
  return `/cards/${rank}${card.suit.toUpperCase()}.png`;
}

export type PlayingCardProps = {
  /** null renders the card back. */
  card: PublicCard | null;
  /** Width in px. Height follows a 5:7 ratio and every glyph scales with it. */
  width?: number;
  deck?: DeckStyle;
  /** Play the deal-in animation on mount. */
  animate?: boolean;
  delayMs?: number;
  dimmed?: boolean;
  highlight?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * Crisp CSS playing card. Size is driven by `width` (or a parent-provided `--card-w`), so the same
 * component serves seat thumbnails, the board and the viewer's hand.
 */
export function PlayingCard({
  card,
  width,
  deck,
  animate = false,
  delayMs = 0,
  dimmed = false,
  highlight = false,
  className,
  style,
}: PlayingCardProps) {
  const [prefs] = usePreferences();
  const mode = deck ?? prefs.deck;
  const sizeStyle: CSSProperties = {
    width: width ? `${width}px` : "var(--card-w, 48px)",
    height: width ? `${Math.round(width * 1.4)}px` : "calc(var(--card-w, 48px) * 1.4)",
    fontSize: width ? `${width * 0.42}px` : "calc(var(--card-w, 48px) * 0.42)",
    animationDelay: animate ? `${delayMs}ms` : undefined,
    ...style,
  };
  const common = cn(
    "relative shrink-0 select-none overflow-hidden rounded-[0.32em] transition-[opacity,filter,box-shadow] duration-200",
    animate && "animate-deal-in",
    dimmed && "opacity-40 saturate-50",
    highlight && "ring-2 ring-gold shadow-[0_0_0_3px_rgb(var(--gold)/0.25)]",
    className,
  );

  if (mode === "pixel") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={card ? pixelSrc(card) : "/cards/Blue_Backside.png"}
        alt={card ? cardLabel(card) : "Face-down card"}
        draggable={false}
        className={cn(common, "pixelated rounded-[0.18em] bg-white object-fill shadow-sm")}
        style={sizeStyle}
      />
    );
  }

  if (!card) {
    return (
      <div
        role="img"
        aria-label="Face-down card"
        className={cn(common, "border border-white/40 shadow-[0_1px_3px_rgb(0_0_0/0.5)]")}
        style={{
          ...sizeStyle,
          background:
            "repeating-linear-gradient(45deg, rgb(255 255 255 / 0.10) 0 1.5px, transparent 1.5px 6px), linear-gradient(160deg, #4b5f8a, #27355a)",
        }}
      >
        <div className="absolute inset-[0.14em] rounded-[0.22em] border border-white/20" />
      </div>
    );
  }

  const tone = SUIT_CLASS[mode][card.suit];
  const rank = RANK_LABEL[card.rank];
  return (
    <div
      role="img"
      aria-label={cardLabel(card)}
      className={cn(common, "bg-[#fbfbfa] shadow-[0_1px_2px_rgb(0_0_0/0.35),inset_0_0_0_1px_rgb(0_0_0/0.08)]", tone)}
      style={sizeStyle}
    >
      <div
        aria-hidden
        className="absolute left-[0.2em] top-[0.12em] flex flex-col items-center font-sans leading-none"
      >
        <span className={cn("font-bold tracking-[-0.06em]", rank.length > 1 ? "text-[0.92em]" : "text-[1.05em]")}>{rank}</span>
        <span className="mt-[0.06em] text-[0.82em] leading-none">{SUIT_SYMBOL[card.suit]}</span>
      </div>
      <span aria-hidden className="absolute bottom-[0.02em] right-[0.14em] text-[1.6em] leading-none">
        {SUIT_SYMBOL[card.suit]}
      </span>
    </div>
  );
}
