import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, prisma, resetDatabase } from "../../test/db";
import { botHandInput, createTestLobby, persistBotHands } from "../../test/hand-fixtures";
import { ratio } from "./definitions";
import { computeEventStats } from "./event-stats";
import { gridLabels, handClass } from "./hand-class";
import { buildInsights } from "./insights";
import { getLeaderboard, periodStartDay } from "./leaderboard";
import { getPlayerNote, NoteError, savePlayerNote } from "./notes";
import { getMoneyFlow, getMyStats, getPublicStatsSummary } from "./queries";
import { computeStatsReport, type StatsHandRow } from "./report";

describe("stat definitions", () => {
  it("event-derived flags match the engine's PokerTracker flags on 400 bot hands", () => {
    for (let i = 0; i < 400; i++) {
      const ids = ["a", "b", "c", "d", "e", "f"].slice(0, 2 + (i % 5));
      const { result } = botHandInput({ lobbyId: "l", handNumber: i, userIds: ids, seed: 1000 + i, bombPot: i % 13 === 0 });
      const derived = computeEventStats(result.events, { isBombPot: result.summary.isBombPot });
      for (const p of result.summary.players) {
        const d = derived.get(p.id)!;
        const e = p.stats;
        expect({
          vpip: d.vpip,
          pfr: d.pfr,
          threeBet: d.threeBet,
          threeBetOpportunity: d.threeBetOpportunity,
          facedThreeBet: d.facedThreeBet,
          foldedToThreeBet: d.foldedToThreeBet,
          cbet: d.cbet,
          cbetOpportunity: d.cbetOpportunity,
          sawFlop: d.sawFlop,
          bets: d.postflopBets,
          raises: d.postflopRaises,
          calls: d.postflopCalls,
        }).toEqual({
          vpip: e.vpip,
          pfr: e.pfr,
          threeBet: e.threeBet,
          threeBetOpportunity: e.threeBetOpportunity,
          facedThreeBet: e.facedThreeBet,
          foldedToThreeBet: e.foldedToThreeBet,
          cbet: e.cbet,
          cbetOpportunity: e.cbetOpportunity,
          sawFlop: e.sawFlop,
          bets: e.postflopBets,
          raises: e.postflopRaises,
          calls: e.postflopCalls,
        });
        if (d.foldedToCbet) expect(d.facedCbet).toBe(true);
        if (d.limp) expect(d.vpip && !d.pfr ? true : d.vpip).toBe(true);
      }
    }
  });

  it("classifies starting hands and builds a 169-cell grid", () => {
    expect(handClass(["As", "Ks"])).toBe("AKs");
    expect(handClass(["2d", "Ah"])).toBe("A2o");
    expect(handClass(["Tc", "Td"])).toBe("TT");
    expect(handClass(["As", "Ks", "Qs", "Js"])).toBeNull();
    const labels = gridLabels();
    expect(labels).toHaveLength(169);
    expect(new Set(labels).size).toBe(169);
    expect(labels[0]).toBe("AA");
    expect(labels[1]).toBe("AKs");
    expect(labels[13]).toBe("AKo");
  });

  it("ratios are null without opportunities", () => {
    expect(ratio(0, 0).value).toBeNull();
    expect(ratio(1, 4).value).toBe(25);
  });
});

function row(partial: Partial<StatsHandRow> & { endedAt: Date; net: number }): StatsHandRow {
  return {
    handId: `h${partial.endedAt.getTime()}`,
    lobbyId: "l1",
    tableName: "Table",
    variant: "NLHE",
    smallBlind: 5,
    bigBlind: 10,
    isBombPot: false,
    position: "BTN",
    holeCards: ["As", "Kd"],
    won: Math.max(0, partial.net),
    vpip: true,
    pfr: true,
    threeBet: false,
    sawFlop: true,
    wentToShowdown: false,
    wonAtShowdown: false,
    allInEvNet: null,
    events: [],
    ...partial,
  };
}

