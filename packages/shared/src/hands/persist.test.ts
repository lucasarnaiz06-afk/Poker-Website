import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, prisma, resetDatabase } from "../../test/db";
import { botHandInput, createTestLobby, persistBotHands } from "../../test/hand-fixtures";
import { buildPersistRows, persistCompletedHand, PersistHandError, recordSidePayments, utcDay } from "./persist";
import { positionNames } from "./positions";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("buildPersistRows (pure mapping)", () => {
  it("maps 300 bot hands consistently with the engine summary", () => {
    let allIns = 0;
    for (let i = 0; i < 300; i++) {
      const ids = ["a", "b", "c", "d", "e", "f"].slice(0, 2 + (i % 5));
      const { input, result } = botHandInput({ lobbyId: "l", handNumber: i, userIds: ids, seed: i, bombPot: i % 17 === 0 });
      const rows = buildPersistRows(input);
      const s = result.summary;
      expect(rows.players).toHaveLength(s.players.length);
      // Chips are conserved without side payments.
      expect(rows.players.reduce((sum, p) => sum + p.net, 0)).toBe(0);
      for (const p of rows.players) {
        const sp = s.players.find((x) => x.id === p.userId)!;
        expect(p.net).toBe(sp.net);
        expect(p.endingStack).toBe(sp.endingStack);
        expect(p.won).toBe(sp.won);
        expect(p.vpip).toBe(sp.stats.vpip);
        expect(p.pfr).toBe(sp.stats.pfr);
        expect(p.threeBet).toBe(sp.stats.threeBet);
        expect(p.sawFlop).toBe(sp.stats.sawFlop);
        expect(p.wentToShowdown).toBe(sp.wentToShowdown);
        expect(p.wonAtShowdown).toBe(sp.wonAtShowdown);
        expect(p.shown).toBe(sp.mustShow || result.voluntaryShows.includes(p.userId));
        expect(p.holeCards).toEqual(sp.holeCards);
        if (s.isBombPot) expect(p.vpip || p.pfr).toBe(false);
      }
      expect(rows.hand.isBombPot).toBe(s.isBombPot);
      expect(rows.hand.totalPot).toBe(s.totalPot);
      expect(rows.hand.boards).toEqual(s.boards);
      // Positions come from the shared position naming.
      const names = positionNames(s.players.map((p) => p.seat), s.buttonSeat);
      for (const p of rows.players) expect(p.position).toBe(names.get(p.seat));
      if (s.allIn && !s.doubleBoard) {
        allIns++;
        expect(rows.players.every((p) => p.allInEvNet !== null)).toBe(true);
        // EV only redistributes pot winnings: the total is still (about) zero.
        expect(Math.abs(rows.players.reduce((sum, p) => sum + (p.allInEvNet ?? 0), 0))).toBeLessThanOrEqual(rows.players.length);
      } else {
        expect(rows.players.every((p) => p.allInEvNet === null)).toBe(true);
      }
      // Daily deltas mirror the hand rows.
      expect(rows.daily).toHaveLength(rows.players.length);
      expect(rows.daily.every((d) => d.day === utcDay(input.endedAt) && d.hands === 1)).toBe(true);
    }
    expect(allIns).toBeGreaterThan(0);
  });

  it("applies side payments to net and ending stacks and appends public events", () => {
    const { input } = botHandInput({
      lobbyId: "l",
      handNumber: 1,
      userIds: ["a", "b", "c"],
      seed: 7,
      sidePayments: [
        { reason: "BOUNTY_7_2", fromUserId: "b", toUserId: "a", amount: 30 },
        { reason: "NIT_GAME", fromUserId: "c", toUserId: "outsider", amount: 20 },
      ],
    });
    const rows = buildPersistRows(input);
    const base = input.summary.players;
    const a = rows.players.find((p) => p.userId === "a")!;
    const b = rows.players.find((p) => p.userId === "b")!;
    const c = rows.players.find((p) => p.userId === "c")!;
    expect(a.net).toBe(base.find((p) => p.id === "a")!.net + 30);
    expect(b.net).toBe(base.find((p) => p.id === "b")!.net - 30);
    expect(c.endingStack).toBe(base.find((p) => p.id === "c")!.endingStack - 20);
    const side = rows.hand.events.filter((e) => e.type === "SIDE_PAYMENT");
    expect(side).toHaveLength(2);
    // The outsider was not dealt in: only a daily-stat net change.
    expect(rows.daily.find((d) => d.userId === "outsider")).toMatchObject({ hands: 0, net: 20 });
    // Event seqs keep increasing.
    const seqs = rows.hand.events.map((e) => e.seq);
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
  });

  it("rejects invalid side payments", () => {
    const { input } = botHandInput({ lobbyId: "l", handNumber: 1, userIds: ["a", "b"], seed: 3 });
    expect(() => buildPersistRows({ ...input, sidePayments: [{ reason: "NIT_GAME", fromUserId: "a", toUserId: "b", amount: 1.5 }] })).toThrow(
      PersistHandError,
    );
    expect(() =>
      buildPersistRows({ ...input, sidePayments: [{ reason: "NIT_GAME", fromUserId: "a", toUserId: "b", amount: 1_000_000 }] }),
    ).toThrow(/exceed/);
  });
});

