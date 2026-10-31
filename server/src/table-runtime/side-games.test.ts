import { describe, expect, it } from "vitest";
import { bountyTransfers, evaluateVote, nitPenaltyTransfers } from "./side-games";
import { createHarness, deckFor, TABLE_ID, type Harness } from "./test-harness";

/** Hole cards dealt one at a time starting left of the button. */
function dealOrder(button: number, seats: number[]) {
  const sorted = [...seats].sort((a, b) => a - b);
  return [...sorted.filter((s) => s > button), ...sorted.filter((s) => s <= button)];
}

function deckBySeat(button: number, holes: Record<number, string[]>, board: string[]) {
  const seats = Object.keys(holes).map(Number);
  return deckFor(
    dealOrder(button, seats).map((seat) => holes[seat]!),
    board,
  );
}

async function passVote(h: Harness, kind: "BOMB_POT" | "NIT_GAME" | "BOUNTY_GAME", action: "START" | "STOP", voters: string[]) {
  await h.runtime.propose(voters[0]!, TABLE_ID, kind, action);
  const vote = h.table().votes.find((v) => v.kind === kind && v.status === "OPEN");
  for (const id of voters.slice(1)) {
    if (vote && vote.status === "OPEN") await h.runtime.vote(id, TABLE_ID, vote.id, true);
  }
}

const JUNK: Record<number, string[]> = { 1: ["2c", "3d"], 2: ["4c", "5d"], 3: ["8c", "9d"] };

describe("pure payout rules", () => {
  it("nit penalty is capped by the payer stack, paid clockwise", () => {
    const transfers = nitPenaltyTransfers(
      { userId: "c", seat: 5, stack: 70 },
      [
        { userId: "a", seat: 2, stack: 100 },
        { userId: "b", seat: 7, stack: 100 },
        { userId: "c", seat: 5, stack: 70 },
      ],
      50,
    );
    expect(transfers.map((t) => [t.toUserId, t.amount])).toEqual([
      ["b", 50],
      ["a", 20],
    ]);
  });

  it("bounty is capped by each payer's stack", () => {
    const transfers = bountyTransfers(
      { userId: "w", seat: 1, stack: 500 },
      [
        { userId: "w", seat: 1, stack: 500 },
        { userId: "a", seat: 2, stack: 5 },
        { userId: "b", seat: 3, stack: 0 },
        { userId: "c", seat: 4, stack: 900 },
      ],
      20,
    );
    expect(transfers.map((t) => [t.fromUserId, t.amount])).toEqual([
      ["a", 5],
      ["c", 20],
    ]);
  });

  it("vote rules", () => {
    expect(evaluateVote("majority", { eligible: 4, yes: 2, no: 0 }, false)).toBe("OPEN");
    expect(evaluateVote("majority", { eligible: 4, yes: 3, no: 0 }, false)).toBe("PASSED");
    expect(evaluateVote("majority", { eligible: 4, yes: 1, no: 2 }, false)).toBe("FAILED");
    expect(evaluateVote("majority", { eligible: 4, yes: 2, no: 0 }, true)).toBe("FAILED");
    expect(evaluateVote("majority", { eligible: 1, yes: 1, no: 0 }, false)).toBe("PASSED");
    expect(evaluateVote("unanimous", { eligible: 3, yes: 2, no: 0 }, false)).toBe("OPEN");
    expect(evaluateVote("unanimous", { eligible: 3, yes: 2, no: 1 }, false)).toBe("FAILED");
    expect(evaluateVote("unanimous", { eligible: 3, yes: 3, no: 0 }, false)).toBe("PASSED");
    expect(evaluateVote("unanimous", { eligible: 3, yes: 2, no: 0 }, true)).toBe("FAILED");
  });
});

