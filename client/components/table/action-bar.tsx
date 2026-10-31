"use client";

import type { LegalActions, TableSeatView, TableView } from "@poker-platform/shared/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ChevronUp, Eye, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Kbd } from "./bits";
import { clamp, formatAmount, formatChips } from "./format";
import { betPresets, resolvePreAction, snapBet, type PreAction } from "./logic";
import { useMediaQuery } from "./hooks";
import type { TablePreferences } from "./preferences";
import type { TableCommands } from "./table-controller";

function usePreAction(view: TableView, me: TableSeatView | null, commands: TableCommands) {
  // The street a pre-action was chosen on travels with it, so a choice never fires on a later
  // street even when the new street and the viewer's turn arrive in the same snapshot.
  const [stored, setStored] = useState<{ pre: PreAction; street: string } | null>(null);
  const hand = view.hand;
  const toCall = me && hand ? Math.min(Math.max(0, hand.currentBet - me.bet), me.stack) : 0;
  const street = hand ? `${hand.handId}:${hand.phase}` : "none";
  const pre = stored && stored.street === street ? stored.pre : null;
  const setPre = useCallback((p: PreAction | null) => setStored(p ? { pre: p, street } : null), [street]);

  // Clear "Check" / "Call X" when the price changes.
  useEffect(() => {
    setStored((s) => {
      if (!s) return s;
      if (s.pre.kind === "check" && toCall > 0) return null;
      if (s.pre.kind === "call" && s.pre.amount !== toCall) return null;
      return s;
    });
  }, [toCall]);
  // Fire when the turn arrives.
  const legal = view.viewer.legalActions;
  useEffect(() => {
    if (!legal || !pre) return;
    const action = resolvePreAction(pre, legal);
    setStored(null);
    if (action) void commands.act(action.type);
  }, [legal, pre, commands]);
  return { pre, setPre, toCall };
}

// ---------------------------------------------------------------------------------------------

export type ActionDockProps = {
  view: TableView;
  commands: TableCommands;
  prefs: TablePreferences;
  onRequestSeat: () => void;
  /** A prompt that takes over the dock (the run-it-twice vote for all-in players). */
  prompt?: React.ReactNode;
  /** Server-corrected clock, for the turn timer bar. */
  now: number;
  /** Hand summary to show here when the felt has no room for it (phones, double boards). */
  result?: React.ReactNode;
};

