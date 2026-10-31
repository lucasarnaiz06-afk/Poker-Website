// Server-side stats reads: my stats report, money flow, public profile summary. Only aggregated data and the
// user's own cards leave this module.
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { positionGroup, POSITION_GROUP_LABEL, POSITION_GROUPS, type PositionGroup } from "../hands/positions";
import { bbPer100, ratio, SESSION_GAP_MINUTES, type NoteColor, type Ratio } from "./definitions";
import { gridLabels } from "./hand-class";
import { buildInsights } from "./insights";
import {
  MAX_GRAPH_POINTS,
  type GraphPoint,
  type GridCell,
  type ResultLine,
  type SessionLine,
  type StatsHandRow,
  type StatsHeadline,
  type StatsReport,
} from "./report";

export type StatsRange = "7d" | "30d" | "all";
export const STATS_RANGES: readonly StatsRange[] = ["7d", "30d", "all"];

export function parseStatsRange(value: unknown): StatsRange {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "7d" || raw === "30d" || raw === "all" ? raw : "30d";
}

export function rangeStart(range: StatsRange, now = new Date()): Date | null {
  if (range === "all") return null;
  return new Date(now.getTime() - (range === "7d" ? 7 : 30) * 86_400_000);
}

/** Optional filters of the stats report (in addition to the time range). */
export type StatsFilters = {
  /** Position group ("EP", "MP", "CO", "BTN", "SB", "BB"). */
  position?: PositionGroup;
  /** Stakes key as in StatsReport.byStakes: "NLHE:5/10". */
  stakes?: string;
};

const STAKES_KEY = /^(NLHE|PLO):(\d{1,9})\/(\d{1,9})$/;

/** Parses `pos` / `stakes` URL params leniently (invalid values are dropped). */
export function parseStatsFilters(params: Record<string, string | string[] | undefined>): StatsFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const out: StatsFilters = {};
  const pos = first(params.pos);
  if (pos && (POSITION_GROUPS as readonly string[]).includes(pos)) out.position = pos as PositionGroup;
  const stakes = first(params.stakes);
  if (stakes && STAKES_KEY.test(stakes)) out.stakes = stakes;
  return out;
}

/** Positions stored in HandPlayer.position for each group (MP = everything else, see positionGroup). */
const EXPLICIT_GROUP_POSITIONS: Record<Exclude<PositionGroup, "MP">, string[]> = {
  EP: ["UTG", "UTG+1", "UTG+2"],
  CO: ["CO"],
  BTN: ["BTN"],
  SB: ["SB"],
  BB: ["BB"],
};

function filtersSql(since: Date | null, filters: StatsFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (since) parts.push(Prisma.sql`AND hp."createdAt" >= ${since}`);
  if (filters.position === "MP") {
    parts.push(Prisma.sql`AND hp."position" NOT IN (${Prisma.join(Object.values(EXPLICIT_GROUP_POSITIONS).flat())})`);
  } else if (filters.position) {
    parts.push(Prisma.sql`AND hp."position" IN (${Prisma.join(EXPLICIT_GROUP_POSITIONS[filters.position])})`);
  }
  const stakes = filters.stakes ? STAKES_KEY.exec(filters.stakes) : null;
  if (stakes) {
    parts.push(Prisma.sql`AND h."variant" = ${stakes[1]} AND h."smallBlind" = ${Number(stakes[2])} AND h."bigBlind" = ${Number(stakes[3])}`);
  }
  return parts.length > 0 ? Prisma.join(parts, " ") : Prisma.empty;
}

/** Most recent hands loaded by the reference (event-log) implementation below. */
export const STATS_MAX_HANDS = 20_000;

type RawStatsRow = Omit<StatsHandRow, "holeCards" | "events"> & { holeCards: unknown; events: unknown };

/**
 * Reference implementation: loads one row per hand with its event log for computeStatsReport. Slow (it parses
 * every hand's events); the page uses getMyStats (SQL aggregates over the HandPlayer stat columns). Kept to check
 * that both give the same report.
 */
