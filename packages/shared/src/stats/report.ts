// Pure computation of the "My stats" report from one row per hand played. Browser-safe (no DB).
import { positionGroup, POSITION_GROUP_LABEL, POSITION_GROUPS, type PositionGroup } from "../hands/positions";
import { bbPer100, ratio, SESSION_GAP_MINUTES, type Ratio } from "./definitions";
import { computeEventStats } from "./event-stats";
import { gridLabels, handClass } from "./hand-class";
import { buildInsights, type Insight } from "./insights";

export type StatsHandRow = {
  handId: string;
  endedAt: Date;
  lobbyId: string;
  tableName: string;
  variant: string;
  smallBlind: number;
  bigBlind: number;
  isBombPot: boolean;
  position: string;
  holeCards: string[];
  net: number;
  won: number;
  vpip: boolean;
  pfr: boolean;
  threeBet: boolean;
  sawFlop: boolean;
  wentToShowdown: boolean;
  wonAtShowdown: boolean;
  allInEvNet: number | null;
  /** ACTION / STREET events (others are ignored). Empty when unavailable: event-based stats then use the flags. */
  events: readonly unknown[];
};

export type ResultLine = { key: string; label: string; hands: number; net: number; netBB: number; bb100: number | null };

export type SessionLine = {
  start: string;
  end: string;
  hands: number;
  net: number;
  netBB: number;
  tables: string[];
};

export type GraphPoint = {
  /** Hand count at this point. */
  n: number;
  t: string;
  net: number;
  netBB: number;
  ev: number;
  evBB: number;
  showdown: number;
  nonShowdown: number;
  showdownBB: number;
  nonShowdownBB: number;
};

export type GridCell = { label: string; hands: number; net: number; netBB: number };

export type StatsHeadline = {
  hands: number;
  net: number;
  netBB: number;
  bb100: number | null;
  vpip: Ratio;
  pfr: Ratio;
  limp: Ratio;
  threeBet: Ratio;
  foldToThreeBet: Ratio;
  cbet: Ratio;
  foldToCbet: Ratio;
  wtsd: Ratio;
  wsd: Ratio;
  af: { value: number | null; aggressive: number; calls: number };
  allInEvNet: number;
  allInEvBB: number;
  allInHands: number;
  biggestPot: number;
};

export type StatsReport = {
  headline: StatsHeadline;
  graph: GraphPoint[];
  hasEv: boolean;
  byPosition: ResultLine[];
  byStakes: ResultLine[];
  sessions: SessionLine[];
  grid: GridCell[];
  insights: Insight[];
};

export const MAX_GRAPH_POINTS = 400;

function line(key: string, label: string): ResultLine {
  return { key, label, hands: 0, net: 0, netBB: 0, bb100: null };
}

function addTo(l: ResultLine, net: number, bb: number) {
  l.hands++;
  l.net += net;
  l.netBB += net / bb;
}