describe("persistCompletedHand", () => {
  it("writes Hand, HandPlayer and PlayerDailyStat rows and is idempotent", async () => {
    const [u1, u2, u3] = await Promise.all([createTestUser(), createTestUser(), createTestUser()]);
    const lobby = await createTestLobby(u1.id);
    const { input } = botHandInput({ lobbyId: lobby.id, handNumber: 1, userIds: [u1.id, u2.id, u3.id], seed: 11 });

    const first = await prisma.$transaction((tx) => persistCompletedHand(tx, input));
    const second = await prisma.$transaction((tx) => persistCompletedHand(tx, input));
    expect(first.created).toBe(true);
    expect(second).toEqual({ handId: first.handId, created: false });

    const hand = await prisma.hand.findUniqueOrThrow({ where: { id: first.handId }, include: { players: true } });
    expect(hand.players).toHaveLength(3);
    expect(hand.players.reduce((s, p) => s + p.net, 0)).toBe(0);
    expect(hand.players.every((p) => p.createdAt.getTime() === input.endedAt.getTime())).toBe(true);
    expect(hand.deckReveal).toEqual(input.deckReveal);

    const daily = await prisma.playerDailyStat.findMany({ where: { day: utcDay(input.endedAt) } });
    expect(daily).toHaveLength(3);
    expect(daily.every((d) => d.hands === 1)).toBe(true);
    for (const d of daily) expect(d.net).toBe(hand.players.find((p) => p.userId === d.userId)!.net);
  });

  it("accumulates daily stats across hands (sums, max biggest pot)", async () => {
    const users = await Promise.all([createTestUser(), createTestUser(), createTestUser(), createTestUser()]);
    const lobby = await createTestLobby(users[0]!.id);
    await persistBotHands({ lobbyId: lobby.id, userIds: users.map((u) => u.id), count: 25 });
    for (const u of users) {
      const rows = await prisma.handPlayer.findMany({ where: { userId: u.id } });
      const daily = await prisma.playerDailyStat.findMany({ where: { userId: u.id } });
      expect(daily.reduce((s, d) => s + d.hands, 0)).toBe(25);
      expect(daily.reduce((s, d) => s + d.net, 0)).toBe(rows.reduce((s, r) => s + r.net, 0));
      expect(daily.reduce((s, d) => s + d.vpipHands, 0)).toBe(rows.filter((r) => r.vpip).length);
      expect(daily.reduce((s, d) => s + d.showdownsWon, 0)).toBe(rows.filter((r) => r.wonAtShowdown).length);
      expect(Math.max(...daily.map((d) => d.biggestPotWon))).toBe(Math.max(...rows.map((r) => r.won)));
    }
  });

  it("recordSidePayments amends a saved hand", async () => {
    const [u1, u2, outsider] = await Promise.all([createTestUser(), createTestUser(), createTestUser()]);
    const lobby = await createTestLobby(u1.id);
    const { input } = botHandInput({ lobbyId: lobby.id, handNumber: 1, userIds: [u1.id, u2.id], seed: 5 });
    const { handId } = await prisma.$transaction((tx) => persistCompletedHand(tx, input));
    const before = await prisma.handPlayer.findMany({ where: { handId } });
    const hidden = before.filter((p) => !p.shown).map((p) => p.userId);

    await prisma.$transaction((tx) =>
      recordSidePayments(tx, {
        handId,
        payments: [
          { reason: "BOUNTY_7_2", fromUserId: u2.id, toUserId: u1.id, amount: 20 },
          { reason: "NIT_GAME", fromUserId: u2.id, toUserId: outsider.id, amount: 10 },
        ],
        shownPlayerIds: hidden,
      }),
    );
    const after = await prisma.handPlayer.findMany({ where: { handId } });
    const p1 = after.find((p) => p.userId === u1.id)!;
    const p2 = after.find((p) => p.userId === u2.id)!;
    expect(p1.net).toBe(before.find((p) => p.userId === u1.id)!.net + 20);
    expect(p2.net).toBe(before.find((p) => p.userId === u2.id)!.net - 30);
    expect(after.every((p) => p.shown)).toBe(true);
    const hand = await prisma.hand.findUniqueOrThrow({ where: { id: handId } });
    const events = hand.events as Array<{ type: string }>;
    expect(events.filter((e) => e.type === "SIDE_PAYMENT")).toHaveLength(2);
    expect(events.filter((e) => e.type === "SHOW")).toHaveLength(hidden.length);
    const outsiderDaily = await prisma.playerDailyStat.findUniqueOrThrow({
      where: { userId_day: { userId: outsider.id, day: utcDay(input.endedAt) } },
    });
    expect(outsiderDaily).toMatchObject({ hands: 0, net: 10 });
  });
});
