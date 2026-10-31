import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, prisma, resetDatabase } from "../../test/db";
import { botHandInput, createTestLobby, legacyCommitmentFor, persistBotHands } from "../../test/hand-fixtures";
import { verifyHandCommitment } from "./commitment";
import { persistCompletedHand } from "./persist";
import { handToPokerStars } from "./pokerstars";
import { getHandView, listMyHands } from "./queries";
import { redactHandForViewer } from "./redact";
import { buildReplayFrames } from "./replay";
import type { StoredHandEvent } from "./types";

const players = [
  { userId: "me", holeCards: ["As", "Kd"], shown: false, allInEvNet: 50 },
  { userId: "shower", holeCards: ["Qh", "Qc"], shown: true, allInEvNet: -20 },
  { userId: "mucker", holeCards: ["7d", "2c"], shown: false, allInEvNet: -30 },
];

const events = [
  { type: "HAND_START", seq: 1, players: [] },
  {
    type: "HOLE_CARDS",
    seq: 2,
    hands: players.map((p, i) => ({ playerId: p.userId, seat: i + 1, cards: p.holeCards })),
  },
  {
    type: "SHOWDOWN",
    seq: 3,
    order: ["shower", "mucker", "me"],
    hands: players.map((p, i) => ({ playerId: p.userId, seat: i + 1, cards: p.holeCards, mustShow: p.shown, showReason: null, boards: [] })),
  },
  {
    type: "POT_AWARD",
    seq: 4,
    potIndex: 0,
    boardIndex: 0,
    amount: 100,
    eligiblePlayerIds: ["me", "shower", "mucker"],
    winners: [
      { playerId: "shower", seat: 2, amount: 50, handName: "Pair of Queens" },
      { playerId: "mucker", seat: 3, amount: 50, handName: "Secret" },
    ],
    uncontested: false,
  },
  { type: "SHOW", seq: 5, playerId: "mucker", seat: 3, cards: ["7d", "2c"] },
  { type: "SECRET_FUTURE_EVENT", seq: 6, deck: ["7d", "2c"] },
] as unknown as StoredHandEvent[];

describe("redactHandForViewer", () => {
  it("shows a player their own cards and shown cards only", () => {
    const out = redactHandForViewer(players, events, "me");
    expect(out.players.map((p) => p.holeCards)).toEqual([["As", "Kd"], ["Qh", "Qc"], null]);
    expect(out.players.map((p) => p.allInEvNet)).toEqual([50, -20, null]);
    const json = JSON.stringify(out);
    expect(json).not.toContain("7d");
    expect(json).not.toContain("2c");
    expect(json).not.toContain("Secret");
    expect(json).not.toContain("SECRET_FUTURE_EVENT");
    const hole = out.events.find((e) => e.type === "HOLE_CARDS");
    expect(hole && hole.type === "HOLE_CARDS" ? hole.hands.map((h) => h.playerId) : null).toEqual(["me", "shower"]);
  });

  it("shows spectators only shown cards", () => {
    const out = redactHandForViewer(players, events, "someone-else");
    expect(out.players.map((p) => p.holeCards)).toEqual([null, ["Qh", "Qc"], null]);
    const json = JSON.stringify(out);
    for (const card of ["As", "Kd", "7d", "2c"]) expect(json).not.toContain(card);
  });

  it("treats a null viewer as a spectator and never mutates its input", () => {
    const copy = structuredClone(events);
    const out = redactHandForViewer(players, events, null);
    expect(out.players.every((p) => p.userId === "shower" || p.holeCards === null)).toBe(true);
    expect(events).toEqual(copy);
  });
});

