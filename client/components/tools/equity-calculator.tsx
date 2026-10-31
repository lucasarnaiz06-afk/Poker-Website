"use client";

import { parseRange } from "@poker-platform/engine";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardBody, CardHeader, IconButton, InfoTip, Input, Segmented } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { CardSlots, DeckGrid } from "./card-picker";
import type { EquityResponse } from "./equity-protocol";
import { useEquityWorker } from "./use-equity";

type Variant = "NLHE" | "PLO";
type Mode = "cards" | "range";
type PlayerInput = { mode: Mode; cards: Array<string | null>; range: string };
type Slot = { group: "player"; player: number; index: number } | { group: "board"; index: number } | { group: "dead"; index: number };

const MAX_PLAYERS: Record<Variant, number> = { NLHE: 9, PLO: 6 };
const DEAD_SLOTS = 6;

function emptyPlayer(variant: Variant): PlayerInput {
  return { mode: "cards", cards: Array(variant === "PLO" ? 4 : 2).fill(null), range: "" };
}

function sameSlot(a: Slot | null, b: Slot) {
  if (!a || a.group !== b.group || a.index !== b.index) return false;
  return a.group !== "player" || (b.group === "player" && a.player === b.player);
}

function rangeInfo(text: string): { combos: number; error: string | null } {
  if (!text.trim()) return { combos: 0, error: null };
  try {
    return { combos: parseRange(text).length, error: null };
  } catch (error) {
    return { combos: 0, error: error instanceof Error ? error.message : "Invalid range" };
  }
}

const PLAYER_TONES = ["bg-accent", "bg-info", "bg-gold", "bg-warning", "bg-danger", "bg-[#a78bfa]", "bg-[#f472b6]", "bg-[#2dd4bf]", "bg-[#94a3b8]"];