describe("computeStatsReport", () => {
  it("computes totals, bb/100, sessions (30 min gap) and the hand grid", () => {
    const t0 = Date.UTC(2026, 9, 1, 12);
    const rows = [
      row({ endedAt: new Date(t0), net: 100, bigBlind: 10 }),
      row({ endedAt: new Date(t0 + 10 * 60_000), net: -50, bigBlind: 10, position: "SB", holeCards: ["7c", "2d"] }),
      row({ endedAt: new Date(t0 + 50 * 60_000), net: 200, smallBlind: 10, bigBlind: 20, wentToShowdown: true, wonAtShowdown: true, allInEvNet: 120 }),
    ];
    const r = computeStatsReport(rows, "me");
    expect(r.headline.hands).toBe(3);
    expect(r.headline.net).toBe(250);
    expect(r.headline.netBB).toBeCloseTo(10 - 5 + 10);
    expect(r.headline.bb100).toBeCloseTo((100 * 15) / 3);
    expect(r.headline.allInEvNet).toBe(100 - 50 + 120);
    expect(r.hasEv).toBe(true);
    expect(r.sessions).toHaveLength(2);
    expect(r.sessions[0]!.hands).toBe(1); // newest first
    expect(r.sessions[1]!.net).toBe(50);
    expect(r.grid.find((c) => c.label === "AKo")!.hands).toBe(2);
    expect(r.grid.find((c) => c.label === "72o")!.net).toBe(-50);
    expect(r.byStakes.map((s) => s.label).sort()).toEqual(["10/20", "5/10"]);
    expect(r.graph[r.graph.length - 1]).toMatchObject({ n: 3, net: 250, ev: 170, showdown: 200, nonShowdown: 50 });
    expect(r.headline.wsd).toMatchObject({ hits: 1, n: 1 });
  });

  it("only gives insights with enough sample", () => {
    const few = computeStatsReport([row({ endedAt: new Date(), net: 10 })], "me");
    expect(few.insights).toHaveLength(1);
    expect(few.insights[0]!.id).toBe("sample");
    const h = computeStatsReport(
      Array.from({ length: 60 }, (_, i) => row({ endedAt: new Date(Date.UTC(2026, 0, 1) + i * 1000), net: 5, vpip: true, pfr: false })),
      "me",
    ).headline;
    const insights = buildInsights(h, []);
    expect(insights.map((i) => i.id)).toContain("vpip-high");
    expect(insights.map((i) => i.id)).toContain("passive-preflop");
    expect(insights.find((i) => i.id === "vpip-high")!.basis).toBe("Based on 60 hands");
  });
});

describe("stats queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("builds my stats from the database consistently with HandPlayer rows", async () => {
    const users = await Promise.all([createTestUser(), createTestUser(), createTestUser(), createTestUser()]);
    const lobby = await createTestLobby(users[0]!.id);
    await persistBotHands({ lobbyId: lobby.id, userIds: users.map((u) => u.id), count: 60, start: new Date(Date.now() - 3 * 3600_000) });
    const me = users[0]!.id;
    const rows = await prisma.handPlayer.findMany({ where: { userId: me } });
    const stats = await getMyStats(me, "7d");
    expect(stats.report.headline.hands).toBe(60);
    expect(stats.report.headline.net).toBe(rows.reduce((s, r) => s + r.net, 0));
    expect(stats.report.headline.vpip.hits).toBeLessThanOrEqual(rows.filter((r) => r.vpip).length);
    expect(stats.report.headline.wtsd.n).toBe(rows.filter((r) => r.sawFlop).length);
    // Event-derived stats are loaded (the first bot is a rock; check them across all players).
    const all = await Promise.all(users.map((u) => getMyStats(u.id, "7d")));
    expect(all.reduce((s, x) => s + x.report.headline.cbet.n + x.report.headline.af.calls, 0)).toBeGreaterThan(0);
    const empty = await getMyStats((await createTestUser()).id, "all");
    expect(empty.report.headline.hands).toBe(0);
  });

  it("money flow splits each result across the opponents on the other side", async () => {
    const users = await Promise.all([createTestUser(), createTestUser(), createTestUser()]);
    const lobby = await createTestLobby(users[0]!.id);
    await persistBotHands({ lobbyId: lobby.id, userIds: users.map((u) => u.id), count: 40 });
    const me = users[0]!.id;
    const flow = await getMoneyFlow(me, null, 10);
    const total = [...flow.wonFrom, ...flow.lostTo].reduce((s, l) => s + l.net, 0);
    const myNet = (await prisma.handPlayer.findMany({ where: { userId: me } })).reduce((s, r) => s + r.net, 0);
    expect(Math.abs(total - myNet)).toBeLessThanOrEqual(2);
    expect(flow.wonFrom.every((l) => l.net > 0)).toBe(true);
    expect(flow.lostTo.every((l) => l.net < 0)).toBe(true);
  });

  it("public summary aggregates daily stats", async () => {
    const users = await Promise.all([createTestUser(), createTestUser()]);
    const lobby = await createTestLobby(users[0]!.id);
    await persistBotHands({ lobbyId: lobby.id, userIds: users.map((u) => u.id), count: 20, start: new Date(Date.now() - 3600_000) });
    const s = (await getPublicStatsSummary(users[0]!.id))!;
    expect(s.hands).toBe(20);
    expect(s.recentForm).toHaveLength(14);
    expect(s.recentForm.reduce((sum, d) => sum + d.hands, 0)).toBe(20);
    expect(s.biggestPotHandId === null || typeof s.biggestPotHandId === "string").toBe(true);
  });
});

