"use client";

import type { ChatMessage, PublicCard, TableSeatView, TableView } from "@poker-platform/shared/types";
import { cn } from "@/components/ui/cn";
import { Plus, WifiOff } from "lucide-react";
import type { CSSProperties } from "react";
import { Avatar, Pill, TimerRing } from "./bits";
import { cardsLabel, formatAmount, formatChips } from "./format";
import { BACK_PEEK, fanOverlap, fanWidth, HERO_CARD_GAP, PLATE_OVERLAP, TAG_GAP, TAG_H, type SeatMetrics } from "./layout";
import { PlayingCard } from "./playing-card";

type Tone = "neutral" | "accent" | "gold" | "danger" | "info";
type ActionLabel = { text: string; tone: Tone };

export function actionLabel(a: TableSeatView["lastAction"], bigBlind: number, inBB: boolean): ActionLabel | null {
  if (!a) return null;
  const amt = a.amount !== null ? formatAmount(a.amount, bigBlind, inBB) : "";
  switch (a.type) {
    case "fold":
      return { text: "Fold", tone: "neutral" };
    case "check":
      return { text: "Check", tone: "neutral" };
    case "call":
      return { text: `Call ${amt}`, tone: "info" };
    case "bet":
      return { text: `Bet ${amt}`, tone: "accent" };
    case "raise":
      return { text: `Raise to ${amt}`, tone: "accent" };
    case "allin":
      return { text: "All-in", tone: "danger" };
    case "straddle":
      return { text: `Straddle ${amt}`, tone: "gold" };
    case "ante":
      return { text: `Ante ${amt}`, tone: "gold" };
    case "post":
      return null;
  }
}

export type SeatProps = {
  seat: TableSeatView;
  view: TableView;
  /** The viewer's own seat: large cards and a compact plate with the avatar inside. */
  hero: boolean;
  m: SeatMetrics;
  now: number;
  inBB: boolean;
  winner: boolean;
  blindMarker: "SB" | "BB" | "STR" | null;
  /** Holds the dealer button; drawn on the plate's corner facing the table centre. */
  dealer: boolean;
  dealerSide: "left" | "right";
  dealKey: string;
  /** Latest chat line / emote from this player, shown briefly above the seat. */
  bubble?: ChatMessage | null;
};

function useSeatState({ seat, view, now, inBB, hero }: Pick<SeatProps, "seat" | "view" | "now" | "inBB" | "hero">) {
  const hand = view.hand;
  const isToAct = Boolean(hand && hand.toActSeat === seat.seat && hand.phase !== "COMPLETE");
  const sittingOut = seat.status === "SITTING_OUT";
  const dim = (seat.folded && !hero) || sittingOut || (!seat.inHand && hand !== null && hand.phase !== "COMPLETE");

  let fraction = 0;
  let secondsLeft = 0;
  if (isToAct && hand?.actionDeadline) {
    const remaining = Math.max(0, Date.parse(hand.actionDeadline) - now);
    secondsLeft = Math.ceil(remaining / 1000);
    const total = hand.usingTimeBank ? Math.max(view.settings.timeBankSec, secondsLeft, 1) : Math.max(view.settings.actionTimeSec, 1);
    fraction = remaining / 1000 / total;
  }
  const timerTone: "normal" | "low" | "bank" = hand?.usingTimeBank ? "bank" : fraction < 0.25 ? "low" : "normal";

  const label = actionLabel(seat.lastAction, view.settings.bigBlind, inBB);
  const statusLabel: ActionLabel | null = sittingOut
    ? { text: "Sitting out", tone: "neutral" }
    : seat.status === "WAITING_BB"
      ? { text: "Waiting for BB", tone: "neutral" }
      : null;
  const faces = seat.holeCards && seat.holeCards.length > 0 ? seat.holeCards : null;
  const allInNow = seat.allIn && seat.stack === 0;
  // Shown hands name the hand; "All-in" already replaces the stack line, so don't repeat it.
  const tag: ActionLabel | null =
    faces && seat.handName
      ? { text: seat.handName, tone: "gold" }
      : allInNow && seat.lastAction?.type === "allin"
        ? statusLabel
        : (label ?? statusLabel);
  return { hand, isToAct, sittingOut, dim, fraction, secondsLeft, timerTone, label, faces, allInNow, tag };
}

