// Pure table-UI logic (no React), unit-tested in logic.test.ts.
import type { LegalActions, TableSeatView, TableView, TableVote } from "@poker-platform/shared/types";
import { clamp, formatChips } from "./format";

// ---------------------------------------------------------------------------------------------
// Bet sizing

export type Preset = { label: string; to: number };

/**
 * Pure: bet/raise presets for the current spot (exported for tests). Presets that would fall below
 * the minimum or reach the maximum are dropped, so "All-in" is never hidden behind a fraction.
 */
export function betPresets(view: TableView, legal: LegalActions, me: TableSeatView): Preset[] {
  const hand = view.hand!;
  const bb = view.settings.bigBlind;
  const maxStack = me.stack + me.bet;
  const out: Preset[] = [{ label: "Min", to: legal.minTo }];
  const add = (label: string, raw: number) => {
    const to = Math.round(raw);
    if (to > legal.minTo && to < legal.maxTo) out.push({ label, to });
  };
  if (hand.phase === "PREFLOP" && !hand.isBombPot) {
    const base = Math.max(bb, hand.currentBet);
    for (const m of [2.5, 3, 4]) add(`${m}x`, base * m);
  } else {
    const potAfterCall = hand.totalPot + legal.callAmount;
    add("⅓ pot", hand.currentBet + potAfterCall / 3);
    add("½ pot", hand.currentBet + potAfterCall / 2);
    add("⅔ pot", hand.currentBet + (potAfterCall * 2) / 3);
  }
  add("Pot", legal.potTo);
  if (legal.maxTo > legal.minTo || out.length === 1) {
    out.push({ label: legal.maxTo >= maxStack ? "All-in" : view.settings.variant === "PLO" ? "Pot" : "Max", to: legal.maxTo });
  }
  // Drop duplicates (keep the later, more meaningful label).
  const byAmount = new Map<number, Preset>();
  for (const p of out) byAmount.set(p.to, p);
  return [...byAmount.values()].sort((a, b) => a.to - b.to);
}

export function snapBet(value: number, legal: LegalActions, step: number): number {
  if (value >= legal.maxTo) return legal.maxTo;
  if (value <= legal.minTo) return legal.minTo;
  return clamp(Math.round(value / step) * step, legal.minTo, legal.maxTo);
}

// ---------------------------------------------------------------------------------------------
// Pre-actions

export type PreAction =
  | { kind: "checkFold" }
  | { kind: "check" }
  | { kind: "call"; amount: number }
  | { kind: "callAny" };

/** What a pre-action turns into once it's the viewer's turn (exported for tests). */
export function resolvePreAction(pre: PreAction, legal: LegalActions): { type: "fold" | "check" | "call" } | null {
  switch (pre.kind) {
    case "checkFold":
      return { type: legal.canCheck ? "check" : "fold" };
    case "check":
      return legal.canCheck ? { type: "check" } : null;
    case "call":
      return legal.callAmount === pre.amount && !legal.canCheck ? { type: "call" } : null;
    case "callAny":
      return { type: legal.canCheck ? "check" : "call" };
  }
}


export type BuyInMode = { kind: "sit"; seat: number } | { kind: "rebuy" };

export function buyInRange(view: TableView, mode: BuyInMode): { min: number; max: number; reason: string | null } {
  const s = view.settings;
  const wallet = view.viewer.walletBalance;
  if (mode.kind === "sit") {
    const max = Math.min(s.maxBuyIn, wallet);
    return { min: s.minBuyIn, max, reason: wallet < s.minBuyIn ? `You need at least ${formatChips(s.minBuyIn)} chips to sit here.` : null };
  }
  const me = view.seats.find((x) => x.seat === view.viewer.seat);
  const room = s.maxBuyIn - (me?.stack ?? 0);
  const max = Math.min(room, wallet);
  const min = Math.min(Math.max(s.bigBlind, me && me.stack < s.minBuyIn ? s.minBuyIn - me.stack : s.bigBlind), max);
  return {
    min: Math.max(1, min),
    max,
    reason: room <= 0 ? "Your stack is already at the table maximum." : wallet <= 0 ? "Your wallet is empty." : null,
  };
}


// ---------------------------------------------------------------------------------------------
// Votes

/** Votes needed to pass (exported for tests). */
export function votesNeeded(vote: TableVote): number {
  const n = vote.eligibleUserIds.length;
  return vote.rule === "unanimous" ? n : Math.floor(n / 2) + 1;
}


// ---------------------------------------------------------------------------------------------
// Realtime

/** Pure helper (exported for tests): should an incoming snapshot replace the current one? */
export function isNewerView(current: TableView | null, next: TableView): boolean {
  if (!current) return true;
  if (current.tableId !== next.tableId) return true;
  return next.version > current.version;
}

/**
 * Skew = serverTime - localReceiptTime. Network latency only makes the sample smaller, so the
 * largest recent sample is the best estimate (same idea as NTP's minimum-delay filter).
 */
export function estimateSkew(samples: number[]): number {
  if (samples.length === 0) return 0;
  return Math.max(...samples);
}


// ---------------------------------------------------------------------------------------------
// Layout

type Pt = { x: number; y: number };

/**
 * Points spread at equal arc length around an ellipse (rx, ry), starting at the bottom centre and
 * going clockwise on screen, so seats are evenly spaced on wide and tall ovals alike.
 */
export function ovalPoints(n: number, rx: number, ry: number): Pt[] {
  const samples = 720;
  const pts: Pt[] = [];
  const cum: number[] = [0];
  for (let k = 0; k <= samples; k += 1) {
    const t = Math.PI / 2 + (k / samples) * Math.PI * 2;
    pts.push({ x: rx * Math.cos(t), y: ry * Math.sin(t) });
    if (k > 0) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
  }
  const total = cum[samples];
  const out: Pt[] = [];
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    const target = (i / n) * total;
    while (k < samples && cum[k + 1] < target) k += 1;
    const span = cum[k + 1] - cum[k] || 1;
    const f = (target - cum[k]) / span;
    out.push({ x: pts[k].x + (pts[k + 1].x - pts[k].x) * f, y: pts[k].y + (pts[k + 1].y - pts[k].y) * f });
  }
  return out;
}

