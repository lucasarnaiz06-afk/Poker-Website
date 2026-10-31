// The SQL aggregates (HandPlayer stat columns, PlayerDailyStat.netCentiBB, PlayerOpponentDaily) must give the
// same answers as the event-log computations they replaced.
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, prisma, resetDatabase } from "../../test/db";
import { botHandInput, createTestLobby } from "../../test/hand-fixtures";
import { persistCompletedHand, recordSidePayments } from "../hands/persist";
import { backfillHandPlayerStats, rebuildDailyAggregates } from "./backfill";
import { computeEventStats } from "./event-stats";
import { HAND_PLAYER_STATS_VERSION, netCentiBB } from "./hand-player-stats";
import { getLeaderboard } from "./leaderboard";
import { getMoneyFlow, getMyStats, getPublicStatsSummary, loadStatsRows, type StatsFilters, type StatsRange } from "./queries";
import { computeStatsReport } from "./report";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Deep equality with a relative tolerance for floats (sums of net / bigBlind are added in a different order). */
function expectClose(actual: unknown, expected: unknown, path = "$"): void {
  if (typeof expected === "number" && typeof actual === "number") {
    const tol = 1e-7 * Math.max(1, Math.abs(expected));
    if (Math.abs(actual - expected) > tol) throw new Error(`${path}: ${actual} !== ${expected}`);
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      throw new Error(`${path}: length ${Array.isArray(actual) ? actual.length : "n/a"} !== ${expected.length}`);
    }
    expected.forEach((e, i) => expectClose(actual[i], e, `${path}[${i}]`));
    return;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") throw new Error(`${path}: not an object`);
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const k of keys) expectClose((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  if (actual !== expected) throw new Error(`${path}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

/**
 * ~160 hands at two tables / stakes over the last 3 days: 2-5 players, bomb pots, sessions split by gaps,
 * side payments (incl. one to a player who was not dealt in).
 */
async function seedFixtures() {
  const users = await Promise.all(Array.from({ length: 5 }, () => createTestUser()));
  const ids = users.map((u) => u.id);
  const lobbies = [await createTestLobby(ids[0]!, "Five ten"), await createTestLobby(ids[0]!, "Ten twenty")];
  let t = Date.now() - 3 * 86_400_000;
  for (let i = 0; i < 160; i++) {
    const table = i % 3 === 0 ? 1 : 0;
    const players = ids.slice(i % 2, (i % 2) + 2 + (i % 4));
    t += i % 25 === 0 ? 3 * 3600_000 : 45_000 + (i % 7) * 20_000;
    const sidePayments =
      i % 19 === 5 ? [{ reason: "BOUNTY_7_2" as const, fromUserId: players[1]!, toUserId: players[0]!, amount: 15 }] : i % 23 === 7 ? [{ reason: "NIT_GAME" as const, fromUserId: players[0]!, toUserId: ids[4]!, amount: 10 }] : [];
    const { input } = botHandInput({
      lobbyId: lobbies[table]!.id,
      handNumber: i + 1,
      userIds: players,
      seed: 500 + i,
      endedAt: new Date(t),
      bombPot: i % 11 === 0,
      blinds: table === 1 ? [10, 20] : [5, 10],
      sidePayments: sidePayments.filter((p) => p.fromUserId !== p.toUserId && (p.reason !== "NIT_GAME" || !players.includes(ids[4]!))),
    });
    await prisma.$transaction((tx) => persistCompletedHand(tx, input));
  }
  return ids;
}

async function referenceReport(userId: string, range: StatsRange, filters: StatsFilters, now: Date) {
  const since = range === "all" ? null : new Date(now.getTime() - (range === "7d" ? 7 : 30) * 86_400_000);
  return computeStatsReport(await loadStatsRows(userId, since, 1_000_000, filters), userId);
}

/** The pre-aggregate money-flow query (raw hands). */
async function referenceMoneyFlow(userId: string, since: Date | null) {
  const sinceSql = since ? Prisma.sql`AND hp."createdAt" >= ${since}` : Prisma.empty;
  return prisma.$queryRaw<Array<{ userId: string; hands: number; flow: number; flowBB: number }>>`
    WITH mine AS (SELECT hp."handId", hp."net" FROM "HandPlayer" hp WHERE hp."userId" = ${userId} ${sinceSql}),
    totals AS (
      SELECT o."handId", SUM(GREATEST(o."net", 0))::float8 AS wins, SUM(GREATEST(-o."net", 0))::float8 AS losses
      FROM "HandPlayer" o JOIN mine m ON m."handId" = o."handId" GROUP BY o."handId"
    ), flows AS (
      SELECT o."userId", h."bigBlind",
        CASE WHEN m."net" > 0 AND o."net" < 0 AND t.losses > 0 THEN m."net"::float8 * (-o."net") / t.losses
             WHEN m."net" < 0 AND o."net" > 0 AND t.wins > 0 THEN m."net"::float8 * o."net" / t.wins ELSE 0 END AS flow
      FROM mine m JOIN "HandPlayer" o ON o."handId" = m."handId" AND o."userId" <> ${userId}
      JOIN totals t ON t."handId" = m."handId" JOIN "Hand" h ON h."id" = m."handId"
    )
    SELECT f."userId", COUNT(*)::int AS hands, SUM(f.flow)::float8 AS flow, SUM(f.flow / GREATEST(f."bigBlind", 1))::float8 AS "flowBB"
    FROM flows f GROUP BY f."userId"`;
}

describe("HandPlayer stat columns", () => {
  it("are written at persist time with the event-log definitions, and the backfill reproduces them", async () => {
    await seedFixtures();
    const hands = await prisma.hand.findMany({ include: { players: true } });
    let opportunities = 0;
    for (const hand of hands) {
      const ev = computeEventStats(hand.events as unknown[], { isBombPot: hand.isBombPot });
      for (const p of hand.players) {
        const e = ev.get(p.userId)!;
        expect(p.statsVersion).toBe(HAND_PLAYER_STATS_VERSION);
        expect({
          threeBetOpp: p.threeBetOpp,
          facedThreeBet: p.facedThreeBet,
          foldedToThreeBet: p.foldedToThreeBet,
          cbetOpp: p.cbetOpp,
          cbet: p.cbet,
          facedCbet: p.facedCbet,
          foldedToCbet: p.foldedToCbet,
          limp: p.limp,
          postflopAggr: p.postflopAggr,
          postflopCalls: p.postflopCalls,
          threeBet: p.threeBet,
          vpip: p.vpip,
        }).toEqual({
          threeBetOpp: e.threeBetOpportunity,
          facedThreeBet: e.facedThreeBet,
          foldedToThreeBet: e.foldedToThreeBet,
          cbetOpp: e.cbetOpportunity,
          cbet: e.cbet,
          facedCbet: e.facedCbet,
          foldedToCbet: e.foldedToCbet,
          limp: e.limp,
          postflopAggr: e.postflopBets + e.postflopRaises,
          postflopCalls: e.postflopCalls,
          threeBet: e.threeBet,
          vpip: e.vpip,
        });
        if (hand.isBombPot) expect(p.preflopActed).toBe(false);
        if (p.cbetOpp || p.facedCbet || p.threeBetOpp) opportunities++;
      }
    }
    expect(opportunities).toBeGreaterThan(20);

    const before = await prisma.handPlayer.findMany({ orderBy: { id: "asc" } });
    await prisma.handPlayer.updateMany({
      data: {
        statsVersion: 0,
        preflopActed: false,
        limp: false,
        threeBetOpp: false,
        facedThreeBet: false,
        foldedToThreeBet: false,
        cbetOpp: false,
        cbet: false,
        facedCbet: false,
        foldedToCbet: false,
        postflopAggr: 0,
        postflopCalls: 0,
        handClass: null,
      },
    });
    // Two passes: stop after the first batches, then resume from the cursor.
    let batches = 0;
    const first = await backfillHandPlayerStats({ batchSize: 40, onBatch: () => batches++ });
    expect(batches).toBe(Math.ceil(hands.length / 40));
    expect(first.hands).toBe(hands.length);
    const again = await backfillHandPlayerStats({ batchSize: 40 });
    expect(again.rows).toBe(0);
    expect(await prisma.handPlayer.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
});

describe("SQL stats report", () => {
  it("equals the event-log report for every player, range and filter", async () => {
    const ids = await seedFixtures();
    const now = new Date();
    const cases: Array<[StatsRange, StatsFilters]> = [
      ["all", {}],
      ["7d", {}],
      ["all", { position: "BTN" }],
      ["all", { position: "MP" }],
      ["all", { position: "EP" }],
      ["30d", { stakes: "NLHE:10/20" }],
      ["all", { position: "BB", stakes: "NLHE:5/10" }],
    ];
    let compared = 0;
    for (const userId of ids) {
      for (const [range, filters] of cases) {
        const sql = await getMyStats(userId, range, filters, now);
        const ref = await referenceReport(userId, range, filters, now);
        try {
          expectClose(sql.report, ref);
        } catch (error) {
          throw new Error(`${userId} ${range} ${JSON.stringify(filters)}: ${(error as Error).message}`);
        }
        compared += ref.headline.hands;
      }
    }
    // A range that starts in the middle of the fixtures (as seen from 4.5 days ahead).
    const later = new Date(now.getTime() + 4.5 * 86_400_000);
    for (const userId of ids) {
      const ref = await referenceReport(userId, "7d", {}, later);
      expect(ref.headline.hands).toBeGreaterThan(0);
      expectClose((await getMyStats(userId, "7d", {}, later)).report, ref);
    }
    expect(compared).toBeGreaterThan(500);
    // The fixtures exercise every part of the report.
    const r = (await getMyStats(ids[1]!, "all", {}, now)).report;
    expect(r.sessions.length).toBeGreaterThan(3);
    expect(r.byStakes).toHaveLength(2);
    expect(r.headline.threeBet.n + r.headline.cbet.n + r.headline.foldToCbet.n).toBeGreaterThan(0);
    expect(r.grid.some((c) => c.hands > 0)).toBe(true);
    const empty = await getMyStats((await createTestUser()).id, "all");
    expectClose(empty.report, computeStatsReport([], "x"));
  });

  it("samples the graph like the event-log report on long histories", async () => {
    const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
    const lobby = await createTestLobby(a.id);
    const start = Date.now() - 86_400_000;
    for (let i = 0; i < 430; i++) {
      const { input } = botHandInput({ lobbyId: lobby.id, handNumber: i + 1, userIds: [a.id, b.id], seed: i, endedAt: new Date(start + i * 30_000) });
      await prisma.$transaction((tx) => persistCompletedHand(tx, { ...input, allInEv: false }));
    }
    const sql = await getMyStats(a.id, "all");
    expect(sql.report.graph.length).toBeLessThan(430);
    expectClose(sql.report, await referenceReport(a.id, "all", {}, new Date()));
  });
});

describe("daily aggregates", () => {
  it("netCentiBB, bomb pots and money flow match the raw hands; a rebuild reproduces them", async () => {
    const ids = await seedFixtures();
    const rows = await prisma.handPlayer.findMany({ include: { hand: { select: { bigBlind: true, isBombPot: true } } } });
    for (const userId of ids) {
      const mine = rows.filter((r) => r.userId === userId);
      const daily = await prisma.playerDailyStat.findMany({ where: { userId } });
      expect(daily.reduce((s, d) => s + d.netCentiBB, 0)).toBe(mine.reduce((s, r) => s + netCentiBB(r.net, r.hand.bigBlind), 0));
      expect(daily.reduce((s, d) => s + d.bombPotHands, 0)).toBe(mine.filter((r) => r.hand.isBombPot).length);

      for (const since of [null, new Date(Date.now() - 2 * 86_400_000 - 5 * 3600_000), new Date(Date.now() - 86_400_000)]) {
        const ref = await referenceMoneyFlow(userId, since);
        const flow = await getMoneyFlow(userId, since, 10);
        expect(flow.opponents).toBe(ref.length);
        for (const line of [...flow.wonFrom, ...flow.lostTo]) {
          const r = ref.find((x) => x.userId === line.userId)!;
          expect(line.hands).toBe(r.hands);
          expect(line.net).toBe(Math.round(r.flow));
          expect(line.netBB).toBeCloseTo(r.flowBB, 6);
        }
      }
    }

    // Rebuilding from HandPlayer (the migration's backfill SQL) gives the incremental values. The side payment to
    // a player who was not dealt in only lives in PlayerDailyStat.net, so compare the other columns.
    const snapshot = async () => ({
      daily: (await prisma.playerDailyStat.findMany({ where: { hands: { gt: 0 } }, orderBy: [{ userId: "asc" }, { day: "asc" }] })).map(
        ({ net: _net, ...rest }) => rest,
      ),
      opponents: await prisma.playerOpponentDaily.findMany({ orderBy: [{ userId: "asc" }, { day: "asc" }, { opponentId: "asc" }] }),
    });
    const before = await snapshot();
    await prisma.$transaction((tx) => rebuildDailyAggregates(tx, ids));
    expectClose(await snapshot(), before);
  });

  it("recordSidePayments keeps netCentiBB and money flow in step with HandPlayer.net", async () => {
    const [u1, u2, u3, outsider] = await Promise.all([createTestUser(), createTestUser(), createTestUser(), createTestUser()]);
    const lobby = await createTestLobby(u1.id);
    const { input } = botHandInput({ lobbyId: lobby.id, handNumber: 1, userIds: [u1.id, u2.id, u3.id], seed: 41, blinds: [10, 30] });
    const { handId } = await prisma.$transaction((tx) => persistCompletedHand(tx, input));
    await prisma.$transaction((tx) =>
      recordSidePayments(tx, {
        handId,
        payments: [
          { reason: "BOUNTY_7_2", fromUserId: u2.id, toUserId: u1.id, amount: 45 },
          { reason: "NIT_GAME", fromUserId: u3.id, toUserId: outsider.id, amount: 17 },
        ],
      }),
    );
    const players = await prisma.handPlayer.findMany({ where: { handId } });
    for (const p of players) {
      const d = await prisma.playerDailyStat.findFirstOrThrow({ where: { userId: p.userId } });
      expect(d.netCentiBB).toBe(netCentiBB(p.net, 30));
    }
    const outsiderDaily = await prisma.playerDailyStat.findFirstOrThrow({ where: { userId: outsider.id } });
    expect(outsiderDaily).toMatchObject({ hands: 0, net: 17, netCentiBB: 0 });
    for (const p of players) {
      const ref = await referenceMoneyFlow(p.userId, null);
      const flow = await getMoneyFlow(p.userId, null, 10);
      for (const line of [...flow.wonFrom, ...flow.lostTo]) {
        expect(line.netBB).toBeCloseTo(ref.find((r) => r.userId === line.userId)!.flowBB, 9);
      }
    }
  });
});

describe("leaderboard and profile from PlayerDailyStat", () => {
  it("bb/100 = netCentiBB / hands for players with 500+ hands in the period", async () => {
    const now = new Date(Date.UTC(2026, 9, 29, 15));
    const [a, b, c] = await Promise.all([createTestUser({ username: "bbwin" }), createTestUser({ username: "bblose" }), createTestUser({ username: "bbfew" })]);
    await prisma.playerDailyStat.createMany({
      data: [
        { userId: a.id, day: "2026-10-27", hands: 300, net: 900, netCentiBB: 9_000 },
        { userId: a.id, day: "2026-10-28", hands: 300, net: 300, netCentiBB: 3_000 },
        { userId: b.id, day: "2026-10-28", hands: 800, net: -400, netCentiBB: -4_000 },
        { userId: c.id, day: "2026-10-28", hands: 499, net: 10_000, netCentiBB: 100_000 },
        { userId: a.id, day: "2026-09-01", hands: 1000, net: -50_000, netCentiBB: -500_000 },
      ],
    });
    const week = await getLeaderboard({ metric: "bb100", period: "week", now, hideSeed: false });
    expect(week.rows.map((r) => [r.username, r.rank, r.hands])).toEqual([
      ["bbwin", 1, 600],
      ["bblose", 2, 800],
    ]);
    expect(week.rows[0]!.value).toBeCloseTo(12_000 / 600);
    expect(week.rows[1]!.value).toBeCloseTo(-4_000 / 800);
    const all = await getLeaderboard({ metric: "bb100", period: "all", now, hideSeed: false });
    expect(all.rows.map((r) => r.username)).toEqual(["bblose", "bbwin"]);
  });

  it("the public summary's bb/100 and VPIP denominator match the hands", async () => {
    const ids = await seedFixtures();
    const rows = await prisma.handPlayer.findMany({ where: { userId: ids[1] }, include: { hand: { select: { bigBlind: true, isBombPot: true } } } });
    const s = (await getPublicStatsSummary(ids[1]!))!;
    expect(s.hands).toBe(rows.length);
    expect(s.bb100).toBeCloseTo(rows.reduce((sum, r) => sum + netCentiBB(r.net, r.hand.bigBlind), 0) / rows.length, 9);
    expect(s.vpip.n).toBe(rows.filter((r) => !r.hand.isBombPot).length);
  });
});
