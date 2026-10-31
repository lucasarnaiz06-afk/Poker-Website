"use client";

import type { ChatMessage, TableView } from "@poker-platform/shared/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Play } from "lucide-react";
import { useEffect, useMemo, type CSSProperties } from "react";
import { BetChip } from "./bits";
import { Board, collectedPot, PotDisplay, ResultBanner, sidePaymentLines, summarizeWinners } from "./felt-center";
import { useElementSize } from "./hooks";
import { computeTableLayout, type Pt } from "./layout";
import { EmptySeat, Seat } from "./seat";

export type FeltProps = {
  view: TableView;
  now: number;
  inBB: boolean;
  onSit: (seat: number) => void;
  onStart?: () => void;
  starting?: boolean;
  bubbles?: Record<string, ChatMessage>;
  /** Called with true when the hand result can't fit on the felt and should be shown in the dock. */
  onResultInDock?: (inDock: boolean) => void;
};

export function Felt({ view, now, inBB, onSit, onStart, starting, bubbles, onResultInDock }: FeltProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const max = view.settings.maxPlayers;
  const hand = view.hand;
  const heroSeat = view.viewer.seat;
  const viewerSeated = heroSeat !== null;
  const tableFull = view.seats.length >= max;
  const occupiedKey = view.seats.map((s) => s.seat).join(",");
  const holeCards = view.settings.variant === "PLO" ? 4 : 2;
  const boards = hand ? Math.max(1, hand.boards.length) : 1;
  const sidePots = Boolean(hand && hand.pots.filter((p) => p.amount > 0).length > 1);
  const potCollected = hand ? collectedPot(hand) : 0;
  const resultLines = hand?.result ? summarizeWinners(view).length : 0;
  const resultExtras = hand?.result ? sidePaymentLines(view).length + (hand.result.uncalledReturn ? 1 : 0) : 0;

  const layout = useMemo(
    () =>
      computeTableLayout({
        width: size.width,
        height: size.height,
        maxPlayers: max,
        anchorSeat: heroSeat ?? 1,
        heroSeat,
        occupied: new Set(occupiedKey ? occupiedKey.split(",").map(Number) : []),
        holeCards,
        boards,
        sidePots,
        result: resultLines > 0 ? { lines: resultLines, extras: resultExtras } : null,
      }),
    [size.width, size.height, max, heroSeat, occupiedKey, holeCards, boards, sidePots, resultLines, resultExtras],
  );
  const resultOnFelt = Boolean(hand?.result && layout?.banner.fits);
  const resultInDock = Boolean(hand?.result && layout && !layout.banner.fits);
  useEffect(() => onResultInDock?.(resultInDock), [resultInDock, onResultInDock]);

  const winTotals = useMemo(() => {
    const m = new Map<number, number>();
    for (const w of hand?.result?.winners ?? []) m.set(w.seat, (m.get(w.seat) ?? 0) + w.amount);
    return m;
  }, [hand?.result]);

  // Centre text when there is no live hand.
  const activeCount = view.seats.filter((s) => s.status !== "SITTING_OUT").length;
  const isHost = view.viewer.userId === view.hostUserId;
  const nextIn = view.nextHandAt ? Math.max(0, Math.ceil((Date.parse(view.nextHandAt) - now) / 1000)) : null;
  let centreMessage: string | null = null;
  if (!hand || (hand.phase === "COMPLETE" && !hand.result)) {
    if (view.status === "PAUSED") centreMessage = "Game paused";
    else if (view.status === "CLOSED") centreMessage = "This table is closed";
    else if (activeCount < 2) centreMessage = view.seats.length === 0 ? "Pick a seat to start" : "Waiting for players…";
    else if (!view.settings.autoStart) centreMessage = isHost ? null : "Waiting for the host to start";
    else centreMessage = nextIn !== null ? `Next hand in ${nextIn}s` : "Starting soon…";
  }
  const showStart = !hand && view.status === "WAITING" && !view.settings.autoStart && isHost && activeCount >= 2;
  const seatsByNo = new Map(view.seats.map((s) => [s.seat, s]));
  const chipSize = layout?.m.tier === "sm" ? "sm" : layout?.m.tier === "lg" ? "lg" : "md";

  return (
    <div ref={ref} className="relative h-full w-full select-none" aria-label="Poker table">
      {layout && (
        <>
          {/* Rail + felt */}
          <div
            aria-hidden
            className="absolute rounded-[50%]"
            style={{
              left: layout.felt.left,
              top: layout.felt.top,
              width: layout.felt.width,
              height: layout.felt.height,
              background: "linear-gradient(180deg, rgb(var(--rail)) 0%, rgb(8 10 13) 100%)",
              boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.06), 0 24px 70px rgb(0 0 0 / 0.55)",
            }}
          >
            <div
              className="absolute rounded-[50%]"
              style={{
                inset: layout.felt.rail,
                background: "radial-gradient(ellipse at 50% 42%, rgb(var(--felt)) 0%, rgb(var(--felt)) 30%, rgb(var(--felt-dark)) 100%)",
                boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.4), inset 0 10px 40px rgb(0 0 0 / 0.35)",
              }}
            />
            <div
              className="absolute rounded-[50%] border border-white/[0.05]"
              style={{ inset: layout.felt.rail + Math.min(layout.felt.width, layout.felt.height) * 0.1 }}
            />
          </div>

          {/* Board */}
          {hand && (
            <div
              data-part="board"
              className="absolute z-[6] -translate-x-1/2 -translate-y-1/2"
              style={{ left: layout.board.x, top: layout.board.y }}
            >
              <Board
                hand={hand}
                cardW={layout.board.innerW}
                gap={layout.board.gap}
                highlightBoards={hand.result?.winners.filter((w) => w.seat === heroSeat).map((w) => w.boardIndex)}
              />
            </div>
          )}

          {/* Pot (live hand) */}
          {hand && !hand.result && (potCollected > 0 || hand.isBombPot) && (
            <div
              data-part="pot"
              className={cn(
                "absolute z-[6] flex items-center gap-1.5",
                layout.pot.mode === "above" ? "-translate-x-1/2 -translate-y-full flex-col-reverse" : "-translate-x-full -translate-y-1/2 flex-col items-end",
              )}
              style={{
                left: layout.pot.x,
                top: layout.pot.y,
                width: layout.pot.mode === "above" ? layout.pot.width : undefined,
                maxWidth: layout.pot.width,
              }}
            >
              {potCollected > 0 && (
                <PotDisplay
                  hand={hand}
                  bigBlind={view.settings.bigBlind}
                  inBB={inBB}
                  compact={layout.m.tier === "sm" || layout.pot.mode === "beside"}
                />
              )}
              {hand.isBombPot && (
                <span className="rounded-full bg-warning/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black">
                  Bomb pot{hand.boards.length > 1 ? " · double board" : ""}
                </span>
              )}
            </div>
          )}

          {/* Hand result: a compact banner in a lane kept clear of the board and every seat. */}
          {resultOnFelt && (
            <div
              data-part="banner"
              className={cn("absolute z-[8] flex -translate-x-1/2 justify-center", layout.banner.side === "above" ? "-translate-y-full items-end" : "items-start")}
              style={{ left: layout.banner.x, top: layout.banner.y, width: layout.banner.width }}
            >
              <ResultBanner view={view} inBB={inBB} maxHeight={layout.banner.maxHeight} compact={layout.m.tier === "sm"} />
            </div>
          )}

          {/* Centre message / start button when there's no hand */}
          {(centreMessage || (showStart && onStart)) && (
            <div
              className="absolute z-[8] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
              style={{ left: layout.message.x, top: layout.message.y }}
            >
              {centreMessage && (
                <p className="whitespace-nowrap rounded-full bg-black/30 px-3 py-1 text-sm text-fg/80" role="status">
                  {centreMessage}
                </p>
              )}
              {showStart && onStart && (
                <Button onClick={onStart} loading={starting} leftIcon={<Play />} size="md">
                  Start game
                </Button>
              )}
            </div>
          )}

          {/* Seats and bets (the dealer button rides on its seat's plate) */}
          {[...layout.seats.values()].map((spot) => {
            const s = seatsByNo.get(spot.seat);
            if (!s) {
              return (
                <div key={spot.seat} className="absolute z-[5]" style={{ left: spot.x, top: spot.y }}>
                  <EmptySeat seatNo={spot.seat} m={layout.m} canSit={!viewerSeated && !tableFull} onSit={onSit} />
                </div>
              );
            }
            const marker =
              hand && hand.phase !== "COMPLETE"
                ? hand.straddleSeat === spot.seat
                  ? "STR"
                  : hand.bigBlindSeat === spot.seat
                    ? "BB"
                    : hand.smallBlindSeat === spot.seat
                      ? "SB"
                      : null
                : null;
            const won = winTotals.get(spot.seat) ?? 0;
            return (
              <div key={spot.seat}>
                <div className={cn("absolute", spot.hero ? "z-[7]" : "z-[5]")} style={{ left: spot.x, top: spot.y }}>
                  <Seat
                    seat={s}
                    view={view}
                    hero={spot.hero}
                    m={layout.m}
                    now={now}
                    inBB={inBB}
                    winner={won > 0}
                    blindMarker={marker}
                    dealer={Boolean(hand && hand.buttonSeat === spot.seat)}
                    dealerSide={spot.x < layout.cx - 4 ? "right" : spot.x > layout.cx + 4 ? "left" : "right"}
                    dealKey={hand?.handId ?? "none"}
                    bubble={bubbles?.[s.userId] ?? null}
                  />
                </div>
                {s.bet > 0 && !hand?.result && (
                  <div
                    data-part="chip"
                    className="absolute z-[6] -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-200"
                    style={{ left: spot.chip.x, top: spot.chip.y }}
                  >
                    <BetChip amount={s.bet} bigBlind={view.settings.bigBlind} inBB={inBB} size={chipSize} />
                  </div>
                )}
                {hand?.result && won > 0 && (
                  <WinnerChip
                    key={`${hand.handId}-${spot.seat}`}
                    from={layout.potCentre}
                    to={spot.chip}
                    amount={won}
                    bigBlind={view.settings.bigBlind}
                    inBB={inBB}
                    size={chipSize}
                  />
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * The pot sliding from the middle to a winner, where it stays as a gold "+amount" chip. It travels
 * one layer below the result banner (z-[7] vs z-[8]): it slides out from under the banner (which
 * covers the pot's spot) and never crosses the banner's text.
 */
function WinnerChip({
  from,
  to,
  amount,
  bigBlind,
  inBB,
  size,
}: {
  from: Pt;
  to: Pt;
  amount: number;
  bigBlind: number;
  inBB: boolean;
  size: "sm" | "md" | "lg";
}) {
  // Positioned at the destination; a transform-only keyframe animates it in from the pot, so the
  // chip always ends up in the right place (and reduced motion simply skips the flight).
  const fly = { "--fly-x": `${from.x - to.x}px`, "--fly-y": `${from.y - to.y}px` } as CSSProperties;
  return (
    <div data-part="chip" className="absolute z-[7] -translate-x-1/2 -translate-y-1/2" style={{ left: to.x, top: to.y }}>
      <div className="animate-fly-in" style={fly}>
        <BetChip amount={amount} bigBlind={bigBlind} inBB={inBB} win size={size} />
      </div>
    </div>
  );
}