export async function loadStatsRows(userId: string, since: Date | null, max = STATS_MAX_HANDS, filters: StatsFilters = {}): Promise<StatsHandRow[]> {
  const rows = await prisma.$queryRaw<RawStatsRow[]>`
    SELECT hp."handId", COALESCE(h."endedAt", hp."createdAt") AS "endedAt", h."lobbyId", l."name" AS "tableName",
           h."variant", h."smallBlind", h."bigBlind", h."isBombPot", hp."position", hp."holeCards", hp."net", hp."won",
           hp."vpip", hp."pfr", hp."threeBet", hp."sawFlop", hp."wentToShowdown", hp."wonAtShowdown", hp."allInEvNet",
           jsonb_path_query_array(h."events", '$[*] ? (@.type == "ACTION" || @.type == "STREET")') AS "events"
    FROM "HandPlayer" hp
    JOIN "Hand" h ON h."id" = hp."handId"
    JOIN "Lobby" l ON l."id" = h."lobbyId"
    WHERE hp."userId" = ${userId} ${filtersSql(since, filters)}
    ORDER BY hp."createdAt" DESC
    LIMIT ${max}`;
  return rows.map((r) => ({
    ...r,
    holeCards: Array.isArray(r.holeCards) ? (r.holeCards as unknown[]).filter((c): c is string => typeof c === "string") : [],
    events: Array.isArray(r.events) ? (r.events as unknown[]) : [],
  }));
}

export type MyStats = { range: StatsRange; filters: StatsFilters; report: StatsReport };

type Sums = { hands: number; net: number; netBB: number };
type HeadlineSql = Sums & {
  biggestPot: number;
  pre: number;
  vpip: number;
  pfr: number;
  limp: number;
  tbOpp: number;
  tb: number;
  f3Opp: number;
  f3: number;
  cbOpp: number;
  cb: number;
  fcbOpp: number;
  fcb: number;
  aggr: number;
  calls: number;
  flops: number;
  sd: number;
  wsdN: number;
  wsd: number;
  evNet: number;
  evBB: number;
  allIn: number;
  firstT: number | null;
};
type GraphSql = { n: number; t: number; net: number; netBB: number; ev: number; evBB: number; sd: number; nsd: number; sdBB: number; nsdBB: number };
type SessionSql = Sums & { start: number; end: number; tables: string[] | null };
type ReportSqlRow = {
  headline: HeadlineSql;
  positions: Array<Sums & { position: string }> | null;
  stakes: Array<Sums & { variant: string; smallBlind: number; bigBlind: number }> | null;
  grid: Array<Sums & { label: string }> | null;
  graph: GraphSql[] | null;
  sessions: SessionSql[] | null;
};

/**
 * The "My stats" report as SQL aggregates over HandPlayer (one statement, no event logs loaded). Same
 * definitions as computeStatsReport over the event log; the HandPlayer stat columns must be filled
 * (persistCompletedHand does it; older rows: scripts/backfill-hand-stats.ts).
 */
export async function getMyStats(userId: string, range: StatsRange, filters: StatsFilters = {}, now = new Date()): Promise<MyStats> {
  const [row] = await prisma.$queryRaw<ReportSqlRow[]>(statsReportSql(userId, rangeStart(range, now), filters));
  return { range, filters, report: assembleReport(row!) };
}

