// Randomized play: hundreds of hands with joins, leaves, sit-outs, rebuys, side games and timeouts.
// Invariants checked continuously:
//   - redaction: no view ever contains another player's hole cards (unless shown), the deck or undealt cards;
//   - chip conservation: wallets + table stacks are constant (in memory and in the persisted store).
import { parseDeckProof } from "@poker-platform/shared/hands/client";
import type { TableView } from "@poker-platform/shared/types";
import { describe, expect, it } from "vitest";
import { seededRng } from "./memory-ports";
import { createHarness, TABLE_ID, type Harness } from "./test-harness";

const cardKey = (c: { rank: string; suit: string }) => `${c.rank}${c.suit}`;

function collectCards(value: unknown, out: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectCards(item, out);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.rank === "string" && typeof record.suit === "string" && Object.keys(record).length === 2) {
      out.add(`${record.rank}${record.suit}`);
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "revealedDeck") {
        // The shuffle proof: every opened card counts as visible (it must be in the allowed set too).
        if (typeof child === "string") {
          const proof = parseDeckProof(child);
          expect(proof).not.toBeNull();
          for (const o of proof!.open) out.add(o.card);
        }
        continue;
      }
      collectCards(child, out);
    }
  }
}

/** Independent redaction check against the server's private state. */
function assertRedacted(h: Harness, connId: string, view: TableView, voluntarilyShown: Set<string>) {
  const json = JSON.stringify(view);
  expect(json).not.toMatch(/"deck"|"salt"|"salts"|"burns"|deckReveal/);
  const table = h.table();
  const hand = table.hand;
  const viewerId = view.viewer.userId;
  expect(connId.startsWith("c-")).toBe(true);
  if (!hand || view.hand?.handId !== hand.id) return;
  const visible = new Set<string>();
  collectCards(view, visible);
  const engine = hand.engine;
  const summary = engine.summary;
  const allowed = new Set<string>();
  for (const board of engine.boards) for (const card of board) allowed.add(card);
  const runout = engine.status === "RUNOUT_DECISION";
  for (const p of engine.snapshot().players) {
    const mine = p.id === viewerId;
    const shownAtShowdown = summary?.players.find((q) => q.id === p.id)?.mustShow ?? false;
    const runoutReveal = (runout || engine.isComplete) && hand.shown.has(p.id) && !p.folded;
    if (mine || shownAtShowdown || runoutReveal || voluntarilyShown.has(`${hand.id}:${p.id}`)) {
      for (const card of p.holeCards) allowed.add(card);
    }
  }
  for (const card of visible) {
    if (!allowed.has(card)) {
      throw new Error(`View for ${viewerId} leaked ${card} (phase ${view.hand?.phase})`);
    }
  }
  if (!view.hand?.result) expect(view.hand?.revealedDeck ?? null).toBeNull();
  // Spectators never get legal actions; only the actor does.
  if (view.viewer.legalActions) expect(engine.toActPlayerId).toBe(viewerId);
}

