// Per-hand stat columns stored on HandPlayer (and the money-flow split between opponents), computed once when a
// hand is persisted (and by scripts/backfill-hand-stats.ts for older rows) so the stats report is a set of SQL
// aggregates. Definitions are exactly those of computeStatsReport over the event log. Browser-safe (no DB).
import { computeEventStats } from "./event-stats";
import { handClass } from "./hand-class";

/** Bump when the definitions below change; the backfill recomputes rows with an older version. */
export const HAND_PLAYER_STATS_VERSION = 1;

export type HandPlayerStatColumns = {
  statsVersion: number;
  /** Counted in the VPIP/PFR/limp denominator: acted preflop (always true without an event log), not a bomb pot. */
  preflopActed: boolean;
  limp: boolean;
  threeBetOpp: boolean;
  facedThreeBet: boolean;
  foldedToThreeBet: boolean;
  cbetOpp: boolean;
  cbet: boolean;
  facedCbet: boolean;
  foldedToCbet: boolean;
  /** Postflop bets + raises. */
  postflopAggr: number;
  postflopCalls: number;
  handClass: string | null;
};

type MinimalAction = { type?: unknown; street?: unknown; playerId?: unknown };

/**
 * Stat columns for each of `players` from the stored event log (any extra platform events are ignored).
 * Without an event log only `preflopActed` (true unless a bomb pot) and `handClass` are set, as in the report.
 */
export function handPlayerStatColumns(
  events: readonly unknown[],
  hand: { isBombPot: boolean; variant: string },
  players: ReadonlyArray<{ userId: string; holeCards: readonly string[] }>,
): Map<string, HandPlayerStatColumns> {
  const hasEvents = events.length > 0;
  const stats = hasEvents ? computeEventStats(events, { isBombPot: hand.isBombPot }) : null;
  const actedPreflop = new Set<string>();
  for (const e of events as readonly MinimalAction[]) {
    if (e && e.type === "ACTION" && e.street === "PREFLOP" && typeof e.playerId === "string") actedPreflop.add(e.playerId);
  }
  const out = new Map<string, HandPlayerStatColumns>();
  for (const p of players) {
    const ev = stats?.get(p.userId);
    out.set(p.userId, {
      statsVersion: HAND_PLAYER_STATS_VERSION,
      preflopActed: !hand.isBombPot && (!hasEvents || actedPreflop.has(p.userId)),
      limp: ev?.limp ?? false,
      threeBetOpp: ev?.threeBetOpportunity ?? false,
      facedThreeBet: ev?.facedThreeBet ?? false,
      foldedToThreeBet: ev?.foldedToThreeBet ?? false,
      cbetOpp: ev?.cbetOpportunity ?? false,
      cbet: ev?.cbet ?? false,
      facedCbet: ev?.facedCbet ?? false,
      foldedToCbet: ev?.foldedToCbet ?? false,
      postflopAggr: ev ? ev.postflopBets + ev.postflopRaises : 0,
      postflopCalls: ev?.postflopCalls ?? 0,
      handClass: hand.variant === "NLHE" ? handClass(p.holeCards) : null,
    });
  }
  return out;
}

/** round(net * 100 / bigBlind) as an integer (Math.round: halves round up). Summed into PlayerDailyStat.netCentiBB. */
export function netCentiBB(net: number, bigBlind: number): number {
  return Math.round((net * 100) / Math.max(bigBlind, 1));
}

export type OpponentFlow = { userId: string; opponentId: string; flow: number; flowBB: number };

/**
 * Money flow inside one hand, for every ordered pair of players: each player's result is split across the
 * opponents on the other side of it in proportion to their own results (a pot you win came from the players who
 * lost chips in it). Pairs on the same side get flow 0 (they still count as a hand played together).
 */
export function opponentFlows(players: ReadonlyArray<{ userId: string; net: number }>, bigBlind: number): OpponentFlow[] {
  let wins = 0;
  let losses = 0;
  for (const p of players) {
    if (p.net > 0) wins += p.net;
    else losses -= p.net;
  }
  const bb = Math.max(bigBlind, 1);
  const out: OpponentFlow[] = [];
  for (const m of players) {
    for (const o of players) {
      if (o.userId === m.userId) continue;
      let flow = 0;
      if (m.net > 0 && o.net < 0 && losses > 0) flow = (m.net * -o.net) / losses;
      else if (m.net < 0 && o.net > 0 && wins > 0) flow = (m.net * o.net) / wins;
      out.push({ userId: m.userId, opponentId: o.userId, flow, flowBB: flow / bb });
    }
  }
  return out;
}