/** The single statement behind getMyStats (exported for EXPLAIN ANALYZE in scripts/bench-stats.ts). */
export function statsReportSql(userId: string, since: Date | null, filters: StatsFilters = {}): Prisma.Sql {
  return Prisma.sql`
    WITH mine AS MATERIALIZED (
      SELECT hp."handId", COALESCE(h."endedAt", hp."createdAt") AS t, h."lobbyId", h."variant", h."smallBlind", h."bigBlind",
             GREATEST(h."bigBlind", 1)::float8 AS bb, hp."position", hp."handClass", hp."net", hp."won", hp."vpip", hp."pfr",
             hp."threeBet", hp."sawFlop", hp."wentToShowdown", hp."wonAtShowdown", hp."allInEvNet", hp."preflopActed", hp."limp",
             hp."threeBetOpp", hp."facedThreeBet", hp."foldedToThreeBet", hp."cbetOpp", hp."cbet", hp."facedCbet",
             hp."foldedToCbet", hp."postflopAggr", hp."postflopCalls"
      FROM "HandPlayer" hp
      JOIN "Hand" h ON h."id" = hp."handId"
      WHERE hp."userId" = ${userId} ${filtersSql(since, filters)}
    ), ordered AS MATERIALIZED (
      -- Hands in time order: rn (1-based) and session id (a new session after a gap of more than 30 minutes).
      SELECT y.*, SUM(y.gap) OVER (ORDER BY y.t, y."handId" ROWS UNBOUNDED PRECEDING) AS sid
      FROM (
        SELECT m."handId", m.t, m."lobbyId", m."net", m.bb, m."allInEvNet", m."wentToShowdown",
               row_number() OVER o AS rn,
               CASE WHEN lag(m.t) OVER o IS NULL OR m.t - lag(m.t) OVER o > make_interval(mins => ${SESSION_GAP_MINUTES}::int) THEN 1 ELSE 0 END AS gap
        FROM mine m
        WINDOW o AS (ORDER BY m.t, m."handId")
      ) y
    ), buckets AS (
      -- Graph: one point per "step" hands (the last one may be partial), cumulative over the buckets.
      SELECT z.b, MAX(z.rn) AS n, MAX(z.t) AS t,
             SUM(SUM(z."net")) OVER b AS c_net, SUM(SUM(z."net" / z.bb)) OVER b AS c_bb,
             SUM(SUM(COALESCE(z."allInEvNet", z."net"))) OVER b AS c_ev, SUM(SUM(COALESCE(z."allInEvNet", z."net") / z.bb)) OVER b AS c_evbb,
             SUM(SUM(CASE WHEN z."wentToShowdown" THEN z."net" ELSE 0 END)) OVER b AS c_sd,
             SUM(SUM(CASE WHEN z."wentToShowdown" THEN 0 ELSE z."net" END)) OVER b AS c_nsd,
             SUM(SUM(CASE WHEN z."wentToShowdown" THEN z."net" / z.bb ELSE 0 END)) OVER b AS c_sdbb,
             SUM(SUM(CASE WHEN z."wentToShowdown" THEN 0 ELSE z."net" / z.bb END)) OVER b AS c_nsdbb
      FROM (
        SELECT o.*, (o.rn - 1) / st.step AS b
        FROM ordered o, (SELECT GREATEST(1, CEIL(COUNT(*) / ${MAX_GRAPH_POINTS}::numeric))::bigint AS step FROM mine) st
      ) z
      GROUP BY z.b
      WINDOW b AS (ORDER BY z.b ROWS UNBOUNDED PRECEDING)
    )
    SELECT
      (SELECT json_build_object(
         'hands', COUNT(*), 'net', COALESCE(SUM("net"), 0), 'netBB', COALESCE(SUM("net" / bb), 0), 'biggestPot', COALESCE(MAX("won"), 0),
         'pre', COUNT(*) FILTER (WHERE "preflopActed"),
         'vpip', COUNT(*) FILTER (WHERE "preflopActed" AND "vpip"),
         'pfr', COUNT(*) FILTER (WHERE "preflopActed" AND "pfr"),
         'limp', COUNT(*) FILTER (WHERE "preflopActed" AND "limp"),
         'tbOpp', COUNT(*) FILTER (WHERE "threeBetOpp"), 'tb', COUNT(*) FILTER (WHERE "threeBetOpp" AND "threeBet"),
         'f3Opp', COUNT(*) FILTER (WHERE "facedThreeBet"), 'f3', COUNT(*) FILTER (WHERE "foldedToThreeBet"),
         'cbOpp', COUNT(*) FILTER (WHERE "cbetOpp"), 'cb', COUNT(*) FILTER (WHERE "cbet"),
         'fcbOpp', COUNT(*) FILTER (WHERE "facedCbet"), 'fcb', COUNT(*) FILTER (WHERE "foldedToCbet"),
         'aggr', COALESCE(SUM("postflopAggr"), 0), 'calls', COALESCE(SUM("postflopCalls"), 0),
         'flops', COUNT(*) FILTER (WHERE "sawFlop"), 'sd', COUNT(*) FILTER (WHERE "sawFlop" AND "wentToShowdown"),
         'wsdN', COUNT(*) FILTER (WHERE "wentToShowdown"), 'wsd', COUNT(*) FILTER (WHERE "wentToShowdown" AND "wonAtShowdown"),
         'evNet', COALESCE(SUM(COALESCE("allInEvNet", "net")), 0), 'evBB', COALESCE(SUM(COALESCE("allInEvNet", "net") / bb), 0),
         'allIn', COUNT("allInEvNet"),
         'firstT', (EXTRACT(EPOCH FROM MIN(t)) * 1000)::bigint
       ) FROM mine) AS headline,
      (SELECT json_agg(json_build_object('position', "position", 'hands', hands, 'net', net, 'netBB', nbb))
       FROM (SELECT "position", COUNT(*) AS hands, SUM("net") AS net, SUM("net" / bb) AS nbb FROM mine GROUP BY "position") p) AS positions,
      (SELECT json_agg(json_build_object('variant', "variant", 'smallBlind', "smallBlind", 'bigBlind', "bigBlind", 'hands', hands, 'net', net, 'netBB', nbb)
                       ORDER BY hands DESC, first_t ASC)
       FROM (SELECT "variant", "smallBlind", "bigBlind", COUNT(*) AS hands, SUM("net") AS net, SUM("net" / bb) AS nbb, MIN(t) AS first_t
             FROM mine GROUP BY 1, 2, 3) s) AS stakes,
      (SELECT json_agg(json_build_object('label', "handClass", 'hands', hands, 'net', net, 'netBB', nbb))
       FROM (SELECT "handClass", COUNT(*) AS hands, SUM("net") AS net, SUM("net" / bb) AS nbb FROM mine WHERE "handClass" IS NOT NULL GROUP BY 1) g) AS grid,
      (SELECT json_agg(json_build_object('n', n, 't', (EXTRACT(EPOCH FROM t) * 1000)::bigint, 'net', c_net, 'netBB', c_bb, 'ev', c_ev, 'evBB', c_evbb,
                                         'sd', c_sd, 'nsd', c_nsd, 'sdBB', c_sdbb, 'nsdBB', c_nsdbb) ORDER BY b)
       FROM buckets) AS graph,
      (SELECT json_agg(json_build_object('start', (EXTRACT(EPOCH FROM s.start) * 1000)::bigint, 'end', (EXTRACT(EPOCH FROM s.end) * 1000)::bigint,
                                         'hands', s.hands, 'net', s.net, 'netBB', s.nbb, 'tables', tl.tables) ORDER BY s.sid DESC)
       FROM (SELECT sid, MIN(t) AS start, MAX(t) AS "end", COUNT(*) AS hands, SUM("net") AS net, SUM("net" / bb) AS nbb FROM ordered GROUP BY sid) s
       LEFT JOIN (
         SELECT f.sid, json_agg(l."name" ORDER BY f.first_rn) AS tables
         FROM (SELECT sid, "lobbyId", MIN(rn) AS first_rn FROM ordered GROUP BY sid, "lobbyId") f
         JOIN "Lobby" l ON l."id" = f."lobbyId"
         GROUP BY f.sid
       ) tl ON tl.sid = s.sid) AS sessions`;
}