export function EquityCalculator() {
  const [variant, setVariant] = useState<Variant>("NLHE");
  const [players, setPlayers] = useState<PlayerInput[]>([emptyPlayer("NLHE"), emptyPlayer("NLHE")]);
  const [board, setBoard] = useState<Array<string | null>>(Array(5).fill(null));
  const [dead, setDead] = useState<Array<string | null>>(Array(DEAD_SLOTS).fill(null));
  const [active, setActive] = useState<Slot | null>({ group: "player", player: 0, index: 0 });
  const [stored, setStored] = useState<{ key: string; res: EquityResponse } | null>(null);
  const [running, setRunning] = useState(false);
  const { run, cancel } = useEquityWorker();

  const used = useMemo(() => {
    const set = new Set<string>();
    players.forEach((p) => p.mode === "cards" && p.cards.forEach((c) => c && set.add(c)));
    board.forEach((c) => c && set.add(c));
    dead.forEach((c) => c && set.add(c));
    return set;
  }, [players, board, dead]);

  const slotOrder = useMemo<Slot[]>(() => {
    const order: Slot[] = [];
    players.forEach((p, pi) => p.mode === "cards" && p.cards.forEach((_, i) => order.push({ group: "player", player: pi, index: i })));
    board.forEach((_, i) => order.push({ group: "board", index: i }));
    return order;
  }, [players, board]);

  const valueAt = (slot: Slot) =>
    slot.group === "player" ? players[slot.player]?.cards[slot.index] ?? null : slot.group === "board" ? board[slot.index] ?? null : dead[slot.index] ?? null;

  const setAt = (slot: Slot, card: string | null) => {
    if (slot.group === "player") {
      setPlayers((ps) => ps.map((p, i) => (i === slot.player ? { ...p, cards: p.cards.map((c, j) => (j === slot.index ? card : c)) } : p)));
    } else if (slot.group === "board") {
      setBoard((b) => b.map((c, j) => (j === slot.index ? card : c)));
    } else {
      setDead((d) => d.map((c, j) => (j === slot.index ? card : c)));
    }
  };

  const pick = (card: string) => {
    const target = active ?? slotOrder.find((s) => valueAt(s) === null) ?? null;
    if (!target) return;
    setAt(target, card);
    // Advance to the next empty slot in reading order (dead cards stay put).
    if (target.group === "dead") {
      const next = dead.findIndex((c, i) => i > target.index && c === null);
      setActive(next >= 0 ? { group: "dead", index: next } : null);
      return;
    }
    const at = slotOrder.findIndex((s) => sameSlot(target, s));
    const next = slotOrder.slice(at + 1).find((s) => valueAt(s) === null) ?? null;
    setActive(next);
  };

  const changeVariant = (v: Variant) => {
    setVariant(v);
    setPlayers([emptyPlayer(v), emptyPlayer(v)]);
    setBoard(Array(5).fill(null));
    setDead(Array(DEAD_SLOTS).fill(null));
    setActive({ group: "player", player: 0, index: 0 });
    setStored(null);
  };

  const reset = () => changeVariant(variant);

  const boardCards = board.filter((c): c is string => c !== null);
  const deadCards = dead.filter((c): c is string => c !== null);
  const boardValid = [0, 3, 4, 5].includes(boardCards.length);
  const playerStatus = players.map((p) =>
    p.mode === "cards" ? { ready: p.cards.every((c) => c !== null), error: null as string | null } : (() => {
      const info = rangeInfo(p.range);
      return { ready: info.combos > 0, error: info.error };
    })(),
  );
  const ready = boardValid && players.length >= 2 && playerStatus.every((s) => s.ready);
  const jobKey = ready ? JSON.stringify({ variant, players, boardCards, deadCards }) : null;

  useEffect(() => {
    cancel();
    if (!jobKey) {
      setRunning(false);
      return;
    }
    let stale = false;
    setRunning(true);
    const timer = setTimeout(async () => {
      const anyRange = players.some((p) => p.mode === "range");
      const res = anyRange
        ? await run({
            kind: "ranges",
            players: players.map((p) => (p.mode === "range" ? { range: p.range } : { cards: p.cards as string[] })),
            board: boardCards,
            dead: deadCards,
            iterations: 60_000,
          })
        : await run({
            kind: "hands",
            variant,
            hands: players.map((p) => p.cards as string[]),
            board: boardCards,
            dead: deadCards,
            iterations: 60_000,
          });
      if (stale || (!res.ok && res.error === "cancelled")) return;
      setStored({ key: jobKey, res });
      setRunning(false);
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // jobKey captures every input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey]);

  const result = stored && stored.key === jobKey ? stored.res : null;
  const results = result?.ok ? result.results : null;

  return (
    <Card as="section">
      <CardHeader
        title="Equity calculator"
        description="Each hand's chance to win if all the cards were dealt out."
        actions={
          <Segmented
            aria-label="Game"
            size="sm"
            value={variant}
            onValueChange={changeVariant}
            options={[
              { value: "NLHE", label: "Hold'em" },
              { value: "PLO", label: "Omaha" },
            ]}
          />
        }
      />
      <CardBody className="space-y-5">
        <ol className="space-y-3">
          {players.map((p, pi) => {
            const res = results?.[pi];
            const status = playerStatus[pi]!;
            const info = p.mode === "range" ? rangeInfo(p.range) : null;
            return (
              <li key={pi} className="rounded-lg border border-line bg-surface-2/40 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex w-20 shrink-0 items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 rounded-full", PLAYER_TONES[pi])} aria-hidden />
                    <span className="text-sm font-medium text-fg">Player {pi + 1}</span>
                  </div>
                  {variant === "NLHE" ? (
                    <Segmented
                      aria-label={`Player ${pi + 1} input`}
                      size="sm"
                      value={p.mode}
                      onValueChange={(mode) => {
                        setPlayers((ps) => ps.map((x, i) => (i === pi ? { ...x, mode } : x)));
                        if (mode === "range" && active?.group === "player" && active.player === pi) setActive(null);
                      }}
                      options={[
                        { value: "cards", label: "Cards" },
                        { value: "range", label: "Range" },
                      ]}
                    />
                  ) : null}
                  <div className="ml-auto">
                    {players.length > 2 ? (
                      <IconButton
                        aria-label={`Remove player ${pi + 1}`}
                        size="sm"
                        onClick={() => {
                          setPlayers((ps) => ps.filter((_, i) => i !== pi));
                          setActive(null);
                        }}
                      >
                        <Trash2 />
                      </IconButton>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 sm:w-auto">
                    {p.mode === "cards" ? (
                      <CardSlots
                        label={`Player ${pi + 1} cards`}
                        cards={p.cards}
                        active={active?.group === "player" && active.player === pi ? active.index : null}
                        onSelect={(index) => setActive({ group: "player", player: pi, index })}
                        onClear={(index) => setAt({ group: "player", player: pi, index }, null)}
                      />
                    ) : (
                      <div className="w-full sm:w-64">
                        <Input
                          size="sm"
                          aria-label={`Player ${pi + 1} range`}
                          placeholder="e.g. AKs, TT+, A5s-A2s"
                          value={p.range}
                          aria-invalid={Boolean(status.error)}
                          onChange={(e) => {
                            const range = e.target.value.slice(0, 300);
                            setPlayers((ps) => ps.map((x, i) => (i === pi ? { ...x, range } : x)));
                          }}
                        />
                        <p className={cn("mt-1 text-xs", status.error ? "text-danger" : "text-subtle")}>
                          {status.error ?? (info && info.combos > 0 ? `${info.combos} combos (${((100 * info.combos) / 1326).toFixed(1)}% of hands)` : "Type hands separated by commas")}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {res ? (
                      <div>
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="tabular text-lg font-semibold text-fg">{(res.equity * 100).toFixed(1)}%</span>
                          <span className="tabular text-xs text-muted">
                            win {(res.win * 100).toFixed(1)}% · tie {(res.tie * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="mt-1 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-3" aria-hidden>
                          <div className={cn("h-full rounded-l-full", PLAYER_TONES[pi])} style={{ width: `${res.win * 100}%` }} />
                          {res.tie > 0.0005 ? <div className="h-full bg-muted/60" style={{ width: `${res.tie * 100}%` }} /> : null}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-subtle">{status.ready ? (running ? "Calculating…" : "") : p.mode === "cards" ? "Pick this player's cards" : "Enter a range"}</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Plus />}
            disabled={players.length >= MAX_PLAYERS[variant]}
            onClick={() => {
              setPlayers((ps) => [...ps, emptyPlayer(variant)]);
              setActive({ group: "player", player: players.length, index: 0 });
            }}
          >
            Add player
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<RotateCcw />} onClick={reset}>
            Reset
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Board</p>
            <CardSlots
              label="Board"
              cards={board}
              active={active?.group === "board" ? active.index : null}
              onSelect={(index) => setActive({ group: "board", index })}
              onClear={(index) => setAt({ group: "board", index }, null)}
            />
            {!boardValid ? <p className="mt-1 text-xs text-warning">A board needs 3, 4 or 5 cards.</p> : null}
          </div>
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted">
              Dead cards
              <InfoTip label="About dead cards">Cards you know are out of play, such as a card that was shown or burned face up.</InfoTip>
            </p>
            <CardSlots
              label="Dead cards"
              size="sm"
              cards={dead}
              active={active?.group === "dead" ? active.index : null}
              onSelect={(index) => setActive({ group: "dead", index })}
              onClear={(index) => setAt({ group: "dead", index }, null)}
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs text-muted">
            {active ? "Pick a card for the highlighted slot." : "Tap a slot, then a card. Used cards are greyed out."}
          </p>
          <DeckGrid used={used} onPick={pick} />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-subtle" aria-live="polite">
          {running ? <Badge tone="info">Calculating…</Badge> : null}
          {result?.ok && !running ? (
            <span>
              {result.exact ? "Exact: every possible board checked" : `Simulated ${result.samples.toLocaleString("en-US")} random boards`} in{" "}
              {Math.max(1, Math.round(result.ms))} ms.
            </span>
          ) : null}
          {result && !result.ok && !running ? <span className="text-danger">{result.error}</span> : null}
        </div>
      </CardBody>
    </Card>
  );
}