describe("leaderboard", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function daily(userId: string, day: string, net: number, hands = 10, extra: { biggestPotWon?: number; showdownsWon?: number } = {}) {
    await prisma.playerDailyStat.create({ data: { userId, day, net, hands, biggestPotWon: extra.biggestPotWon ?? 0, showdownsWon: extra.showdownsWon ?? 0 } });
  }

  it("ranks with ties, includes the viewer outside the top N and excludes banned/deleted users", async () => {
    const now = new Date(Date.UTC(2026, 9, 29, 15));
    const today = "2026-10-29";
    const users = await Promise.all(Array.from({ length: 6 }, (_, i) => createTestUser({ username: `player${i}` })));
    const banned = await createTestUser({ username: "banned1" });
    await prisma.user.update({ where: { id: banned.id }, data: { status: "BANNED" } });
    const deleted = await createTestUser({ username: "deleted1" });
    await prisma.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const seed = await createTestUser({ username: "seed_bot" });
    await daily(users[0]!.id, today, 500);
    await daily(users[1]!.id, today, 300);
    await daily(users[2]!.id, today, 300);
    await daily(users[3]!.id, today, 100);
    await daily(users[4]!.id, "2026-10-01", 9999); // outside this week
    await daily(users[5]!.id, today, -200);
    await daily(banned.id, today, 10_000);
    await daily(deleted.id, today, 10_000);
    await daily(seed.id, today, 50);

    const lb = await getLeaderboard({ metric: "profit", period: "week", viewerId: users[5]!.id, limit: 3, now, hideSeed: false });
    expect(lb.rows.map((r) => [r.username, r.rank])).toEqual([
      ["player0", 1],
      ["player1", 2],
      ["player2", 2],
    ]);
    expect(lb.viewer).toMatchObject({ username: "player5", rank: 6, value: -200 });
    expect(lb.total).toBe(6);

    const hidden = await getLeaderboard({ metric: "profit", period: "week", limit: 50, now, hideSeed: true });
    expect(hidden.rows.some((r) => r.username === "seed_bot")).toBe(false);
    expect(hidden.rows.some((r) => r.username === "banned1" || r.username === "deleted1")).toBe(false);

    const all = await getLeaderboard({ metric: "profit", period: "all", limit: 50, now, hideSeed: false });
    expect(all.rows[0]!.username).toBe("player4");
  });

  it("computes bb/100 only for players with enough hands, and other metrics", async () => {
    const users = await Promise.all([createTestUser(), createTestUser(), createTestUser()]);
    const lobby = await createTestLobby(users[0]!.id);
    await persistBotHands({ lobbyId: lobby.id, userIds: users.map((u) => u.id), count: 30, start: new Date() });
    const bb = await getLeaderboard({ metric: "bb100", period: "all", hideSeed: false });
    expect(bb.rows).toHaveLength(0); // 30 < 500 hands
    const hands = await getLeaderboard({ metric: "hands", period: "today", hideSeed: false });
    expect(hands.rows.every((r) => r.value === 30 && r.rank === 1)).toBe(true);
    const biggest = await getLeaderboard({ metric: "biggestPot", period: "all", hideSeed: false });
    for (const r of biggest.rows) expect(r.handId).not.toBeNull();
  });

  it("period starts: week begins Monday (UTC)", () => {
    expect(periodStartDay("week", new Date(Date.UTC(2026, 9, 29)))).toBe("2026-10-26");
    expect(periodStartDay("month", new Date(Date.UTC(2026, 9, 29)))).toBe("2026-10-01");
    expect(periodStartDay("today", new Date(Date.UTC(2026, 9, 29, 23, 59)))).toBe("2026-10-29");
    expect(periodStartDay("all")).toBeNull();
  });
});

describe("player notes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("saves, reads, clears and validates notes", async () => {
    const [me, other] = await Promise.all([createTestUser(), createTestUser()]);
    expect(await getPlayerNote(me.id, other.id)).toMatchObject({ text: "", color: "none" });
    await savePlayerNote(me.id, { subjectId: other.id, text: "  Bluffs rivers  ", color: "red" });
    expect(await getPlayerNote(me.id, other.id)).toMatchObject({ text: "Bluffs rivers", color: "red" });
    // Notes are private to their owner.
    expect(await getPlayerNote(other.id, me.id)).toMatchObject({ text: "" });
    await savePlayerNote(me.id, { subjectId: other.id, text: "", color: "none" });
    expect(await prisma.playerNote.count()).toBe(0);
    await expect(savePlayerNote(me.id, { subjectId: me.id, text: "x", color: "red" })).rejects.toBeInstanceOf(NoteError);
    await expect(savePlayerNote(me.id, { subjectId: other.id, text: "x", color: "pink" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(savePlayerNote(me.id, { subjectId: other.id, text: "x".repeat(1001), color: "red" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(savePlayerNote(me.id, { subjectId: other.id, text: "x", color: "red", extra: 1 })).rejects.toMatchObject({ code: "INVALID" });
  });
});