function sumsLine(key: string, label: string, s: Sums): ResultLine {
  return { key, label, hands: s.hands, net: s.net, netBB: s.netBB, bb100: bbPer100(s.netBB, s.hands) };
}

function assembleReport(row: ReportSqlRow): StatsReport {
  const c = row.headline;
  const h: StatsHeadline = {
    hands: c.hands,
    net: c.net,
    netBB: c.netBB,
    bb100: bbPer100(c.netBB, c.hands),
    vpip: ratio(c.vpip, c.pre),
    pfr: ratio(c.pfr, c.pre),
    limp: ratio(c.limp, c.pre),
    threeBet: ratio(c.tb, c.tbOpp),
    foldToThreeBet: ratio(c.f3, c.f3Opp),
    cbet: ratio(c.cb, c.cbOpp),
    foldToCbet: ratio(c.fcb, c.fcbOpp),
    wtsd: ratio(c.sd, c.flops),
    wsd: ratio(c.wsd, c.wsdN),
    af: { value: c.calls > 0 ? c.aggr / c.calls : null, aggressive: c.aggr, calls: c.calls },
    allInEvNet: c.evNet,
    allInEvBB: c.evBB,
    allInHands: c.allIn,
    biggestPot: c.biggestPot,
  };

  const groups = new Map<PositionGroup, Sums>(POSITION_GROUPS.map((g) => [g, { hands: 0, net: 0, netBB: 0 }]));
  for (const p of row.positions ?? []) {
    const g = groups.get(positionGroup(p.position))!;
    g.hands += p.hands;
    g.net += p.net;
    g.netBB += p.netBB;
  }
  const byPosition = [...groups].filter(([, s]) => s.hands > 0).map(([g, s]) => sumsLine(g, POSITION_GROUP_LABEL[g], s));
  const byStakes = (row.stakes ?? []).map((s) =>
    sumsLine(`${s.variant}:${s.smallBlind}/${s.bigBlind}`, `${s.variant === "PLO" ? "PLO " : ""}${s.smallBlind}/${s.bigBlind}`, s),
  );

  const cells = new Map((row.grid ?? []).map((g) => [g.label, g]));
  const grid: GridCell[] = gridLabels().map((label) => {
    const g = cells.get(label);
    return { label, hands: g?.hands ?? 0, net: g?.net ?? 0, netBB: g?.netBB ?? 0 };
  });

  const iso = (ms: number) => new Date(Number(ms)).toISOString();
  const graph: GraphPoint[] = [
    { n: 0, t: iso(c.firstT ?? 0), net: 0, netBB: 0, ev: 0, evBB: 0, showdown: 0, nonShowdown: 0, showdownBB: 0, nonShowdownBB: 0 },
    ...(row.graph ?? []).map((g) => ({
      n: g.n,
      t: iso(g.t),
      net: g.net,
      netBB: g.netBB,
      ev: g.ev,
      evBB: g.evBB,
      showdown: g.sd,
      nonShowdown: g.nsd,
      showdownBB: g.sdBB,
      nonShowdownBB: g.nsdBB,
    })),
  ];
  const sessions: SessionLine[] = (row.sessions ?? []).map((s) => ({
    start: iso(s.start),
    end: iso(s.end),
    hands: s.hands,
    net: s.net,
    netBB: s.netBB,
    tables: s.tables ?? [],
  }));

  return { headline: h, graph, hasEv: c.allIn > 0, byPosition, byStakes, sessions, grid, insights: buildInsights(h, byPosition) };
}