describe("votes", () => {
  it("bomb pot: majority passes early; next hand is a bomb pot", async () => {
    const h = createHarness({
      settings: { autoStart: false, bombPot: { enabled: true, anteBB: 2, doubleBoard: true, voteRule: "majority", everyNHands: 0 } },
    });
    await h.seat(["u1", "u2", "u3"]);
    await h.runtime.propose("u1", TABLE_ID, "BOMB_POT", "START");
    let vote = h.view("u2").votes[0]!;
    expect(vote.status).toBe("OPEN");
    expect(vote.eligibleUserIds.sort()).toEqual(["u1", "u2", "u3"]);
    await h.runtime.vote("u2", TABLE_ID, vote.id, true);
    vote = h.view("u2").votes[0]!;
    expect(vote.status).toBe("PASSED");
    expect(h.view("u1").sideGames.bombPotQueued).toBe(true);
    await h.runtime.start("u1", TABLE_ID);
    const hand = await h.untilHand();
    const snap = hand.engine.snapshot();
    expect(snap.isBombPot).toBe(true);
    expect(snap.boards).toHaveLength(2);
    expect(snap.boards[0]).toHaveLength(3);
    expect(snap.totalPot).toBe(3 * 20);
    expect(h.view("u1").sideGames.bombPotQueued).toBe(false);
    // resolved votes disappear after a few seconds
    await h.advance(6_000);
    expect(h.view("u1").votes.filter((v) => v.kind === "BOMB_POT")).toHaveLength(0);
  });

  it("majority fails early on enough no votes; proposer cooldown 60s", async () => {
    const h = createHarness({ settings: { autoStart: false, bombPot: { enabled: true, anteBB: 1, doubleBoard: false, voteRule: "majority", everyNHands: 0 } } });
    await h.seat(["u1", "u2", "u3", "u4"]);
    await h.runtime.propose("u1", TABLE_ID, "BOMB_POT", "START");
    const id = h.view("u1").votes[0]!.id;
    await expect(h.runtime.propose("u2", TABLE_ID, "BOMB_POT", "START")).rejects.toMatchObject({ code: "VOTE_OPEN" });
    await h.runtime.vote("u2", TABLE_ID, id, false);
    expect(h.view("u1").votes[0]!.status).toBe("OPEN");
    await h.runtime.vote("u3", TABLE_ID, id, false);
    expect(h.view("u1").votes[0]!.status).toBe("FAILED");
    await expect(h.runtime.vote("u4", TABLE_ID, id, true)).rejects.toMatchObject({ code: "VOTE_CLOSED" });
    await expect(h.runtime.propose("u1", TABLE_ID, "BOMB_POT", "START")).rejects.toMatchObject({ code: "VOTE_COOLDOWN" });
    await h.runtime.propose("u2", TABLE_ID, "BOMB_POT", "START"); // other proposers are fine
    await h.advance(60_000); // u2's vote expired (failed) meanwhile; u1's cooldown is over
    await expect(h.runtime.propose("u1", TABLE_ID, "BOMB_POT", "START")).resolves.toBeUndefined();
    await expect(h.runtime.propose("u2", TABLE_ID, "BOMB_POT", "START")).rejects.toMatchObject({ code: "VOTE_OPEN" });
  });

  it("expires after 20s; unanimous fails on any no; only enabled kinds; no RIT proposals", async () => {
    const h = createHarness({
      settings: {
        autoStart: false,
        nitGame: { enabled: true, penaltyBB: 5, voteRule: "unanimous" },
        bountyGame: { enabled: false, bountyBB: 2, voteRule: "unanimous" },
      },
    });
    await h.seat(["u1", "u2", "u3"]);
    await expect(h.runtime.propose("u1", TABLE_ID, "BOUNTY_GAME", "START")).rejects.toMatchObject({ code: "VOTE_DISABLED" });
    await expect(h.runtime.propose("u1", TABLE_ID, "BOMB_POT", "START")).rejects.toMatchObject({ code: "VOTE_DISABLED" });
    await expect(h.runtime.propose("u1", TABLE_ID, "RUN_IT_TWICE", "START")).rejects.toMatchObject({ code: "INVALID_VOTE" });
    await expect(h.runtime.propose("u1", TABLE_ID, "NIT_GAME", "STOP")).rejects.toMatchObject({ code: "NOT_ACTIVE" });
    await h.runtime.propose("u1", TABLE_ID, "NIT_GAME", "START");
    await h.runtime.vote("u2", TABLE_ID, h.view("u1").votes[0]!.id, true);
    await h.advance(19_000);
    expect(h.view("u1").votes[0]!.status).toBe("OPEN");
    await h.advance(1_000);
    expect(h.view("u1").votes[0]!.status).toBe("FAILED");
    await h.advance(60_000);
    await h.runtime.propose("u1", TABLE_ID, "NIT_GAME", "START");
    await h.runtime.vote("u3", TABLE_ID, h.view("u1").votes.at(-1)!.id, false);
    expect(h.view("u1").votes.at(-1)!.status).toBe("FAILED");
  });

  it("sitting-out players are not eligible; standing removes a voter", async () => {
    const h = createHarness({ settings: { autoStart: false, bombPot: { enabled: true, anteBB: 1, doubleBoard: false, voteRule: "unanimous", everyNHands: 0 } } });
    await h.seat(["u1", "u2", "u3"]);
    await h.runtime.sitOut("u3", TABLE_ID, true);
    await expect(h.runtime.propose("u3", TABLE_ID, "BOMB_POT", "START")).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await h.join("u4");
    await h.runtime.sit("u4", TABLE_ID, 4, 1000);
    await h.runtime.propose("u1", TABLE_ID, "BOMB_POT", "START");
    const vote = h.view("u1").votes[0]!;
    expect(vote.eligibleUserIds.sort()).toEqual(["u1", "u2", "u4"]);
    await expect(h.runtime.vote("u3", TABLE_ID, vote.id, true)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await h.runtime.vote("u2", TABLE_ID, vote.id, true);
    await h.runtime.stand("u4", TABLE_ID);
    expect(h.view("u1").votes[0]!.status).toBe("PASSED");
  });

  it("bomb pot every N hands", async () => {
    const h = createHarness({ settings: { bombPot: { enabled: true, anteBB: 1, doubleBoard: false, voteRule: "majority", everyNHands: 3 } } });
    await h.seat(["u1", "u2"]);
    const bombs: boolean[] = [];
    for (let i = 0; i < 6; i += 1) {
      const hand = await h.untilHand();
      bombs.push(hand.engine.snapshot().isBombPot);
      if (i === 1) expect(h.view("u1").sideGames.handsUntilAutoBombPot).toBe(1);
      await h.passiveToEnd();
    }
    expect(bombs).toEqual([false, false, true, false, false, true]);
  });
});

describe("run it twice", () => {
  async function allInPreflop(h: Harness) {
    await h.seat(["u1", "u2"]);
    await h.untilHand();
    await h.act(h.toAct()!, "allin");
    await h.act(h.toAct()!, "call");
    expect(h.table().hand!.engine.status).toBe("RUNOUT_DECISION");
    const vote = h.view("u1").votes.find((v) => v.kind === "RUN_IT_TWICE")!;
    expect(vote.rule).toBe("unanimous");
    expect(vote.eligibleUserIds.sort()).toEqual(["u1", "u2"]);
    // All-in hands are revealed during the decision.
    const spectatorView = await h.join("spec");
    expect(spectatorView.seats.every((s) => s.holeCards !== null)).toBe(true);
    return vote;
  }

  it("runs twice when everyone accepts", async () => {
    const h = createHarness();
    const vote = await allInPreflop(h);
    await h.runtime.vote("u1", TABLE_ID, vote.id, true);
    expect(h.table().hand!.engine.status).toBe("RUNOUT_DECISION");
    await h.runtime.vote("u2", TABLE_ID, vote.id, true);
    await h.settle();
    const view = h.view("u1");
    expect(view.hand!.runItTwice).toBe(true);
    expect(view.hand!.boards).toHaveLength(2);
    expect(view.hand!.boards.every((b) => b.length === 5)).toBe(true);
    expect(h.store.totalChips()).toBe(300_000); // incl. the spectator's wallet
  });

  it("runs once on a no or when the vote times out (8s)", async () => {
    const h = createHarness();
    await allInPreflop(h);
    await h.advance(8_000);
    expect(h.view("u1").hand!.runItTwice).toBe(false);
    expect(h.view("u1").hand!.phase).toBe("COMPLETE");

    const h2 = createHarness();
    const vote = await allInPreflop(h2);
    await h2.runtime.vote("u2", TABLE_ID, vote.id, false);
    expect(h2.view("u1").hand!.boards).toHaveLength(1);
  });

  it("a player standing during the vote is not folded: run once", async () => {
    const h = createHarness();
    await allInPreflop(h);
    await h.runtime.stand("u2", TABLE_ID);
    await h.settle();
    const hand = h.table().hand!;
    expect(hand.engine.summary!.players.find((p) => p.id === "u2")!.folded).toBe(false);
    expect(h.table().seatOf("u2")).toBeNull();
    expect(h.store.totalChips()).toBe(300_000);
  });
});

describe("nit game", () => {
  async function setup(penaltyBB = 5, buyIns = [1000, 1000, 1000]) {
    const h = createHarness({
      settings: { autoStart: false, nitGame: { enabled: true, penaltyBB, voteRule: "unanimous" } },
      decks: [
        deckBySeat(1, { 1: ["As", "Ah"], 2: JUNK[2]!, 3: JUNK[3]! }, ["Kd", "Qc", "7h", "6s", "Jd"]),
        deckBySeat(2, { 1: JUNK[1]!, 2: ["As", "Ah"], 3: JUNK[3]! }, ["Kd", "Qc", "7h", "6s", "Jd"]),
      ],
    });
    for (const [i, id] of ["u1", "u2", "u3"].entries()) {
      await h.join(id);
      await h.runtime.sit(id, TABLE_ID, i + 1, buyIns[i]!);
    }
    await passVote(h, "NIT_GAME", "START", ["u1", "u2", "u3"]);
    expect(h.view("u1").sideGames.nitGame.active).toBe(true);
    await h.runtime.start("u1", TABLE_ID);
    await h.untilHand();
    expect(h.view("u1").sideGames.nitGame.participantUserIds.sort()).toEqual(["u1", "u2", "u3"]);
    expect(h.view("u1").seats.every((s) => s.isNit === true)).toBe(true);
    return h;
  }

  it("winning makes you safe; the last nit pays everyone", async () => {
    const h = await setup();
    await h.passiveToEnd(); // u1 wins
    expect(h.view("u1").sideGames.nitGame.nitUserIds.sort()).toEqual(["u2", "u3"]);
    // A late joiner is not part of this round.
    await h.join("u4");
    await h.runtime.sit("u4", TABLE_ID, 4, 1000);
    expect(h.view("u1").sideGames.nitGame.participantUserIds).not.toContain("u4");
    expect(h.view("u1").seats.find((s) => s.userId === "u4")!.isNit).toBe(false);
    await h.runtime.sitOut("u4", TABLE_ID, true);
    await h.untilHand();
    await h.passiveToEnd(); // u2 wins -> u3 last nit pays 50 to u1 and u2
    const result = h.view("u1").hand!.result!;
    expect(result.sidePayments).toEqual([
      { fromSeat: 3, toSeat: 1, amount: 50, reason: "NIT_GAME" },
      { fromSeat: 3, toSeat: 2, amount: 50, reason: "NIT_GAME" },
    ]);
    const saved = h.store.hands.at(-1)!;
    expect(saved.sidePayments).toHaveLength(2);
    expect(h.view("u1").sideGames.nitGame.nitUserIds).toEqual([]);
    expect(h.store.totalChips()).toBe(400_000);
    expect(h.view("u1").log.some((l) => l.kind === "side_game" && l.text.includes("pays 50"))).toBe(true);
  });

  it("penalty capped by the payer stack", async () => {
    const h = await setup(50, [1000, 1000, 400]);
    await h.passiveToEnd();
    await h.untilHand();
    await h.passiveToEnd();
    const result = h.view("u1").hand!.result!;
    const paid = result.sidePayments.reduce((sum, p) => sum + p.amount, 0);
    expect(paid).toBe(400 - 20); // u3 lost 2 x 10 (calls) before paying
    expect(result.sidePayments[0]).toMatchObject({ fromSeat: 3, toSeat: 1, amount: 380 });
    expect(h.table().seatOf("u3")!.stack).toBe(0);
    expect(h.table().seatOf("u3")!.status).toBe("SITTING_OUT");
    expect(h.store.totalChips()).toBe(300_000);
  });

  it("a nit who stands up pays on leaving", async () => {
    const h = await setup();
    await h.passiveToEnd(); // u1 safe; nits u2,u3
    const u1Before = h.table().seatOf("u1")!.stack;
    const u3Stack = h.table().seatOf("u3")!.stack;
    await h.runtime.stand("u3", TABLE_ID);
    expect(h.table().seatOf("u1")!.stack).toBe(u1Before + 50);
    expect(h.table().seatOf("u2")!.stack).toBeGreaterThan(0);
    expect(h.store.balances.get("u3")).toBe(100_000 - 1000 + u3Stack - 100);
    expect(h.store.amendments.at(-1)!.payments).toHaveLength(2);
    // u2 is the only nit left: round over.
    expect(h.view("u1").sideGames.nitGame.nitUserIds).toEqual([]);
    expect(h.store.totalChips()).toBe(300_000);
  });
});

describe("7-2 bounty", () => {
  it("collects from every other dealt-in player at showdown (capped by stacks)", async () => {
    const h = createHarness({
      settings: { autoStart: false, bountyGame: { enabled: true, bountyBB: 2, voteRule: "unanimous" } },
      decks: [deckBySeat(1, { 1: ["7c", "2d"], 2: ["Qh", "Jh"], 3: ["Th", "8h"] }, ["7h", "2s", "Ks", "9d", "4c"])],
    });
    await h.seat(["u1", "u2", "u3"]);
    await passVote(h, "BOUNTY_GAME", "START", ["u1", "u2", "u3"]);
    expect(h.view("u2").sideGames.bountyGame.active).toBe(true);
    await h.runtime.start("u1", TABLE_ID);
    await h.untilHand();
    await h.passiveToEnd();
    const result = h.view("u2").hand!.result!;
    expect(result.winners.every((w) => w.userId === "u1")).toBe(true);
    expect(result.sidePayments).toEqual([
      { fromSeat: 2, toSeat: 1, amount: 20, reason: "BOUNTY_7_2" },
      { fromSeat: 3, toSeat: 1, amount: 20, reason: "BOUNTY_7_2" },
    ]);
    expect(h.store.totalChips()).toBe(300_000);
  });

  it("uncontested 7-2 win: claim by showing before the next hand", async () => {
    const h = createHarness({
      settings: { autoStart: false, bountyGame: { enabled: true, bountyBB: 2, voteRule: "unanimous" } },
      decks: [deckBySeat(1, { 1: ["7c", "2d"], 2: ["Qh", "Jh"], 3: ["Th", "8h"] }, ["7h", "2s", "Ks", "9d", "4c"])],
    });
    await h.seat(["u1", "u2", "u3"]);
    await passVote(h, "BOUNTY_GAME", "START", ["u1", "u2", "u3"]);
    await h.runtime.start("u1", TABLE_ID);
    const hand = await h.untilHand();
    await h.act("u1", "raise", 40);
    await h.act("u2", "fold");
    await h.act("u3", "fold");
    await h.settle();
    expect(h.view("u2").seats.find((s) => s.userId === "u1")!.holeCards).toBeNull();
    expect(h.view("u1").viewer.canShowCards).toBe(true);
    const stackBefore = h.table().seatOf("u1")!.stack;
    await h.runtime.show("u1", TABLE_ID, hand.id);
    expect(h.view("u2").seats.find((s) => s.userId === "u1")!.holeCards).toEqual([
      { rank: "7", suit: "c" },
      { rank: "2", suit: "d" },
    ]);
    expect(h.table().seatOf("u1")!.stack).toBe(stackBefore + 40);
    expect(h.view("u2").hand!.result!.sidePayments).toHaveLength(2);
    expect(h.store.amendments.at(-1)).toMatchObject({ handId: hand.id, shownPlayerIds: ["u1"] });
    expect(h.store.totalChips()).toBe(300_000);
    // Showing twice pays nothing more.
    await h.runtime.show("u1", TABLE_ID, hand.id);
    expect(h.table().seatOf("u1")!.stack).toBe(stackBefore + 40);
  });
});