/** Builds the report; `rows` may be in any order. `userId` identifies the player in the event logs. */
export function computeStatsReport(rows: readonly StatsHandRow[], userId: string): StatsReport {
  const sorted = [...rows].sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime() || a.handId.localeCompare(b.handId));
  const h: StatsHeadline = {
    hands: 0,
    net: 0,
    netBB: 0,
    bb100: null,
    vpip: ratio(0, 0),
    pfr: ratio(0, 0),
    limp: ratio(0, 0),
    threeBet: ratio(0, 0),
    foldToThreeBet: ratio(0, 0),
    cbet: ratio(0, 0),
    foldToCbet: ratio(0, 0),
    wtsd: ratio(0, 0),
    wsd: ratio(0, 0),
    af: { value: null, aggressive: 0, calls: 0 },
    allInEvNet: 0,
    allInEvBB: 0,
    allInHands: 0,
    biggestPot: 0,
  };
  const c = {
    pre: 0,
    vpip: 0,
    pfr: 0,
    limp: 0,
    tbOpp: 0,
    tb: 0,
    f3Opp: 0,
    f3: 0,
    cbOpp: 0,
    cb: 0,
    fcbOpp: 0,
    fcb: 0,
    flops: 0,
    sd: 0,
    sdWon: 0,
  };
  const positions = new Map<PositionGroup, ResultLine>(POSITION_GROUPS.map((g) => [g, line(g, POSITION_GROUP_LABEL[g])]));
  const stakes = new Map<string, ResultLine>();
  const grid = new Map<string, GridCell>(gridLabels().map((label) => [label, { label, hands: 0, net: 0, netBB: 0 }]));
  const sessions: SessionLine[] = [];
  const sessionTables: Array<Set<string>> = [];
  const graph: GraphPoint[] = [];
  let cum = { net: 0, netBB: 0, ev: 0, evBB: 0, showdown: 0, nonShowdown: 0, showdownBB: 0, nonShowdownBB: 0 };
  let hasEv = false;
  const step = Math.max(1, Math.ceil(sorted.length / MAX_GRAPH_POINTS));
  graph.push({ n: 0, t: sorted[0]?.endedAt.toISOString() ?? new Date(0).toISOString(), net: 0, netBB: 0, ev: 0, evBB: 0, showdown: 0, nonShowdown: 0, showdownBB: 0, nonShowdownBB: 0 });

  sorted.forEach((r, i) => {
    const bb = r.bigBlind > 0 ? r.bigBlind : 1;
    const netBB = r.net / bb;
    h.hands++;
    h.net += r.net;
    h.netBB += netBB;
    if (r.won > h.biggestPot) h.biggestPot = r.won;

    // Frequency stats from the event log (falls back to the stored flags).
    const ev = r.events.length > 0 ? computeEventStats(r.events, { isBombPot: r.isBombPot }).get(userId) : undefined;
    const actedPreflop =
      r.events.length > 0
        ? r.events.some((e) => {
            const x = e as { type?: string; street?: string; playerId?: string };
            return x.type === "ACTION" && x.street === "PREFLOP" && x.playerId === userId;
          })
        : true;
    if (!r.isBombPot && actedPreflop) {
      c.pre++;
      if (ev ? ev.vpip : r.vpip) c.vpip++;
      if (ev ? ev.pfr : r.pfr) c.pfr++;
      if (ev?.limp) c.limp++;
    }
    if (ev) {
      if (ev.threeBetOpportunity) c.tbOpp++;
      if (ev.threeBet) c.tb++;
      if (ev.facedThreeBet) c.f3Opp++;
      if (ev.foldedToThreeBet) c.f3++;
      if (ev.cbetOpportunity) c.cbOpp++;
      if (ev.cbet) c.cb++;
      if (ev.facedCbet) c.fcbOpp++;
      if (ev.foldedToCbet) c.fcb++;
      h.af.aggressive += ev.postflopBets + ev.postflopRaises;
      h.af.calls += ev.postflopCalls;
    }
    if (r.sawFlop) c.flops++;
    // WTSD counts showdowns after seeing a flop (a preflop all-in counts for W$SD only).
    if (r.sawFlop && r.wentToShowdown) c.sd++;
    const evNet = r.allInEvNet ?? r.net;
    if (r.allInEvNet !== null) {
      hasEv = true;
      h.allInHands++;
    }
    h.allInEvNet += evNet;
    h.allInEvBB += evNet / bb;

    // Breakdowns.
    addTo(positions.get(positionGroup(r.position))!, r.net, bb);
    const stakeKey = `${r.variant}:${r.smallBlind}/${r.bigBlind}`;
    if (!stakes.has(stakeKey)) stakes.set(stakeKey, line(stakeKey, `${r.variant === "PLO" ? "PLO " : ""}${r.smallBlind}/${r.bigBlind}`));
    addTo(stakes.get(stakeKey)!, r.net, bb);
    const cls = r.variant === "NLHE" ? handClass(r.holeCards) : null;
    if (cls) {
      const cell = grid.get(cls)!;
      cell.hands++;
      cell.net += r.net;
      cell.netBB += netBB;
    }

    // Sessions.
    const last = sessions[sessions.length - 1];
    if (!last || r.endedAt.getTime() - new Date(last.end).getTime() > SESSION_GAP_MINUTES * 60_000) {
      sessions.push({ start: r.endedAt.toISOString(), end: r.endedAt.toISOString(), hands: 0, net: 0, netBB: 0, tables: [] });
      sessionTables.push(new Set());
    }
    const s = sessions[sessions.length - 1]!;
    s.end = r.endedAt.toISOString();
    s.hands++;
    s.net += r.net;
    s.netBB += netBB;
    sessionTables[sessionTables.length - 1]!.add(r.tableName);

    // Graph.
    cum = {
      net: cum.net + r.net,
      netBB: cum.netBB + netBB,
      ev: cum.ev + evNet,
      evBB: cum.evBB + evNet / bb,
      showdown: cum.showdown + (r.wentToShowdown ? r.net : 0),
      nonShowdown: cum.nonShowdown + (r.wentToShowdown ? 0 : r.net),
      showdownBB: cum.showdownBB + (r.wentToShowdown ? netBB : 0),
      nonShowdownBB: cum.nonShowdownBB + (r.wentToShowdown ? 0 : netBB),
    };
    if ((i + 1) % step === 0 || i === sorted.length - 1) graph.push({ n: i + 1, t: r.endedAt.toISOString(), ...cum });
  });

  const wsdN = sorted.filter((r) => r.wentToShowdown).length;
  const wsdHits = sorted.filter((r) => r.wentToShowdown && r.wonAtShowdown).length;
  h.bb100 = bbPer100(h.netBB, h.hands);
  h.vpip = ratio(c.vpip, c.pre);
  h.pfr = ratio(c.pfr, c.pre);
  h.limp = ratio(c.limp, c.pre);
  h.threeBet = ratio(c.tb, c.tbOpp);
  h.foldToThreeBet = ratio(c.f3, c.f3Opp);
  h.cbet = ratio(c.cb, c.cbOpp);
  h.foldToCbet = ratio(c.fcb, c.fcbOpp);
  h.wtsd = ratio(c.sd, c.flops);
  h.wsd = ratio(wsdHits, wsdN);
  h.af.value = h.af.calls > 0 ? h.af.aggressive / h.af.calls : null;

  const finish = (l: ResultLine) => ({ ...l, bb100: bbPer100(l.netBB, l.hands) });
  const byPosition = [...positions.values()].filter((l) => l.hands > 0).map(finish);
  const byStakes = [...stakes.values()].map(finish).sort((a, b) => b.hands - a.hands);
  const sessionLines = sessions.map((s, i) => ({ ...s, tables: [...sessionTables[i]!] })).reverse();

  return {
    headline: h,
    graph,
    hasEv,
    byPosition,
    byStakes,
    sessions: sessionLines,
    grid: [...grid.values()],
    insights: buildInsights(h, byPosition),
  };
}