function describe(seat: TableSeatView, hero: boolean, s: ReturnType<typeof useSeatState>, winner: boolean) {
  return [
    seat.displayName,
    hero ? "(you)" : null,
    s.allInNow ? "all-in" : `${formatChips(seat.stack)} chips`,
    seat.folded ? "folded" : null,
    s.sittingOut ? "sitting out" : null,
    !seat.connected ? "disconnected" : null,
    seat.isNit ? "nit" : null,
    s.label ? s.label.text : null,
    s.faces ? `shows ${cardsLabel(s.faces)}` : null,
    seat.handName ? seat.handName : null,
    s.isToAct ? `to act, ${s.secondsLeft} seconds left` : null,
    winner ? "winner" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

const TEXT = {
  sm: { name: "text-[11px] leading-[14px]", stack: "text-[13px] leading-4" },
  md: { name: "text-[11px] leading-4", stack: "text-[13px] leading-4" },
  lg: { name: "text-[12px] leading-4", stack: "text-[15px] leading-5" },
} as const;

function DealerButton({ size, className, style }: { size: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      role="img"
      aria-label="Dealer button"
      data-part="dealer"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-white font-bold leading-none text-black shadow-[0_1px_3px_rgb(0_0_0/0.5)]",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), ...style }}
    >
      D
    </span>
  );
}

function Markers({ seat, blindMarker, hero }: { seat: TableSeatView; blindMarker: SeatProps["blindMarker"]; hero: boolean }) {
  return (
    <>
      {hero && seat.isNit && <span className="shrink-0 rounded bg-warning px-1 text-[9px] font-bold leading-[14px] text-black">NIT</span>}
      {blindMarker && (
        <span className="shrink-0 rounded bg-white/10 px-1 text-[9px] font-bold leading-[14px] text-fg/80" title={blindMarker === "STR" ? "Straddle" : blindMarker === "SB" ? "Small blind" : "Big blind"}>
          {blindMarker}
        </span>
      )}
    </>
  );
}

/** Rough width of a 10px semibold tag, to pick the long or short hand name before rendering. */
const tagFits = (text: string, maxWidth: number) => text.length * 5.3 + 18 <= maxWidth;

function SeatTag({ tag, top, maxWidth }: { tag: ActionLabel | null; top: number; maxWidth: number }) {
  if (!tag) return null;
  // "Full House, Kings full of Sevens" -> "Full House" when the seat is narrow.
  const text = tagFits(tag.text, maxWidth) ? tag.text : tag.text.split(",")[0];
  return (
    <div data-part="tag" className="absolute left-0 z-[4] flex w-0 justify-center" style={{ top }}>
      <Pill tone={tag.tone} className="shrink-0 bg-surface-2 px-2 text-[10px] ring-1 ring-line" style={{ height: TAG_H, maxWidth }}>
        <span className="truncate" title={tag.text}>
          {text}
        </span>
      </Pill>
    </div>
  );
}

function Bubble({ bubble, bottom }: { bubble: ChatMessage; bottom: number }) {
  return (
    <div key={bubble.id} aria-hidden className="absolute left-0 z-20 -translate-x-1/2 animate-rise-in" style={{ bottom }}>
      {bubble.emoteId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/emotes/${encodeURIComponent(bubble.emoteId)}.png`} alt="" className="pixelated h-10 w-10 drop-shadow-lg" draggable={false} />
      ) : (
        <span className="block max-w-[160px] truncate rounded-xl rounded-bl-sm bg-white px-2.5 py-1 text-xs font-medium text-black shadow-pop">
          {bubble.text}
        </span>
      )}
    </div>
  );
}

/** A fanned row of cards whose bottom edge sits at y = `bottom` (relative to the seat anchor). */
function CardFan({
  cards,
  count,
  width,
  hero,
  bottom,
  dealKey,
  rotate,
  className,
  style,
}: {
  cards: PublicCard[] | null;
  count: number;
  width: number;
  hero: boolean;
  bottom: number;
  dealKey: string;
  rotate: number;
  className?: string;
  style?: CSSProperties;
}) {
  const overlap = cards ? fanOverlap(count, hero) : count > 2 ? 0.62 : 0.42;
  const total = cards ? fanWidth(count, width, hero) : width + (count - 1) * width * (1 - overlap);
  const h = Math.round(width * 1.4);
  const mid = (count - 1) / 2;
  return (
    <div aria-hidden data-part={cards ? "cards" : "backs"} className={cn("absolute", className)} style={{ left: -total / 2, top: bottom - h, width: total, height: h, ...style }}>
      {Array.from({ length: count }).map((_, i) => (
        // The wrapper carries the fan rotation so the deal animation (a transform) can't cancel it.
        <div
          key={`${dealKey}-${i}`}
          className="absolute top-0"
          style={{
            left: i * width * (1 - overlap),
            transform: rotate ? `rotate(${(i - mid) * rotate}deg)` : undefined,
            transformOrigin: "50% 100%",
          }}
        >
          <PlayingCard card={cards ? cards[i] : null} width={width} animate delayMs={i * 60} />
        </div>
      ))}
    </div>
  );
}

export function Seat(props: SeatProps) {
  return props.hero ? <HeroSeat {...props} /> : <OtherSeat {...props} />;
}

function OtherSeat({ seat, view, m, now, inBB, winner, blindMarker, dealer, dealerSide, dealKey, bubble }: SeatProps) {
  const s = useSeatState({ seat, view, now, inBB, hero: false });
  const A = m.avatar;
  const ring = A + 8;
  const showBacks = !s.faces && seat.inHand && !seat.folded && seat.cardCount > 0;
  const backH = Math.round(m.backW * 1.4);
  const plateTop = A / 2 - PLATE_OVERLAP;
  const text = TEXT[m.tier];
  return (
    <div role="group" aria-label={describe(seat, false, s, winner)} className="absolute left-0 top-0 h-0 w-0">
      {showBacks && (
        <CardFan
          cards={null}
          count={seat.cardCount}
          width={m.backW}
          hero={false}
          bottom={-(A / 2 + backH * BACK_PEEK) + backH}
          dealKey={dealKey}
          rotate={seat.cardCount > 2 ? 6 : 10}
          className={cn("z-[1]", s.dim && "opacity-60")}
        />
      )}

      {bubble && <Bubble bubble={bubble} bottom={A / 2 + (s.faces || showBacks ? m.cardW * 0.7 : 4) + 8} />}

      {/* Avatar + timer */}
      <div data-part="avatar" className="absolute left-0 top-0 z-[2] -translate-x-1/2 -translate-y-1/2" style={{ width: ring, height: ring }}>
        {s.isToAct && <TimerRing size={ring} fraction={s.fraction} tone={s.timerTone} />}
        <div
          className={cn(
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 transition-[box-shadow,opacity] duration-200",
            winner ? "ring-gold shadow-[0_0_20px_rgb(var(--gold)/0.45)]" : s.isToAct ? "ring-transparent" : "ring-black/30",
            s.dim && "opacity-50",
          )}
        >
          <Avatar name={seat.displayName} id={seat.userId} url={seat.avatarUrl} size={A} />
        </div>
        {seat.isNit && (
          <Pill tone="warning" className="absolute -left-2 -top-1 h-4 bg-warning px-1 text-[9px] text-black shadow">
            NIT
          </Pill>
        )}
        {!seat.connected && (
          <span
            className="absolute -left-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-surface-3 text-danger ring-2 ring-bg"
            title="Disconnected"
          >
            <WifiOff className="h-3 w-3" aria-hidden />
          </span>
        )}
        {s.isToAct && (s.hand?.usingTimeBank || s.secondsLeft <= 10) && !s.faces && (
          <span
            className={cn(
              "absolute -right-2 -top-1 rounded-full px-1.5 text-[10px] font-semibold leading-4 tabular shadow",
              s.hand?.usingTimeBank ? "bg-warning text-black" : "bg-danger text-white",
            )}
          >
            {s.secondsLeft}s
          </span>
        )}
      </div>

      {/* Shown cards sit in front of the avatar, fully readable, above the name plate. */}
      {s.faces && (
        <CardFan cards={s.faces} count={s.faces.length} width={m.cardW} hero={false} bottom={A / 2 - 2} dealKey={`${dealKey}-shown`} rotate={0} className="z-[3]" />
      )}

      {/* Name plate */}
      <div
        data-part="plate"
        className={cn(
          "absolute z-[4] flex flex-col justify-center rounded-lg border bg-surface/95 px-1.5 text-center shadow-panel backdrop-blur transition-colors duration-200",
          winner ? "border-gold/80 shadow-[0_0_0_1px_rgb(var(--gold)/0.35)]" : s.isToAct ? "border-accent/70" : "border-line",
          s.dim && "opacity-60",
        )}
        style={{ left: -m.plateW / 2, top: plateTop, width: m.plateW, height: m.plateH }}
      >
        <div className="flex min-w-0 items-center justify-center gap-1">
          <span className={cn("truncate font-medium text-muted", text.name)}>{seat.displayName}</span>
          <Markers seat={seat} blindMarker={blindMarker} hero={false} />
        </div>
        <div className={cn("truncate font-semibold tabular", text.stack, s.allInNow ? "text-danger" : "text-fg")}>
          {s.allInNow ? "All-in" : formatAmount(seat.stack, view.settings.bigBlind, inBB)}
        </div>
      </div>
      {dealer && (
        <DealerButton
          size={m.dealer}
          className="absolute z-[5]"
          style={{
            left: (dealerSide === "right" ? m.plateW / 2 - 4 : -m.plateW / 2 + 4) - m.dealer / 2,
            top: plateTop - m.dealer / 2,
          }}
        />
      )}
      <SeatTag
        tag={s.tag}
        top={plateTop + m.plateH + TAG_GAP}
        maxWidth={Math.max(m.plateW + 16, s.faces ? fanWidth(s.faces.length, m.cardW, false) : 0)}
      />
    </div>
  );
}

function HeroSeat({ seat, view, m, now, inBB, winner, blindMarker, dealer, dealKey, bubble }: SeatProps) {
  const s = useSeatState({ seat, view, now, inBB, hero: true });
  const cards = s.faces;
  const count = cards ? cards.length : seat.inHand && seat.cardCount > 0 ? seat.cardCount : 0;
  const text = TEXT[m.tier];
  const ring = m.heroAvatar + 6;
  return (
    <div role="group" aria-label={describe(seat, true, s, winner)} className="absolute left-0 top-0 h-0 w-0">
      {count > 0 && (
        <CardFan
          cards={cards}
          count={count}
          width={m.heroCardW}
          hero
          bottom={-m.plateH / 2 - HERO_CARD_GAP}
          dealKey={dealKey}
          rotate={count > 2 ? 3 : 4}
          className={cn("z-[3] drop-shadow-[0_3px_8px_rgb(0_0_0/0.4)] transition-opacity duration-200", seat.folded && "opacity-45")}
        />
      )}

      {bubble && <Bubble bubble={bubble} bottom={m.plateH / 2 + HERO_CARD_GAP + m.heroCardW * 1.4 + 8} />}

      <div
        data-part="plate"
        className={cn(
          "absolute z-[4] flex items-center gap-1.5 rounded-xl border bg-surface/95 pl-1.5 pr-2 shadow-panel backdrop-blur transition-colors duration-200",
          winner ? "border-gold/80 shadow-[0_0_0_1px_rgb(var(--gold)/0.35)]" : s.isToAct ? "border-accent/70" : "border-accent/30",
          s.sittingOut && "opacity-70",
        )}
        style={{ left: -m.heroPlateW / 2, top: -m.plateH / 2, width: m.heroPlateW, height: m.plateH }}
      >
        <div className="relative shrink-0" style={{ width: ring, height: ring }}>
          {s.isToAct && <TimerRing size={ring} fraction={s.fraction} tone={s.timerTone} />}
          <div className={cn("absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full", winner && "ring-2 ring-gold")}>
            <Avatar name={seat.displayName} id={seat.userId} url={seat.avatarUrl} size={m.heroAvatar} />
          </div>
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="flex min-w-0 items-center gap-1">
            <span className={cn("truncate font-medium text-muted", text.name)}>{seat.displayName}</span>
            <Markers seat={seat} blindMarker={blindMarker} hero />
          </div>
          <div className={cn("truncate font-semibold tabular", text.stack, s.allInNow ? "text-danger" : "text-fg")}>
            {s.allInNow ? "All-in" : formatAmount(seat.stack, view.settings.bigBlind, inBB)}
          </div>
        </div>
        {!seat.connected && <WifiOff className="h-3.5 w-3.5 shrink-0 text-danger" aria-label="Disconnected" />}
        {dealer && <DealerButton size={m.dealer} />}
      </div>
      <SeatTag tag={s.tag} top={m.plateH / 2 + TAG_GAP} maxWidth={m.heroPlateW + 16} />
    </div>
  );
}

export function EmptySeat({ seatNo, m, canSit, onSit }: { seatNo: number; m: SeatMetrics; canSit: boolean; onSit: (seat: number) => void }) {
  const size = m.avatar;
  if (!canSit) {
    return (
      <div aria-hidden className="absolute left-0 top-0 h-0 w-0">
        <div className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/[0.08]" style={{ width: size - 6, height: size - 6 }} />
      </div>
    );
  }
  return (
    <div className="absolute left-0 top-0 h-0 w-0">
      <button
        type="button"
        onClick={() => onSit(seatNo)}
        aria-label={`Sit in seat ${seatNo}`}
        className="group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-dashed border-white/25 bg-black/20 text-fg/80 transition-colors hover:border-accent hover:bg-accent/15 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ width: size + 6, height: size + 6 }}
      >
        <Plus className="h-4 w-4" aria-hidden />
        <span className="text-[11px] font-semibold leading-3">Sit</span>
      </button>
    </div>
  );
}