async function runFuzz(seed: number, hands: number) {
  const rng = seededRng(seed);
  const pick = <T>(items: readonly T[]) => items[rng.randomInt(items.length)]!;
  const players = rng.randomInt(8) + 2; // 2..9 seats
  const h = createHarness({
    seed,
    settings: {
      maxPlayers: 9,
      variant: rng.randomInt(4) === 0 ? "PLO" : "NLHE",
      minBuyIn: 200,
      maxBuyIn: 2000,
      straddle: true,
      ante: rng.randomInt(2) ? 2 : 0,
      bombPot: { enabled: true, anteBB: 2, doubleBoard: rng.randomInt(2) === 0, voteRule: "majority", everyNHands: 7 },
      nitGame: { enabled: true, penaltyBB: 5, voteRule: "majority" },
      bountyGame: { enabled: true, bountyBB: 2, voteRule: "majority" },
    },
  });
  const users = Array.from({ length: 12 }, (_, i) => `u${i + 1}`);
  for (const id of users) h.store.addUser(id, 20_000);
  const initialTotal = h.store.totalChips();
  const voluntarilyShown = new Set<string>();
  let checkedViews = 0;
  h.transport.onState = (connId, view) => {
    checkedViews += 1;
    assertRedacted(h, connId, view, voluntarilyShown);
  };
  // A spectator watches everything.
  h.store.addUser("spectator", 0);
  await h.runtime.join("c-spectator", "spectator", TABLE_ID, {});

  const tryIt = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error)) throw error;
    }
  };

  for (const [index, id] of users.slice(0, players).entries()) {
    await h.runtime.join(`c-${id}`, id, TABLE_ID, {});
    await h.runtime.sit(id, TABLE_ID, index + 1, 200 + rng.randomInt(1800));
  }

  const checkConservation = () => {
    const table = h.table();
    if (table.isLive() || table.queue.size > 0) return;
    let memory = 0;
    for (const id of [...users, "spectator"]) memory += h.store.balances.get(id) ?? 0;
    for (const seat of table.seats.values()) memory += seat.stack;
    expect(memory).toBe(initialTotal);
    expect(h.store.totalChips()).toBe(initialTotal);
  };

  let completed = 0;
  for (let step = 0; step < hands * 40 && completed < hands; step += 1) {
    const table = h.table();
    const hand = table.hand;
    const seated = [...table.seats.values()];
    // Between-hand / random table events.
    const roll = rng.randomInt(100);
    if (roll < 3) {
      const free = users.find((id) => !table.seatOf(id));
      const freeSeat = Array.from({ length: 9 }, (_, i) => i + 1).find((s) => !table.seats.has(s));
      if (free && freeSeat) {
        await tryIt(() => h.runtime.join(`c-${free}`, free, TABLE_ID, {}));
        await tryIt(() => h.runtime.sit(free, TABLE_ID, freeSeat, 200 + rng.randomInt(1800)));
      }
    } else if (roll < 5 && seated.length > 2) {
      await tryIt(() => h.runtime.stand(pick(seated).userId, TABLE_ID));
    } else if (roll < 7 && seated.length > 0) {
      const s = pick(seated);
      await tryIt(() => h.runtime.sitOut(s.userId, TABLE_ID, s.status !== "SITTING_OUT"));
    } else if (roll < 9 && seated.length > 0) {
      const s = pick(seated);
      await tryIt(() => h.runtime.rebuy(s.userId, TABLE_ID, 1 + rng.randomInt(1500)));
    } else if (roll < 10 && seated.length > 0) {
      await tryIt(() => h.runtime.propose(pick(seated).userId, TABLE_ID, pick(["BOMB_POT", "NIT_GAME", "BOUNTY_GAME"] as const), pick(["START", "STOP"] as const)));
    } else if (roll < 13) {
      const open = table.votes.find((v) => v.status === "OPEN");
      if (open) await tryIt(() => h.runtime.vote(pick(open.eligibleUserIds), TABLE_ID, open.id, rng.randomInt(3) > 0));
    } else if (roll < 14 && seated.length > 0) {
      await tryIt(() => h.runtime.straddle(pick(seated).userId, TABLE_ID, rng.randomInt(2) === 0));
    } else if (roll < 15 && seated.length > 0) {
      const s = pick(seated);
      await tryIt(() => h.runtime.disconnect(`c-${s.userId}`));
      await tryIt(() => h.runtime.join(`c-${s.userId}`, s.userId, TABLE_ID, {}));
    }

    if (!hand || hand.completedAt !== null) {
      if (hand?.completedAt && rng.randomInt(4) === 0) {
        const shower = pick(hand.dealt).userId;
        // Recorded first: the broadcast happens before the ack resolves (a rejected show broadcasts nothing).
        voluntarilyShown.add(`${hand.id}:${shower}`);
        await tryIt(() => h.runtime.show(shower, TABLE_ID, hand.id));
      }
      checkConservation();
      const before = hand?.id;
      await h.advance(1_000);
      if (h.table().hand && h.table().hand!.id !== before) completed += 1;
      continue;
    }
    if (hand.engine.status === "RUNOUT_DECISION") {
      const vote = table.votes.find((v) => v.kind === "RUN_IT_TWICE" && v.status === "OPEN");
      if (vote && rng.randomInt(3) > 0) await tryIt(() => h.runtime.vote(pick(vote.eligibleUserIds), TABLE_ID, vote.id, rng.randomInt(2) === 0));
      else await h.advance(8_000);
      continue;
    }
    const actor = hand.engine.toActPlayerId!;
    if (rng.randomInt(40) === 0) {
      await h.advance(60_000); // timeout path
      continue;
    }
    const legal = hand.engine.legalActions(actor)!;
    const r = rng.randomInt(100);
    if (r < 15) await h.act(actor, "fold");
    else if (r < 55) await h.act(actor, legal.canCheck ? "check" : "call");
    else if (r < 85 && legal.canBetOrRaise) {
      const amount = legal.minTo + rng.randomInt(Math.max(1, legal.maxTo - legal.minTo + 1));
      await h.act(actor, legal.isBet ? "bet" : "raise", amount);
    } else if (r < 92) await tryIt(() => h.act(actor, "allin"));
    else await tryIt(() => h.act(actor, pick(["check", "bet", "raise"] as const), rng.randomInt(5000))); // often illegal
    await h.settle();
  }

  await h.settle();
  // Finish the current hand and shut down: every chip must be back in a wallet.
  for (let i = 0; i < 200 && h.table().isLive(); i += 1) await h.advance(60_000);
  checkConservation();
  await h.runtime.shutdown();
  let wallets = 0;
  for (const id of [...users, "spectator"]) wallets += h.store.balances.get(id) ?? 0;
  expect(wallets).toBe(initialTotal);
  expect(h.errors).toEqual([]);
  if (process.env.FUZZ_STATS) {
    const hs = h.store.hands;
    console.log(JSON.stringify({ seed, players, hands: hs.length, views: checkedViews,
      bomb: hs.filter((x) => x.summary.isBombPot).length, rit: hs.filter((x) => x.summary.runs === 2).length,
      side: hs.reduce((n, x) => n + x.sidePayments.length, 0), amend: h.store.amendments.length,
      showdown: hs.filter((x) => x.summary.showdown).length, maxPlayers: Math.max(...hs.map((x) => x.summary.players.length)) }));
  }
  return { completed, checkedViews, hands: h.store.hands.length };
}

describe("fuzz: random tables", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: invariants hold over many hands`, async () => {
      const result = await runFuzz(seed, 60);
      expect(result.hands).toBeGreaterThan(20);
      expect(result.checkedViews).toBeGreaterThan(200);
    });
  }
});