export type MoneyFlowLine = {
  userId: string;
  username: string | null;
  displayName: string;
  avatar: string | null;
  hands: number;
  /** Chips the viewer won from (positive) or lost to (negative) this player. */
  net: number;
  netBB: number;
  noteColor: NoteColor | null;
};

export type MoneyFlow = { wonFrom: MoneyFlowLine[]; lostTo: MoneyFlowLine[]; opponents: number };

/**
 * Who the user won from / lost to. In each hand the user's result is split across the opponents on the other
 * side of it in proportion to their own results (a pot you win came from the players who lost chips in it).
 * Whole UTC days come from PlayerOpponentDaily; the partial first day of the range is computed from its hands.
 */
export async function getMoneyFlow(userId: string, since: Date | null, limit = 5): Promise<MoneyFlow> {
  let partial = Prisma.sql`SELECT NULL::text AS "userId", 0 AS hands, 0::float8 AS flow, 0::float8 AS "flowBB" WHERE false`;
  let dailySince = Prisma.empty;
  if (since) {
    const sinceDay = since.toISOString().slice(0, 10);
    const nextDay = new Date(Date.parse(`${sinceDay}T00:00:00.000Z`) + 86_400_000);
    dailySince = Prisma.sql`AND d."day" > ${sinceDay}`;
    partial = Prisma.sql`
      WITH mine AS (
        SELECT hp."handId", hp."net" FROM "HandPlayer" hp
        WHERE hp."userId" = ${userId} AND hp."createdAt" >= ${since} AND hp."createdAt" < ${nextDay}
      ), totals AS (
        SELECT o."handId", SUM(GREATEST(o."net", 0))::float8 AS wins, SUM(GREATEST(-o."net", 0))::float8 AS losses
        FROM "HandPlayer" o JOIN mine m ON m."handId" = o."handId"
        GROUP BY o."handId"
      ), flows AS (
        SELECT o."userId", h."bigBlind",
          CASE
            WHEN m."net" > 0 AND o."net" < 0 AND t.losses > 0 THEN m."net"::float8 * (-o."net") / t.losses
            WHEN m."net" < 0 AND o."net" > 0 AND t.wins > 0 THEN m."net"::float8 * o."net" / t.wins
            ELSE 0
          END AS flow
        FROM mine m
        JOIN "HandPlayer" o ON o."handId" = m."handId" AND o."userId" <> ${userId}
        JOIN totals t ON t."handId" = m."handId"
        JOIN "Hand" h ON h."id" = m."handId"
      )
      SELECT f."userId", COUNT(*)::int AS hands, SUM(f.flow)::float8 AS flow, SUM(f.flow / GREATEST(f."bigBlind", 1))::float8 AS "flowBB"
      FROM flows f
      GROUP BY f."userId"`;
  }
  const rows = await prisma.$queryRaw<Array<{ userId: string; hands: number; flow: number; flowBB: number }>>`
    SELECT x."userId", SUM(x.hands)::int AS hands, SUM(x.flow)::float8 AS flow, SUM(x."flowBB")::float8 AS "flowBB"
    FROM (
      (${partial})
      UNION ALL
      SELECT d."opponentId" AS "userId", SUM(d."hands")::int AS hands, SUM(d."flow")::float8 AS flow, SUM(d."flowBB")::float8 AS "flowBB"
      FROM "PlayerOpponentDaily" d
      WHERE d."userId" = ${userId} ${dailySince}
      GROUP BY d."opponentId"
    ) x
    GROUP BY x."userId"`;
  const won = rows.filter((r) => r.flow >= 0.5).sort((a, b) => b.flow - a.flow).slice(0, limit);
  const lost = rows.filter((r) => r.flow <= -0.5).sort((a, b) => a.flow - b.flow).slice(0, limit);
  const ids = [...won, ...lost].map((r) => r.userId);
  const [users, notes] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, displayName: true, avatar: true, deletedAt: true } }),
    prisma.playerNote.findMany({ where: { ownerId: userId, subjectId: { in: ids } }, select: { subjectId: true, color: true } }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const colorById = new Map(notes.map((n) => [n.subjectId, n.color as NoteColor]));
  const toLine = (r: (typeof rows)[number]): MoneyFlowLine => {
    const u = userById.get(r.userId);
    const deleted = !u || u.deletedAt !== null;
    return {
      userId: r.userId,
      username: deleted ? null : (u?.username ?? null),
      displayName: deleted ? "Deleted player" : (u?.displayName ?? u?.username ?? "Player"),
      avatar: deleted ? null : (u?.avatar ?? null),
      hands: r.hands,
      net: Math.round(r.flow),
      netBB: r.flowBB,
      noteColor: colorById.get(r.userId) ?? null,
    };
  };
  return { wonFrom: won.map(toLine), lostTo: lost.map(toLine), opponents: rows.length };
}