/** Everything docked under the table: your-turn actions, pre-actions, show cards, sit back in. */
export function ActionDock({ view, commands, prefs, onRequestSeat, prompt, now, result }: ActionDockProps) {
  const me = view.seats.find((s) => s.seat === view.viewer.seat) ?? null;
  const legal = view.viewer.legalActions;
  const hand = view.hand;
  const { pre, setPre, toCall } = usePreAction(view, me, commands);
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }, []);

  let content: React.ReactNode;
  if (prompt) {
    content = prompt;
  } else if (!me) {
    const open = view.settings.maxPlayers - view.seats.length;
    content = (
      <IdleRow
        text={open > 0 ? "You're watching. Take a seat to play." : "You're watching. The table is full."}
        actions={
          open > 0 ? (
            <Button onClick={onRequestSeat} size="md">
              Take a seat
            </Button>
          ) : null
        }
      />
    );
  } else if (legal && hand) {
    content = (
      <YourTurn
        key={`${hand.handId}:${hand.phase}:${hand.currentBet}`}
        view={view}
        me={me}
        legal={legal}
        commands={commands}
        prefs={prefs}
        secondsLeft={hand.actionDeadline ? Math.max(0, Math.ceil((Date.parse(hand.actionDeadline) - now) / 1000)) : null}
      />
    );
  } else {
    const inHandLive = hand && hand.phase !== "COMPLETE" && me.inHand && !me.folded && !me.allIn;
    const straddle = view.settings.straddle ? (
      <label className="flex items-center gap-2 text-[13px] text-muted">
        <Switch
          size="sm"
          checked={me.wantsStraddle}
          onCheckedChange={(v) => void run("straddle", () => commands.straddle(v))}
          aria-label="Straddle when I'm under the gun"
        />
        Straddle
      </label>
    ) : null;
    if (me.status === "SITTING_OUT") {
      content = (
        <IdleRow
          text="You're sitting out. You won't be dealt in."
          actions={
            <Button onClick={() => void run("back", () => commands.sitOut(false))} loading={busy === "back"}>
              I&apos;m back
            </Button>
          }
        />
      );
    } else if (inHandLive) {
      content = <PreActions pre={pre} setPre={setPre} toCall={toCall} bigBlind={view.settings.bigBlind} inBB={prefs.showBB} extra={straddle} />;
    } else {
      const bounty = view.sideGames.bountyGame.active && me.holeCards && isSevenTwo(me.holeCards);
      const nextIn = view.nextHandAt ? Math.max(0, Math.ceil((Date.parse(view.nextHandAt) - now) / 1000)) : null;
      content = (
        <IdleRow
          lead={result}
          text={
            me.allIn && hand && hand.phase !== "COMPLETE"
              ? "You're all-in."
              : me.status === "WAITING_BB"
                ? "You'll be dealt in when the big blind reaches you."
                : hand && hand.phase !== "COMPLETE" && me.folded
                  ? "You folded. Waiting for the next hand."
                  : me.stack === 0
                    ? "You're out of chips. Add chips to keep playing."
                    : !hand && view.seats.filter((x) => x.status !== "SITTING_OUT").length < 2
                      ? "Waiting for more players to sit down."
                      : !hand && !view.settings.autoStart
                        ? view.viewer.userId === view.hostUserId
                          ? "Press Start game when everyone's ready."
                          : "Waiting for the host to start."
                        : nextIn !== null
                          ? `Next hand in ${nextIn}s`
                          : "Waiting for the next hand."
          }
          actions={
            (straddle || view.viewer.canShowCards) && (
            <>
              {straddle}
              {view.viewer.canShowCards && (
                <Button
                  variant={bounty ? "primary" : "secondary"}
                  leftIcon={<Eye />}
                  onClick={() => void run("show", () => commands.show())}
                  loading={busy === "show"}
                >
                  {bounty ? "Show 7-2 for bounty" : "Show cards"}
                </Button>
              )}
            </>
            )
          }
        />
      );
    }
  }

  // Turn timer for the viewer (their seat ring sits under their cards, so mirror it here).
  let timer: { fraction: number; seconds: number; bank: boolean } | null = null;
  if (legal && hand?.actionDeadline) {
    const remaining = Math.max(0, Date.parse(hand.actionDeadline) - now);
    const seconds = Math.ceil(remaining / 1000);
    const total = hand.usingTimeBank ? Math.max(view.settings.timeBankSec, seconds, 1) : Math.max(view.settings.actionTimeSec, 1);
    timer = { fraction: Math.min(1, remaining / 1000 / total), seconds, bank: hand.usingTimeBank };
  }

  return (
    <div
      className="relative z-20 border-t border-line bg-surface/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-4"
      aria-label="Your actions"
      role="region"
    >
      {timer && (
        <>
          <div className="absolute inset-x-0 -top-px h-[3px] bg-surface-3" aria-hidden>
            <div
              className={cn(
                "h-full transition-[width] duration-300 ease-linear",
                timer.bank ? "bg-warning" : timer.fraction < 0.25 ? "bg-danger" : "bg-accent",
              )}
              style={{ width: `${timer.fraction * 100}%` }}
            />
          </div>
          <div
            className={cn(
              "absolute left-3 top-0 -translate-y-full rounded-t-md px-2 py-0.5 text-[11px] font-semibold tabular",
              timer.bank ? "bg-warning text-black" : timer.fraction < 0.25 ? "bg-danger text-white" : "bg-surface-3 text-fg",
            )}
            role="timer"
            aria-label={`${timer.seconds} seconds to act${timer.bank ? ", using time bank" : ""}`}
          >
            {timer.bank ? `Time bank ${timer.seconds}s` : `${timer.seconds}s`}
          </div>
        </>
      )}
      <div className="mx-auto flex min-h-[76px] w-full max-w-[760px] flex-col justify-end sm:min-h-[100px]">{content}</div>
    </div>
  );
}

