"use client";

import type { HandView } from "@poker-platform/shared/hands/client";
import { buildReplayFrames, equitySpots, type ReplayFrame, type ReplaySeat } from "@poker-platform/shared/hands/client";
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BetChip, ChipStack } from "@/components/table/bits";
import { useElementSize } from "@/components/table/hooks";
import { metricsFor, type SeatMetrics } from "@/components/table/layout";
import { ovalPoints } from "@/components/table/logic";
import { Avatar, Badge, Card, CardHeader, Chips, formatChips, IconButton, InfoTip, Segmented } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { useEquityWorker } from "@/components/tools/use-equity";
import { PlayingCard } from "@/components/table/playing-card";
import { CardRow, TextWithCards, toPublicCard } from "./cards";

/** One sentence for the "Expected (all-in)" figure, shown as a tooltip wherever it appears. */
export const ALL_IN_EV_EXPLAINER =
  "What this player would win or lose on average if the all-in were dealt out many times, given everyone's cards.";

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatChips(Math.abs(n))}`;

type Speed = "0.5" | "1" | "2";
type EquityMap = Map<number, Map<string, number>>;

/** Height of the badge row under a seat's plate. */
const BADGE_H = 22;

/**
 * Replay geometry in px, sized like the live table (same seat metrics and card sizes): seats sit on
 * the rail of an oval that fills the container, the board is as large as the felt allows.
 */
function replayLayout(width: number, height: number, seats: number, boards: number) {
  const portrait = width / height < 0.95;
  // The replay box is smaller than a live table's felt; size seats as the table would at ~1.3x that
  // area so cards and plates read at the same size as in a real game.
  const m = metricsFor(width * 1.3, height * 1.3, portrait, seats);
  const cardH = Math.round(m.cardW * 1.4);
  const seatH = cardH + 4 + m.plateH + BADGE_H;
  const seatW = m.plateW + 16;
  const rx = Math.max(40, width / 2 - seatW / 2 - 6);
  const ry = Math.max(40, height / 2 - seatH / 2 - 10);
  const cx = width / 2;
  const cy = height / 2;
  const points = ovalPoints(seats, rx, ry).map((p) => ({ x: cx + p.x, y: cy + p.y }));
  const gap = 4;
  // The board must fit inside the felt between the side seats.
  const maxBoard = Math.floor(((rx - seatW / 2) * 2 * 0.9 - 4 * gap) / 5);
  // …and between the top and bottom seats, with the pot label above it.
  const rows = Math.max(1, boards);
  const maxBoardH = Math.floor((2 * ry - seatH - 28 - (rows - 1) * gap) / (1.4 * rows));
  const boardW = Math.max(24, Math.min(Math.round(m.cardW * 1.6), maxBoard, maxBoardH, 64));
  return { m, cardH, seatH, rx, ry, cx, cy, points, boardW, gap };
}

const STREET_ORDER = ["PREFLOP", "FLOP", "TURN", "RIVER"] as const;

function SeatView({
  seat,
  frame,
  view,
  equity,
  x,
  y,
  m,
  cardH,
  toward,
}: {
  seat: ReplaySeat;
  frame: ReplayFrame;
  view: HandView;
  equity: number | null;
  x: number;
  y: number;
  m: SeatMetrics;
  cardH: number;
  /** Where the bet chip sits (toward the middle of the table). */
  toward: { x: number; y: number };
}) {
  const active = frame.actorId === seat.userId;
  const player = view.players.find((p) => p.userId === seat.userId);
  const holeCount = view.variant === "PLO" ? 4 : 2;
  const isLast = frame.kind === "end";
  const net = player?.net ?? 0;
  const text = m.tier === "lg" ? { name: "text-[12px] leading-4", stack: "text-[15px] leading-5" } : { name: "text-[11px] leading-[14px]", stack: "text-[13px] leading-4" };
  // Same fan as the table: PLO cards overlap more.
  const overlap = holeCount > 2 ? -Math.round(m.cardW * 0.45) : -Math.round(m.cardW * 0.06);
  const ev = player?.allInEvNet;
  return (
    <>
      <div
        className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
        style={{ left: x, top: y, width: m.plateW + 16 }}
      >
        <div className={cn("flex items-end justify-center", seat.folded && "opacity-40")} style={{ height: cardH, marginBottom: 4 }}>
          {seat.cards || !seat.folded ? (
            <span className="flex">
              {Array.from({ length: seat.cards?.length || holeCount }).map((_, i) => {
                const code = seat.cards?.[i] ?? null;
                return (
                  <PlayingCard
                    key={`${code ?? "back"}-${i}`}
                    card={code ? toPublicCard(code) : null}
                    width={m.cardW}
                    dimmed={seat.folded}
                    style={i > 0 ? { marginLeft: overlap } : undefined}
                  />
                );
              })}
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            "flex flex-col justify-center rounded-lg border bg-surface/95 px-1.5 text-center shadow-panel transition-colors duration-150",
            active ? "border-accent/70 ring-2 ring-accent/25" : seat.isViewer ? "border-accent/30" : "border-line",
            seat.folded && "opacity-60",
          )}
          style={{ width: m.plateW, height: m.plateH }}
        >
          <div className="flex min-w-0 items-center justify-center gap-1">
            <span className={cn("truncate font-medium text-muted", text.name)}>{seat.isViewer ? "You" : seat.name}</span>
            <span className="shrink-0 rounded bg-white/10 px-1 text-[9px] font-bold leading-[14px] text-fg/80">{seat.position}</span>
          </div>
          <div className={cn("truncate font-semibold tabular", text.stack, seat.allIn && seat.stack === 0 ? "text-danger" : "text-fg")}>
            {seat.allIn && seat.stack === 0 ? "All-in" : formatChips(seat.stack)}
          </div>
        </div>
        <div className="mt-1 flex flex-nowrap items-center justify-center gap-1 overflow-hidden" style={{ height: BADGE_H - 4 }}>
          {isLast && net !== 0 ? (
            <Badge tone={net > 0 ? "accent" : "danger"} className="tabular">
              {signed(net)}
            </Badge>
          ) : seat.lastAction && !seat.handName ? (
            <Badge tone={seat.lastAction === "Fold" ? "neutral" : "outline"}>{seat.lastAction}</Badge>
          ) : null}
          {seat.handName && frame.kind !== "end" ? <Badge tone="gold">{seat.handName.split(",")[0]}</Badge> : null}
          {equity !== null && !seat.folded ? (
            <Badge tone="info" className="tabular" title="Chance to win from here">
              {Math.round(equity * 100)}%
            </Badge>
          ) : null}
          {frame.allIn && ev !== null && ev !== undefined && !seat.folded ? (
            <Badge tone="gold" className="tabular" title={`Expected (all-in): ${signed(ev)}. ${ALL_IN_EV_EXPLAINER}`}>
              Exp. {signed(ev)}
            </Badge>
          ) : null}
        </div>
      </div>
      {seat.bet > 0 ? (
        <div className="absolute z-0 -translate-x-1/2 -translate-y-1/2" style={{ left: toward.x, top: toward.y }}>
          <BetChip amount={seat.bet} bigBlind={view.bigBlind} inBB={false} size="sm" />
        </div>
      ) : null}
    </>
  );
}

export function HandReplayer({ view }: { view: HandView }) {
  const frames = useMemo(() => buildReplayFrames(view), [view]);
  const maxBoards = useMemo(() => Math.max(1, ...frames.map((f) => f.boards.length)), [frames]);
  const [tableRef, size] = useElementSize<HTMLDivElement>();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1");
  const [equity, setEquity] = useState<EquityMap>(new Map());
  const { run } = useEquityWorker();
  const listRef = useRef<HTMLOListElement>(null);
  const frame = frames[Math.min(index, frames.length - 1)]!;
  const last = frames.length - 1;

  // Equity at every spot where all live hands are known.
  useEffect(() => {
    let cancelled = false;
    const spots = equitySpots(frames);
    (async () => {
      for (const spot of spots) {
        const res = await run({
          kind: "hands",
          variant: view.variant,
          hands: spot.hands,
          board: spot.board,
          dead: [],
          iterations: 15_000,
          maxExactEvaluations: 1_000_000,
        });
        if (cancelled) return;
        if (res.ok) {
          setEquity((prev) => {
            const next = new Map(prev);
            next.set(spot.frameIndex, new Map(spot.playerIds.map((id, i) => [id, res.results[i]!.equity])));
            return next;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [frames, run, view.variant]);

  const currentEquity = useMemo(() => {
    const live = frame.seats.filter((s) => !s.folded).map((s) => s.userId).join(",");
    const board = (frame.boards[0] ?? []).join("");
    let best: Map<string, number> | null = null;
    for (const [fi, values] of equity) {
      if (fi > frame.index) continue;
      const f = frames[fi]!;
      if (f.seats.filter((s) => !s.folded).map((s) => s.userId).join(",") !== live) continue;
      if ((f.boards[0] ?? []).join("") !== board) continue;
      best = values;
    }
    return best;
  }, [equity, frame, frames]);

  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, last)), 1100 / Number(speed));
    return () => clearTimeout(t);
  }, [playing, index, last, speed]);

  // Keep the current step visible inside the actions list. Only the list scrolls, never the page
  // (scrollIntoView / focus would scroll every ancestor).
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-frame="${index}"]`);
    if (!list || !item || list.scrollHeight <= list.clientHeight) return;
    const top = item.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    if (top < list.scrollTop || top + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3), behavior: "smooth" });
    }
  }, [index]);

  const step = useCallback((delta: number) => {
    setPlaying(false);
    setIndex((i) => Math.max(0, Math.min(last, i + delta)));
  }, [last]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      setPlaying((p) => (index >= last ? (setIndex(0), true) : !p));
    }
  };

  const streetStart = (street: (typeof STREET_ORDER)[number]) => frames.findIndex((f) => f.street === street && (street === "PREFLOP" || f.kind === "street"));
  const resultStart = frames.findIndex((f) => f.kind === "showdown" || f.kind === "award");

  const ordered = [...frame.seats];
  const viewerIdx = Math.max(0, ordered.findIndex((s) => s.isViewer));
  const rotated = [...ordered.slice(viewerIdx), ...ordered.slice(0, viewerIdx)];
  const collected = frame.pot - frame.seats.reduce((n, x) => n + x.bet, 0);
  const geo = size.width > 50 && size.height > 50 ? replayLayout(size.width, size.height, rotated.length, maxBoards) : null;

  let lastHeader = "";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="overflow-hidden" onKeyDown={onKey} tabIndex={-1}>
        <div
          ref={tableRef}
          className="relative mx-auto aspect-[4/5] w-full max-w-[760px] sm:aspect-[16/10]"
          role="group"
          aria-label="Replay table"
        >
          {geo ? (
            <>
              <div
                aria-hidden
                className="absolute rounded-[50%]"
                style={{
                  left: geo.cx - geo.rx,
                  top: geo.cy - geo.ry,
                  width: geo.rx * 2,
                  height: geo.ry * 2,
                  background: "linear-gradient(180deg, rgb(var(--rail)) 0%, rgb(8 10 13) 100%)",
                  boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.06), 0 18px 50px rgb(0 0 0 / 0.45)",
                }}
              >
                <div
                  className="absolute rounded-[50%]"
                  style={{
                    inset: 10,
                    background:
                      "radial-gradient(ellipse at 50% 42%, rgb(var(--felt)) 0%, rgb(var(--felt)) 30%, rgb(var(--felt-dark)) 100%)",
                    boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.4), inset 0 10px 40px rgb(0 0 0 / 0.35)",
                  }}
                />
              </div>
              <div
                className="absolute z-[1] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
                style={{ left: geo.cx, top: geo.cy }}
              >
                <div className="flex h-6 items-center gap-1.5 rounded-full bg-black/35 py-0.5 pl-1.5 pr-2.5 ring-1 ring-white/10">
                  <ChipStack count={collected > 0 ? 3 : 1} />
                  <span className="text-[10px] font-medium uppercase tracking-wide text-fg/70">Pot</span>
                  <span className="tabular text-xs font-semibold text-gold">{formatChips(collected)}</span>
                </div>
                {frame.boards.length === 0 ? (
                  <div className="flex items-center" style={{ height: Math.round(geo.boardW * 1.4) }}>
                    <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-[11px] text-white/60">
                      {view.isBombPot ? "Bomb pot" : "Preflop"}
                    </span>
                  </div>
                ) : (
                  frame.boards.map((board, i) => (
                    <div key={i} className="flex items-center" style={{ gap: geo.gap }}>
                      {frame.boards.length > 1 ? <span className="w-3 text-[10px] text-white/60">{i + 1}</span> : null}
                      {Array.from({ length: 5 }).map((_, c) => {
                        const code = board[c];
                        return code ? (
                          <PlayingCard key={`${i}-${c}-${code}`} card={toPublicCard(code)} width={geo.boardW} />
                        ) : (
                          <div
                            key={`${i}-${c}-empty`}
                            aria-hidden
                            className="shrink-0 rounded-[0.32em] border border-white/[0.07] bg-black/[0.06]"
                            style={{ width: geo.boardW, height: Math.round(geo.boardW * 1.4), fontSize: geo.boardW * 0.42 }}
                          />
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
              {rotated.map((seat, i) => {
                const pos = geo.points[i]!;
                return (
                  <SeatView
                    key={seat.userId}
                    seat={seat}
                    frame={frame}
                    view={view}
                    x={pos.x}
                    y={pos.y}
                    m={geo.m}
                    cardH={geo.cardH}
                    toward={{ x: pos.x + (geo.cx - pos.x) * 0.38, y: pos.y + (geo.cy - pos.y) * 0.38 }}
                    equity={currentEquity?.get(seat.userId) ?? null}
                  />
                );
              })}
            </>
          ) : null}
        </div>
        <div className="border-t border-line px-3 py-3 sm:px-5">
          {/* Fixed two-line height: stepping never changes the page height (no jumps / scroll anchoring). */}
          <p className="mb-3 line-clamp-2 h-10 text-center text-sm leading-5 text-fg" aria-live="polite">
            <TextWithCards text={frame.text} />
          </p>
          <div className="flex flex-wrap items-center justify-center gap-1">
            <IconButton aria-label="First action" size="sm" onClick={() => step(-frames.length)}>
              <SkipBack />
            </IconButton>
            <IconButton aria-label="Previous action (Left arrow)" size="sm" onClick={() => step(-1)}>
              <ChevronLeft />
            </IconButton>
            <IconButton
              aria-label={playing ? "Pause (Space)" : "Play (Space)"}
              variant="primary"
              size="md"
              onClick={() => {
                if (index >= last) setIndex(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? <Pause /> : <Play />}
            </IconButton>
            <IconButton aria-label="Next action (Right arrow)" size="sm" onClick={() => step(1)}>
              <ChevronRight />
            </IconButton>
            <IconButton aria-label="Last action" size="sm" onClick={() => step(frames.length)}>
              <SkipForward />
            </IconButton>
            <span className="tabular ml-2 text-xs text-muted">
              {index + 1} / {frames.length}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Jump to street">
              {STREET_ORDER.map((street) => {
                const at = streetStart(street);
                return (
                  <button
                    key={street}
                    type="button"
                    disabled={at < 0}
                    onClick={() => {
                      setPlaying(false);
                      setIndex(at);
                    }}
                    className={cn(
                      "h-7 rounded-md px-2 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40",
                      frame.street === street && (resultStart === -1 || index < resultStart) && "bg-surface-2 text-fg",
                    )}
                  >
                    {street === "PREFLOP" ? "Preflop" : street[0] + street.slice(1).toLowerCase()}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={resultStart < 0}
                onClick={() => {
                  setPlaying(false);
                  setIndex(resultStart);
                }}
                className={cn(
                  "h-7 rounded-md px-2 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40",
                  resultStart >= 0 && index >= resultStart && "bg-surface-2 text-fg",
                )}
              >
                Result
              </button>
            </div>
            <Segmented
              aria-label="Playback speed"
              size="sm"
              value={speed}
              onValueChange={setSpeed}
              options={[
                { value: "0.5", label: "0.5×" },
                { value: "1", label: "1×" },
                { value: "2", label: "2×" },
              ]}
            />
          </div>
        </div>
      </Card>

      <Card className="flex max-h-[640px] min-h-0 flex-col">
        <CardHeader
          title="Actions"
          actions={
            <InfoTip label="About equity" title="Equity">
              When every remaining player&apos;s cards are known, the blue % shows each hand&apos;s chance to win from that point. In
              all-in hands the gold &quot;Exp.&quot; badge is the expected result: {ALL_IN_EV_EXPLAINER.charAt(0).toLowerCase() + ALL_IN_EV_EXPLAINER.slice(1)}
            </InfoTip>
          }
        />
        <ol ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto py-2 text-sm">
          {frames.map((f) => {
            const header =
              f.kind === "showdown" || f.kind === "award" || f.kind === "side" || f.kind === "end" || f.kind === "show"
                ? "Result"
                : f.street === "PREFLOP"
                  ? "Preflop"
                  : f.street[0] + f.street.slice(1).toLowerCase();
            const showHeader = header !== lastHeader;
            lastHeader = header;
            return (
              <li key={f.index}>
                {showHeader ? (
                  <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-subtle">{header}</div>
                ) : null}
                <button
                  type="button"
                  data-frame={f.index}
                  onClick={() => {
                    setPlaying(false);
                    setIndex(f.index);
                  }}
                  className={cn(
                    "block w-full border-l-2 px-4 py-1.5 text-left transition-colors hover:bg-surface-2",
                    f.index === index ? "border-accent bg-surface-2 text-fg" : "border-transparent",
                    f.index > index && "opacity-50",
                    f.tone === "muted" && "text-muted",
                    f.tone === "accent" && "text-accent",
                    f.tone === "danger" && "text-danger",
                    f.tone === "gold" && "text-gold",
                  )}
                >
                  <TextWithCards text={f.text} />
                </button>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

/** Final results per player, including all-in EV and side payments. */
export function HandResults({ view }: { view: HandView }) {
  const side = view.events.filter((e) => e.type === "SIDE_PAYMENT");
  const name = (id: string) => (id === view.viewerId ? "You" : (view.players.find((p) => p.userId === id)?.displayName ?? "A player"));
  return (
    <Card>
      <CardHeader title="Results" description={`Total pot ${formatChips(view.totalPot)} chips`} />
      <ul className="divide-y divide-line">
        {[...view.players]
          .sort((a, b) => b.net - a.net)
          .map((p) => (
            <li key={p.userId} className="flex items-center gap-3 px-5 py-3">
              <Avatar avatar={p.avatar} name={p.displayName} seed={p.userId} size="sm" decorative />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {p.username && !p.isViewer ? (
                    <a href={`/u/${p.username}`} className="truncate text-sm font-medium text-fg hover:underline">
                      {p.displayName}
                    </a>
                  ) : (
                    <span className="truncate text-sm font-medium text-fg">{p.isViewer ? "You" : p.displayName}</span>
                  )}
                  <Badge tone="outline">{p.position}</Badge>
                  {p.holeCards ? <CardRow cards={p.holeCards} width={18} /> : <span className="text-xs text-subtle">{p.wentToShowdown ? "mucked" : ""}</span>}
                </div>
                {p.allInEvNet !== null ? (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                    Expected (all-in): <Chips amount={p.allInEvNet} signed className="text-xs" />
                    <InfoTip label="About the expected result" title="Expected (all-in)">
                      {ALL_IN_EV_EXPLAINER}
                    </InfoTip>
                  </p>
                ) : null}
              </div>
              <div className="text-right">
                <Chips amount={p.net} signed className="text-sm font-semibold" />
                <div className="tabular text-xs text-subtle">
                  {p.net > 0 ? "+" : p.net < 0 ? "−" : ""}
                  {(Math.abs(p.net) / view.bigBlind).toFixed(1)} BB
                </div>
              </div>
            </li>
          ))}
      </ul>
      {side.length > 0 ? (
        <div className="border-t border-line px-5 py-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Side games</p>
          <ul className="space-y-1 text-sm">
            {side.map((e) =>
              e.type === "SIDE_PAYMENT" ? (
                <li key={e.seq} className="text-muted">
                  {name(e.fromUserId)} paid <Chips amount={e.amount} className="text-fg" /> to {name(e.toUserId)} (
                  {e.reason === "NIT_GAME" ? "nit game penalty" : "7-2 bounty"})
                </li>
              ) : null,
            )}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