export type PublicStatsSummary = {
  hands: number;
  net: number;
  bb100: number | null;
  vpip: Ratio;
  pfr: Ratio;
  showdownsWon: number;
  biggestPot: number;
  biggestPotHandId: string | null;
  memberSince: string;
  /** Net per day for the last 14 UTC days, oldest first (0 on days without play). */
  recentForm: Array<{ day: string; net: number; hands: number }>;
  lastPlayedAt: string | null;
};

export async function getPublicStatsSummary(userId: string, now = new Date()): Promise<PublicStatsSummary | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, deletedAt: true, status: true } });
  if (!user || user.deletedAt) return null;
  const [agg, bb, recent, biggest, last] = await Promise.all([
    prisma.playerDailyStat.aggregate({
      where: { userId },
      _sum: { hands: true, net: true, vpipHands: true, pfrHands: true, showdownsWon: true },
      _max: { biggestPotWon: true },
    }),
    prisma.playerDailyStat.aggregate({ where: { userId }, _sum: { netCentiBB: true, bombPotHands: true } }),
    prisma.playerDailyStat.findMany({
      where: { userId, day: { gte: new Date(now.getTime() - 13 * 86_400_000).toISOString().slice(0, 10) } },
      select: { day: true, net: true, hands: true },
    }),
    prisma.handPlayer.findFirst({ where: { userId }, orderBy: [{ won: "desc" }, { createdAt: "desc" }], select: { handId: true, won: true } }),
    prisma.handPlayer.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const hands = agg._sum.hands ?? 0;
  // Daily VPIP/PFR counters include bomb pots (no preflop decisions): leave them out of the denominator.
  const preflopHands = Math.max(0, hands - (bb._sum.bombPotHands ?? 0));
  const byDay = new Map(recent.map((r) => [r.day, r]));
  const recentForm: PublicStatsSummary["recentForm"] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    recentForm.push({ day, net: byDay.get(day)?.net ?? 0, hands: byDay.get(day)?.hands ?? 0 });
  }
  return {
    hands,
    net: agg._sum.net ?? 0,
    bb100: bbPer100((bb._sum.netCentiBB ?? 0) / 100, hands),
    vpip: ratio(agg._sum.vpipHands ?? 0, preflopHands),
    pfr: ratio(agg._sum.pfrHands ?? 0, preflopHands),
    showdownsWon: agg._sum.showdownsWon ?? 0,
    biggestPot: Math.max(agg._max.biggestPotWon ?? 0, biggest?.won ?? 0),
    biggestPotHandId: biggest && biggest.won > 0 ? biggest.handId : null,
    memberSince: user.createdAt.toISOString(),
    recentForm,
    lastPlayedAt: last?.createdAt.toISOString() ?? null,
  };
}