describe("hand views from the database", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("never sends hidden hole cards to other players or spectators", async () => {
    const users = await Promise.all([createTestUser(), createTestUser(), createTestUser(), createTestUser()]);
    const spectator = await createTestUser();
    const lobby = await createTestLobby(users[0]!.id);
    const handIds = await persistBotHands({ lobbyId: lobby.id, userIds: users.map((u) => u.id), count: 40, seed: 3 });
    let checkedHidden = 0;
    for (const handId of handIds) {
      const rows = await prisma.handPlayer.findMany({ where: { handId } });
      for (const viewer of [...users, spectator]) {
        const view = (await getHandView(handId, viewer.id))!;
        expect(view.relation).toBe(users.includes(viewer) ? "PLAYER" : "SPECTATOR");
        // The whole view, shuffle proof included, is checked: the proof opens only visible cards.
        const json = JSON.stringify(view);
        expect(json).not.toMatch(/"deckReveal"|"salts"|"deck"/);
        const check = await verifyHandCommitment(view);
        expect(check.ok, check.reason).toBe(true);
        for (const row of rows) {
          const cards = row.holeCards as string[];
          const visible = row.shown || row.userId === viewer.id;
          const boardCards = new Set(view.boards.flat());
          for (const card of cards) {
            if (boardCards.has(card)) continue;
            if (visible) continue;
            // Another visible hand cannot contain the same card, so any occurrence would be a leak.
            expect(json).not.toContain(`"${card}"`);
            checkedHidden++;
          }
        }
        // The PokerStars export only uses the redacted view.
        const text = handToPokerStars(view);
        expect(text.startsWith("PokerStars Hand #")).toBe(true);
        // Replay frames can be built for every viewer.
        expect(buildReplayFrames(view).length).toBeGreaterThan(3);
      }
    }
    expect(checkedHidden).toBeGreaterThan(100);
  });

  it("never sends a legacy full-deck reveal (not verifiable)", async () => {
    const users = await Promise.all([createTestUser(), createTestUser(), createTestUser()]);
    const lobby = await createTestLobby(users[0]!.id);
    const { input, result } = botHandInput({ lobbyId: lobby.id, handNumber: 1, userIds: users.map((u) => u.id), seed: 5 });
    const salt = "legacy-salt-0123456789";
    const legacy = { ...input, deckCommitment: legacyCommitmentFor(result.deck, salt), deckReveal: { deck: result.deck, salt } };
    const { handId } = await prisma.$transaction((tx) => persistCompletedHand(tx, legacy));
    const view = (await getHandView(handId, users[0]!.id))!;
    expect(view.deckProof).toBeNull();
    const json = JSON.stringify(view);
    expect(json).not.toContain(salt);
    expect(json).not.toContain(result.deck.join(""));
    expect(await verifyHandCommitment(view)).toMatchObject({ ok: false, verifiable: false });
  });

  it("lists my hands newest first with cursor pagination and filters", async () => {
    const users = await Promise.all([createTestUser(), createTestUser(), createTestUser()]);
    const lobby = await createTestLobby(users[0]!.id);
    await persistBotHands({ lobbyId: lobby.id, userIds: users.map((u) => u.id), count: 30, seed: 9 });
    const me = users[0]!.id;
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await listMyHands(me, {}, { cursor, limit: 7 });
      seen.push(...page.rows.map((r) => r.handId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    const all = await listMyHands(me, {}, { limit: 100 });
    const times = all.rows.map((r) => r.endedAt);
    expect([...times].sort().reverse()).toEqual(times);

    const won = await listMyHands(me, { result: "won" }, { limit: 100 });
    expect(won.rows.every((r) => r.net > 0)).toBe(true);
    const btn = await listMyHands(me, { position: "BTN" }, { limit: 100 });
    expect(btn.rows.every((r) => r.position === "BTN")).toBe(true);
    const byNumber = await listMyHands(me, { q: "#12" }, { limit: 100 });
    expect(byNumber.rows.map((r) => r.handNumber)).toEqual([12]);
    const sd = await listMyHands(me, { showdown: "yes" }, { limit: 100 });
    expect(sd.rows.every((r) => r.wentToShowdown)).toBe(true);
    // Only my own cards are in the list.
    const mine = await prisma.handPlayer.findMany({ where: { userId: me } });
    for (const row of all.rows) {
      expect(row.holeCards).toEqual(mine.find((m) => m.handId === row.handId)!.holeCards);
    }
  });
});