function isSevenTwo(cards: { rank: string }[]) {
  const ranks = cards.map((c) => c.rank).sort().join("");
  return cards.length === 2 && ranks === "27";
}

function IdleRow({ text, actions, lead }: { text: string; actions?: React.ReactNode; lead?: React.ReactNode }) {
  if (lead) {
    // Hand summary (when the felt had no room for it): it fits the dock's usual height, so the
    // table doesn't jump when a hand ends.
    return (
      <div className="flex min-h-[48px] items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {lead}
          <p className="mt-0.5 text-xs text-subtle tabular">{text}</p>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
      </div>
    );
  }
  return (
    <div className="flex min-h-[48px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="text-sm text-muted tabular">{text}</p>
      <div className="flex items-center gap-3">{actions}</div>
    </div>
  );
}

function PreActions({
  pre,
  setPre,
  toCall,
  bigBlind,
  inBB,
  extra,
}: {
  pre: PreAction | null;
  setPre: (p: PreAction | null) => void;
  toCall: number;
  bigBlind: number;
  inBB: boolean;
  extra?: React.ReactNode;
}) {
  const options: Array<{ id: string; label: string; value: PreAction }> =
    toCall > 0
      ? [
          { id: "checkFold", label: "Fold", value: { kind: "checkFold" } },
          { id: "call", label: `Call ${formatAmount(toCall, bigBlind, inBB)}`, value: { kind: "call", amount: toCall } },
          { id: "callAny", label: "Call any", value: { kind: "callAny" } },
        ]
      : [
          { id: "checkFold", label: "Check / Fold", value: { kind: "checkFold" } },
          { id: "check", label: "Check", value: { kind: "check" } },
          { id: "callAny", label: "Call any", value: { kind: "callAny" } },
        ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[13px] text-muted">
          <span className="hidden sm:inline">Waiting for others · </span>Pick an action in advance
        </p>
        {extra}
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Pre-select an action">
        {options.map((o) => {
          const active = pre?.kind === o.value.kind;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={active}
              onClick={() => setPre(active ? null : o.value)}
              className={cn(
                "flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                active ? "border-accent bg-accent/15 text-fg" : "border-line bg-surface-2 text-muted hover:bg-surface-3 hover:text-fg",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded border",
                  active ? "border-accent bg-accent text-accent-fg" : "border-subtle",
                )}
              >
                {active && (
                  <svg viewBox="0 0 12 12" className="h-3 w-3">
                    <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="truncate tabular">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Your turn

function YourTurn({
  view,
  me,
  legal,
  commands,
  prefs,
  secondsLeft,
}: {
  view: TableView;
  me: TableSeatView;
  legal: LegalActions;
  commands: TableCommands;
  prefs: TablePreferences;
  secondsLeft: number | null;
}) {
  const hand = view.hand!;
  const bb = view.settings.bigBlind;
  const inBB = prefs.showBB;
  const desktop = useMediaQuery("(min-width: 640px)", true);
  const presets = useMemo(() => (legal.canBetOrRaise ? betPresets(view, legal, me) : []), [view, legal, me]);
  const defaultTo = useMemo(() => {
    if (!legal.canBetOrRaise) return legal.minTo;
    // Sensible default: 2.5x preflop open, half pot postflop, else the minimum.
    const preferred = presets.find((p) => p.label === "2.5x" || p.label === "½ pot");
    return preferred && preferred.to >= legal.minTo ? preferred.to : legal.minTo;
  }, [legal, presets]);
  const [amount, setAmount] = useState(defaultTo);
  const [text, setText] = useState(String(defaultTo));
  const [trayOpen, setTrayOpen] = useState(false);
  const [confirmFold, setConfirmFold] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const checkRef = useRef<HTMLButtonElement>(null);
  const showTray = legal.canBetOrRaise && (desktop || trayOpen);
  const step = Math.max(1, view.settings.smallBlind);
  const maxStack = me.stack + me.bet;

  const setTo = useCallback(
    (n: number, fromText = false) => {
      const v = clamp(Math.round(n), legal.minTo, legal.maxTo);
      setAmount(v);
      if (!fromText) setText(String(v));
    },
    [legal.minTo, legal.maxTo],
  );

  const act = useCallback(
    async (type: "fold" | "check" | "call" | "bet" | "raise" | "allin", to?: number) => {
      if (busy) return;
      setBusy(true);
      try {
        await commands.act(type, to);
      } finally {
        setBusy(false);
      }
    },
    [busy, commands],
  );

  const callAllIn = legal.callAmount > 0 && legal.callAmount >= me.stack;
  const doFold = useCallback(() => {
    if (legal.canCheck && prefs.confirmFold) {
      setConfirmFold(true);
      return;
    }
    void act("fold");
  }, [legal.canCheck, prefs.confirmFold, act]);
  const doCheckCall = useCallback(() => void act(legal.canCheck ? "check" : "call"), [act, legal.canCheck]);
  const doRaise = useCallback(() => {
    if (!legal.canBetOrRaise) return;
    if (!desktop && !trayOpen) {
      setTrayOpen(true);
      return;
    }
    const to = clamp(Number(text) || amount, legal.minTo, legal.maxTo);
    void act(to >= maxStack ? "allin" : legal.isBet ? "bet" : "raise", to);
  }, [legal, desktop, trayOpen, text, amount, maxStack, act]);

  useEffect(() => {
    if (confirmFold) checkRef.current?.focus();
  }, [confirmFold]);

  // Keyboard shortcuts: F fold, C check/call, R raise (focus amount), Enter confirm, Esc cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (document.querySelector("[role='dialog'], [role='menu']")) return;
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const inAmount = target === inputRef.current;
      if (typing && !inAmount) return;
      const k = e.key.toLowerCase();
      if (k === "escape") {
        if (confirmFold) setConfirmFold(false);
        else if (trayOpen) setTrayOpen(false);
        else inputRef.current?.blur();
        e.preventDefault();
        return;
      }
      if (inAmount && k !== "enter") return;
      if (confirmFold) {
        if (k === "f") {
          e.preventDefault();
          setConfirmFold(false);
          void act("fold");
        }
        return;
      }
      if (k === "f") {
        e.preventDefault();
        doFold();
      } else if (k === "c") {
        e.preventDefault();
        doCheckCall();
      } else if (k === "r" && legal.canBetOrRaise) {
        e.preventDefault();
        setTrayOpen(true);
        window.setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        }, 0);
      } else if (k === "enter" && (inAmount || trayOpen) && legal.canBetOrRaise) {
        e.preventDefault();
        doRaise();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmFold, trayOpen, doFold, doCheckCall, doRaise, legal.canBetOrRaise, act]);

  const raiseLabel = amount >= maxStack ? "All-in" : legal.isBet ? "Bet" : "Raise to";
  const toCallText = formatAmount(legal.callAmount, bb, inBB);

  if (confirmFold) {
    return (
      <div className="flex flex-col gap-2" role="alertdialog" aria-label="Confirm fold" aria-describedby="fold-confirm-text">
        <p id="fold-confirm-text" className="text-sm text-fg">
          Checking is free. Fold anyway?
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => void act("fold")} disabled={busy} className="text-danger">
            Fold anyway <Kbd>F</Kbd>
          </Button>
          <Button ref={checkRef} size="lg" onClick={() => void act("check")} disabled={busy}>
            Check instead <Kbd className="border-accent-fg/40">Enter</Kbd>
          </Button>
        </div>
      </div>
    );
  }

  const sizing = showTray && (
    // On phones the tray opens inside the dock (the table makes room) so it never covers your cards.
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 overflow-x-auto" role="group" aria-label="Bet size presets">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setTo(p.to)}
            className={cn(
              "h-8 shrink-0 rounded-md border px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              amount === p.to ? "border-accent/70 bg-accent/15 text-fg" : "border-line bg-surface-2 text-muted hover:bg-surface-3 hover:text-fg",
            )}
          >
            {p.label}
          </button>
        ))}
        {!desktop && secondsLeft !== null && (
          <span className="ml-auto shrink-0 text-xs font-semibold text-muted tabular" aria-hidden>
            {secondsLeft}s
          </span>
        )}
        {!desktop && (
          <button
            type="button"
            onClick={() => setTrayOpen(false)}
            className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2", secondsLeft === null && "ml-auto")}
            aria-label="Close bet sizing"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Slider
          value={amount}
          min={legal.minTo}
          max={legal.maxTo}
          step={1}
          onValueChange={(v) => setTo(snapBet(v, legal, step))}
          aria-label={legal.isBet ? "Bet amount" : "Raise to amount"}
          getValueText={(v) => `${formatChips(v)} chips, ${(v / bb).toFixed(1)} big blinds`}
          className="flex-1"
        />
        <div className="flex h-9 w-[112px] shrink-0 items-center rounded-lg border border-line bg-surface-2 px-2 focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/25">
          <input
            ref={inputRef}
            value={text}
            inputMode="numeric"
            aria-label={legal.isBet ? "Bet amount in chips" : "Raise to, in chips"}
            onChange={(e) => {
              const t = e.target.value.replace(/[^\d]/g, "");
              setText(t);
              const n = Number(t);
              if (t !== "" && n >= legal.minTo && n <= legal.maxTo) setTo(n, true);
            }}
            onBlur={() => setTo(Number(text) || legal.minTo)}
            onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setTo(amount + step * (e.shiftKey ? 10 : 1));
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setTo(amount - step * (e.shiftKey ? 10 : 1));
              }
            }}
            className="w-full min-w-0 bg-transparent text-right text-sm font-semibold text-fg tabular outline-none"
          />
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {raiseLabel} {formatChips(amount)}
      </p>
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5">
      {sizing}
      <div className={cn("grid gap-2", legal.canBetOrRaise ? "grid-cols-3" : "grid-cols-2")}>
        <Button
          variant="secondary"
          size="lg"
          onClick={doFold}
          disabled={busy}
          className="text-danger hover:text-danger"
          aria-keyshortcuts="F"
        >
          Fold <Kbd>F</Kbd>
        </Button>
        <Button variant="secondary" size="lg" onClick={doCheckCall} disabled={busy} aria-keyshortcuts="C" className="tabular">
          {legal.canCheck ? "Check" : callAllIn ? `All-in ${toCallText}` : `Call ${toCallText}`} <Kbd>C</Kbd>
        </Button>
        {legal.canBetOrRaise && (
          <Button size="lg" onClick={doRaise} disabled={busy} aria-keyshortcuts="R" className="tabular">
            {!desktop && !trayOpen ? (
              <>
                {legal.isBet ? "Bet" : "Raise"} <ChevronUp className="h-4 w-4" aria-hidden />
              </>
            ) : (
              <>
                <span className="truncate">
                  {raiseLabel} {formatAmount(amount, bb, inBB)}
                </span>
                <Kbd className="border-accent-fg/40">{desktop ? "R" : ""}</Kbd>
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
