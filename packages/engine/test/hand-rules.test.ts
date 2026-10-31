import { describe, expect, it } from "vitest";
import { computePositions, EngineError, PokerHand, type HandEvent, type PotAwardEvent } from "../src";
import { baseConfig, players, startWith, streets, sumStacks } from "./helpers";

const four = () => baseConfig({ players: players([1000, 1000, 1000, 1000]) });
const ofType = <T extends HandEvent["type"]>(hand: PokerHand, type: T) =>
  hand.events.filter((e): e is Extract<HandEvent, { type: T }> => e.type === type);

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("positions", () => {
  it("SB and BB follow the button; UTG acts first preflop", () => {
    const hand = startWith(four());
    const snap = hand.snapshot();
    expect(snap.smallBlindSeat).toBe(2);
    expect(snap.bigBlindSeat).toBe(3);
    expect(hand.toActPlayerId).toBe("p4");
    expect(hand.legalActions("p1")).toBeNull();
    expect(hand.legalActions("p4")).toEqual({
      canFold: true,
      canCheck: false,
      callAmount: 10,
      canBetOrRaise: true,
      isBet: false,
      minTo: 20,
      maxTo: 1000,
      potTo: 35,
    });
  });

  it("wraps around the table and handles a dead button", () => {
    expect(computePositions([1, 4, 7], 7)).toMatchObject({ smallBlindSeat: 1, bigBlindSeat: 4, straddleSeat: 7 });
    expect(computePositions([1, 4, 7], 5)).toMatchObject({ smallBlindSeat: 7, bigBlindSeat: 1, straddleSeat: 4 });
    expect(computePositions([2, 5], 5)).toMatchObject({ smallBlindSeat: 5, bigBlindSeat: 2, straddleSeat: null });
  });

  it("heads-up: button is SB and acts first preflop, last postflop", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000]), buttonSeat: 2 }));
    expect(hand.snapshot().smallBlindSeat).toBe(2);
    expect(hand.snapshot().bigBlindSeat).toBe(1);
    expect(hand.toActPlayerId).toBe("p2");
    hand.act("p2", { type: "call" });
    expect(hand.toActPlayerId).toBe("p1");
    hand.act("p1", { type: "check" });
    expect(hand.street).toBe("FLOP");
    expect(hand.toActPlayerId).toBe("p1");
    hand.act("p1", { type: "check" });
    expect(hand.toActPlayerId).toBe("p2");
  });
});

describe("betting rules", () => {
  it("min-raise is the last full raise size", () => {
    const hand = startWith(four());
    hand.act("p4", { type: "raise", amount: 35 }); // raise of 25
    expect(hand.legalActions("p1")).toMatchObject({ minTo: 60, callAmount: 35 });
    expectCode(() => hand.act("p1", { type: "raise", amount: 59 }), "INVALID_AMOUNT");
    hand.act("p1", { type: "raise", amount: 100 }); // raise of 65
    expect(hand.legalActions("p2")).toMatchObject({ minTo: 165, callAmount: 95 });
  });

  it("postflop min bet is the big blind and isBet is true", () => {
    const hand = startWith(four());
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    expect(hand.street).toBe("FLOP");
    expect(hand.toActPlayerId).toBe("p2");
    expect(hand.legalActions("p2")).toEqual({
      canFold: true,
      canCheck: true,
      callAmount: 0,
      canBetOrRaise: true,
      isBet: true,
      minTo: 10,
      maxTo: 990,
      potTo: 40,
    });
    hand.act("p2", { type: "bet", amount: 25 });
    expect(hand.events.at(-1)).toMatchObject({ type: "ACTION", action: "bet", amount: 25, to: 25 });
    expect(hand.legalActions("p3")).toMatchObject({ isBet: false, minTo: 50, callAmount: 25 });
  });

  it("rejects illegal actions with codes", () => {
    const hand = startWith(four());
    expectCode(() => hand.act("p1", { type: "call" }), "NOT_YOUR_TURN");
    expectCode(() => hand.act("p4", { type: "check" }), "CANNOT_CHECK");
    expectCode(() => hand.act("p4", { type: "raise", amount: 1001 }), "INVALID_AMOUNT");
    expectCode(() => hand.act("p4", { type: "raise", amount: 25.5 }), "INVALID_AMOUNT");
    expectCode(() => hand.act("p4", { type: "raise" }), "INVALID_AMOUNT");
    expectCode(() => hand.act("nobody", { type: "fold" }), "UNKNOWN_PLAYER");
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    expectCode(() => hand.act("p3", { type: "call" }), "NOTHING_TO_CALL");
    // Folding is always allowed on your turn, even when checking is possible.
    hand.act("p3", { type: "fold" });
    expect(hand.street).toBe("FLOP");
  });

  it("an incomplete all-in raise does not reopen betting for players who already acted", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 160, 1000]) }));
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    hand.act("p2", { type: "bet", amount: 100 });
    hand.act("p3", { type: "allin" }); // to 150: raise of 50 < 100
    expect(hand.events.at(-1)).toMatchObject({ action: "raise", to: 150, allIn: true, fullRaise: false });
    // p4 has not acted yet: may raise, min raise is still +100.
    expect(hand.legalActions("p4")).toMatchObject({ canBetOrRaise: true, minTo: 250, callAmount: 150 });
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    // p2 already acted: only call or fold.
    expect(hand.legalActions("p2")).toMatchObject({ canBetOrRaise: false, callAmount: 50, minTo: 0, maxTo: 0 });
    expectCode(() => hand.act("p2", { type: "raise", amount: 400 }), "CANNOT_RAISE");
    expectCode(() => hand.act("p2", { type: "allin" }), "CANNOT_RAISE");
    hand.act("p2", { type: "call" });
    expect(hand.street).toBe("TURN");
  });

  it("incomplete all-ins that add up to a full raise reopen betting", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 160, 210]) }));
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    hand.act("p2", { type: "bet", amount: 100 });
    hand.act("p3", { type: "allin" }); // 150
    hand.act("p4", { type: "allin" }); // 200 (incomplete over 150, but +100 over p2's bet)
    hand.act("p1", { type: "call" });
    expect(hand.legalActions("p2")).toMatchObject({ canBetOrRaise: true, minTo: 300, callAmount: 100 });
  });

  it("a full raise after an incomplete all-in reopens for everyone", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 160, 1000]) }));
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    hand.act("p2", { type: "bet", amount: 100 });
    hand.act("p3", { type: "allin" }); // 150 incomplete
    hand.act("p4", { type: "raise", amount: 250 }); // full raise of 100
    hand.act("p1", { type: "fold" });
    expect(hand.legalActions("p2")).toMatchObject({ canBetOrRaise: true, minTo: 350 });
  });

  it("an all-in bet smaller than the big blind is allowed and does not change the min raise", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 15]) }));
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    hand.act("p2", { type: "check" });
    expect(hand.legalActions("p3")).toMatchObject({ minTo: 5, maxTo: 5 });
    hand.act("p3", { type: "allin" });
    expect(hand.legalActions("p1")).toMatchObject({ callAmount: 5, minTo: 15 });
  });

  it("no raising when every other player is all-in", () => {
    const hand = startWith(baseConfig({ players: players([1000, 100, 1000]) }));
    hand.act("p1", { type: "fold" });
    hand.act("p2", { type: "allin" });
    expect(hand.legalActions("p3")).toMatchObject({ canBetOrRaise: false, callAmount: 90 });
  });
});

describe("short blinds and uncalled bets", () => {
  it("a short all-in big blind still makes others call the full big blind", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 4]) }));
    expect(hand.legalActions("p1")).toMatchObject({ callAmount: 10, minTo: 20 });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    expect(hand.street).toBe("FLOP");
    expect(hand.pots()).toEqual([
      { amount: 12, eligiblePlayerIds: ["p1", "p2", "p3"] },
      { amount: 12, eligiblePlayerIds: ["p1", "p2"] },
    ]);
  });

  it("heads-up short small blind: BB's excess is returned and the board runs out", () => {
    const hand = startWith(baseConfig({ players: players([3, 1000]), buttonSeat: 1 }));
    expect(hand.isComplete).toBe(true);
    const ret = ofType(hand, "UNCALLED_RETURN");
    expect(ret).toEqual([expect.objectContaining({ playerId: "p2", amount: 7 })]);
    const summary = hand.summary!;
    expect(summary.boards[0]).toHaveLength(5);
    expect(summary.totalPot).toBe(6);
    expect(summary.players.reduce((s, p) => s + p.endingStack, 0)).toBe(1003);
  });

  it("heads-up short big blind: SB does not act, gets the uncalled chip back", () => {
    const hand = startWith(baseConfig({ players: players([1000, 4]), buttonSeat: 1 }));
    expect(hand.isComplete).toBe(true);
    expect(ofType(hand, "UNCALLED_RETURN")).toEqual([expect.objectContaining({ playerId: "p1", amount: 1 })]);
    expect(ofType(hand, "ACTION")).toHaveLength(0);
  });

  it("uncalled bets are returned as their own event and are not winnings", () => {
    const hand = startWith(baseConfig());
    hand.act("p1", { type: "raise", amount: 30 });
    hand.act("p2", { type: "fold" });
    hand.act("p3", { type: "fold" });
    expect(hand.isComplete).toBe(true);
    expect(ofType(hand, "UNCALLED_RETURN")).toEqual([expect.objectContaining({ playerId: "p1", amount: 20 })]);
    const p1 = hand.summary!.players.find((p) => p.id === "p1")!;
    expect(p1).toMatchObject({ won: 25, uncalledReturned: 20, committed: 10, net: 15, endingStack: 1015 });
    expect(hand.summary!.totalPot).toBe(25);
    expect(hand.summary!.showdown).toBe(false);
  });

  it("everyone all-in from the blinds runs out without any action", () => {
    const hand = startWith(baseConfig({ players: players([5, 5, 10]), ante: 0 }));
    // p2 posts 5 (all-in), p3 posts 10 (all-in); p1 still has to decide.
    expect(hand.toActPlayerId).toBe("p1");
    expect(hand.legalActions("p1")).toMatchObject({ callAmount: 5, canBetOrRaise: false });
    hand.act("p1", { type: "call" });
    expect(hand.isComplete).toBe(true);
    expect(ofType(hand, "UNCALLED_RETURN")).toEqual([expect.objectContaining({ playerId: "p3", amount: 5 })]);
    expect(sumStacks(hand)).toBe(20);
    const bomb = startWith(baseConfig({ players: players([20, 20, 20]), bombPot: { ante: 20, doubleBoard: false } }));
    expect(bomb.isComplete).toBe(true);
    expect(ofType(bomb, "ACTION")).toHaveLength(0);
  });
});

describe("side pots and splits", () => {
  it("builds main and side pots and returns the uncovered excess", () => {
    const cfg = baseConfig({ players: players([100, 300, 1000]), buttonSeat: 3 });
    const hand = startWith(
      cfg,
      { p1: ["As", "Ad"], p2: ["Ks", "Kd"], p3: ["Qs", "Qd"] },
      streets("2c7h9d 3s 4h"),
    );
    expect(hand.toActPlayerId).toBe("p3");
    hand.act("p3", { type: "allin" });
    hand.act("p1", { type: "allin" });
    hand.act("p2", { type: "allin" });
    expect(hand.isComplete).toBe(true);
    const s = hand.summary!;
    expect(ofType(hand, "UNCALLED_RETURN")).toEqual([expect.objectContaining({ playerId: "p3", amount: 700 })]);
    expect(s.pots.map((p) => [p.amount, p.eligiblePlayerIds])).toEqual([
      [300, ["p1", "p2", "p3"]],
      [400, ["p2", "p3"]],
    ]);
    expect(s.players.map((p) => p.endingStack)).toEqual([300, 400, 700]);
    expect(s.players.map((p) => p.wonPerPot)).toEqual([
      [{ potIndex: 0, boardIndex: 0, amount: 300 }],
      [{ potIndex: 1, boardIndex: 0, amount: 400 }],
      [],
    ]);
    expect(s.players.map((p) => p.mustShow)).toEqual([true, true, true]);
  });

  it("odd chips go to the first winner left of the button", () => {
    const cfg = baseConfig();
    const hand = startWith(cfg, {}, streets("AhKhQh Jh Th"));
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "fold" });
    hand.act("p3", { type: "check" });
    for (let i = 0; i < 3; i++) {
      hand.act("p3", { type: "check" });
      hand.act("p1", { type: "check" });
    }
    const award = ofType(hand, "POT_AWARD")[0]!;
    expect(award.amount).toBe(25);
    expect(award.winners.map((w) => [w.playerId, w.amount])).toEqual([
      ["p3", 13],
      ["p1", 12],
    ]);
    expect(award.winners[0]!.handName).toBe("Royal Flush");
  });

  it("a folded player's chips stay in the pot but they never win", () => {
    const hand = startWith(baseConfig(), { p2: ["As", "Ah"], p1: ["7c", "2d"], p3: ["8c", "3d"] }, streets("AdAc9h 4s 5s"));
    hand.act("p1", { type: "raise", amount: 50 });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "call" });
    hand.act("p2", { type: "fold" });
    hand.act("p3", { type: "check" });
    hand.act("p1", { type: "check" });
    hand.act("p3", { type: "check" });
    hand.act("p1", { type: "check" });
    hand.act("p3", { type: "check" });
    hand.act("p1", { type: "check" });
    const s = hand.summary!;
    expect(s.totalPot).toBe(150);
    expect(s.players.find((p) => p.id === "p2")!.won).toBe(0);
    expect(s.players.find((p) => p.id === "p3")!.won).toBe(150); // 8-high beats 7-high
  });
});

describe("showdown", () => {
  it("last river aggressor shows first; losers who were not called may muck", () => {
    const hand = startWith(baseConfig(), { p1: ["Ac", "Kc"], p2: ["2s", "7d"], p3: ["Qh", "Qd"] }, streets("Ah9c4s 8d 3c"));
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    for (let i = 0; i < 2; i++) {
      hand.act("p2", { type: "check" });
      hand.act("p3", { type: "check" });
      hand.act("p1", { type: "check" });
    }
    hand.act("p2", { type: "check" });
    hand.act("p3", { type: "bet", amount: 20 });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    const sd = ofType(hand, "SHOWDOWN")[0]!;
    expect(sd.order).toEqual(["p3", "p1", "p2"]);
    expect(sd.hands.map((h) => [h.playerId, h.showReason])).toEqual([
      ["p3", "CALLED"],
      ["p1", "WINNER"],
      ["p2", null],
    ]);
    expect(sd.hands[1]!.boards[0]!.name).toBe("Pair of Aces");
    const s = hand.summary!;
    expect(s.players.map((p) => [p.wentToShowdown, p.wonAtShowdown])).toEqual([
      [true, true],
      [true, false],
      [true, false],
    ]);
  });

  it("without a bet on the last street the first player left of the button shows first", () => {
    const hand = startWith(baseConfig());
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    for (let i = 0; i < 3; i++) {
      hand.act("p2", { type: "check" });
      hand.act("p3", { type: "check" });
      hand.act("p1", { type: "check" });
    }
    expect(ofType(hand, "SHOWDOWN")[0]!.order).toEqual(["p2", "p3", "p1"]);
  });
});

describe("out-of-turn fold and timeouts", () => {
  it("folds a leaving player without changing the actor", () => {
    const hand = startWith(four());
    expect(hand.foldOutOfTurn("p2")).toBe(true);
    expect(hand.toActPlayerId).toBe("p4");
    expect(hand.foldOutOfTurn("p2")).toBe(false);
    const last = hand.events.at(-1)!;
    expect(last).toMatchObject({ type: "ACTION", action: "fold", outOfTurn: true, reason: "left" });
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    expect(hand.toActPlayerId).toBe("p3");
  });

  it("ends the round when the actor no longer needs to act", () => {
    const hand = startWith(baseConfig({ players: players([1000, 10, 1000]) }));
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" }); // all-in for the remaining 5
    expect(hand.toActPlayerId).toBe("p3"); // BB option
    hand.foldOutOfTurn("p1");
    expect(hand.isComplete).toBe(true);
    expect(hand.summary!.showdown).toBe(true);
  });

  it("awards the pot when only one player is left", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000]) }));
    hand.foldOutOfTurn("p2");
    expect(hand.isComplete).toBe(true);
    expect(hand.summary!.players.map((p) => p.endingStack)).toEqual([1010, 990]);
  });

  it("all-in players cannot be folded out of turn", () => {
    const hand = startWith(baseConfig({ players: players([1000, 100, 1000]) }));
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "allin" });
    expect(hand.foldOutOfTurn("p2")).toBe(false);
  });

  it("timeout checks when possible, else folds", () => {
    const hand = startWith(baseConfig());
    expect(hand.timeout()).toMatchObject({ playerId: "p1", action: "fold", reason: "timeout" });
    hand.act("p2", { type: "call" });
    expect(hand.timeout()).toMatchObject({ playerId: "p3", action: "check", reason: "timeout" });
  });
});

describe("antes and straddle", () => {
  it("antes are dead money posted before the blinds", () => {
    const hand = startWith(baseConfig({ ante: 2 }));
    const posts = ofType(hand, "POST");
    expect(posts.map((p) => [p.playerId, p.kind, p.amount])).toEqual([
      ["p2", "ANTE", 2],
      ["p3", "ANTE", 2],
      ["p1", "ANTE", 2],
      ["p2", "SMALL_BLIND", 5],
      ["p3", "BIG_BLIND", 10],
    ]);
    expect(hand.totalPot()).toBe(21);
    expect(hand.legalActions("p1")).toMatchObject({ callAmount: 10, minTo: 20, potTo: 10 + 21 + 10 });
  });

  it("UTG straddle posts 2x BB, acts last preflop and doubles the min raise", () => {
    const cfg = { ...four(), straddleSeat: 4 };
    const hand = startWith(cfg);
    expect(hand.snapshot().straddleSeat).toBe(4);
    expect(hand.toActPlayerId).toBe("p1");
    expect(hand.legalActions("p1")).toMatchObject({ callAmount: 20, minTo: 40 });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "call" });
    expect(hand.toActPlayerId).toBe("p4");
    expect(hand.legalActions("p4")).toMatchObject({ canCheck: true, canBetOrRaise: true, minTo: 40 });
    hand.act("p4", { type: "check" });
    expect(hand.street).toBe("FLOP");
  });

  it("rejects a straddle from the wrong seat and skips one that would be all-in", () => {
    expectCode(() => startWith({ ...four(), straddleSeat: 1 }), "INVALID_STRADDLE");
    const hand = startWith({ ...baseConfig({ players: players([1000, 1000, 1000, 20]) }), straddleSeat: 4 });
    expect(hand.snapshot().straddleSeat).toBeNull();
    expect(hand.toActPlayerId).toBe("p4");
  });

  it("extra blind posters get a live big blind and the option", () => {
    const hand = startWith({ ...four(), extraBlindPlayerIds: ["p1"] });
    expect(ofType(hand, "POST").map((p) => p.kind)).toEqual(["SMALL_BLIND", "BIG_BLIND", "EXTRA_BLIND"]);
    hand.act("p4", { type: "call" });
    expect(hand.legalActions("p1")).toMatchObject({ canCheck: true, canBetOrRaise: true });
    hand.act("p1", { type: "check" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    expect(hand.street).toBe("FLOP");
    expect(hand.totalPot()).toBe(40);
  });
});

describe("pot limit Omaha", () => {
  const plo = () => ({ ...four(), variant: "PLO" as const });

  it("deals four hole cards", () => {
    const hand = startWith(plo());
    expect(hand.snapshot().players.every((p) => p.holeCards.length === 4)).toBe(true);
  });

  it("caps raises at the pot after calling", () => {
    const hand = startWith(plo());
    expect(hand.legalActions("p4")).toMatchObject({ minTo: 20, maxTo: 35, potTo: 35 });
    hand.act("p4", { type: "raise", amount: 35 });
    // pot 50, call 35 -> raise to 35 + 50 + 35 = 120
    expect(hand.legalActions("p1")).toMatchObject({ minTo: 60, maxTo: 120, potTo: 120 });
    expectCode(() => hand.act("p1", { type: "raise", amount: 121 }), "INVALID_AMOUNT");
    expectCode(() => hand.act("p1", { type: "allin" }), "CANNOT_RAISE");
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "fold" });
    hand.act("p3", { type: "fold" });
    expect(hand.street).toBe("FLOP");
    expectCode(() => hand.act("p4", { type: "call" }), "NOTHING_TO_CALL");
  });

  it("postflop pot bet equals the pot; raise = bet + pot after call", () => {
    const hand = startWith(plo());
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    expect(hand.legalActions("p2")).toMatchObject({ isBet: true, minTo: 10, maxTo: 40 });
    hand.act("p2", { type: "bet", amount: 40 });
    expect(hand.legalActions("p3")).toMatchObject({ minTo: 80, maxTo: 160 });
  });

  it("all-in is allowed when the stack is within the pot limit", () => {
    const hand = startWith({ ...plo(), players: players([1000, 1000, 1000, 30]) });
    hand.act("p4", { type: "allin" });
    expect(hand.events.at(-1)).toMatchObject({ action: "raise", to: 30, allIn: true });
  });
});

describe("state", () => {
  it("serializes to JSON and resumes identically", () => {
    const run = (hand: PokerHand) => {
      hand.act("p2", { type: "check" });
      hand.act("p3", { type: "bet", amount: 40 });
      hand.act("p4", { type: "call" });
      hand.act("p1", { type: "fold" });
      hand.act("p2", { type: "fold" });
      while (!hand.isComplete) hand.timeout();
      return hand.summary;
    };
    const hand = startWith(four());
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    const json = JSON.stringify(hand.getState());
    const restored = PokerHand.fromState(JSON.parse(json));
    expect(run(restored)).toEqual(run(hand));
  });

  it("validates the start config", () => {
    expectCode(() => startWith(baseConfig({ players: players([1000]) })), "INVALID_CONFIG");
    expectCode(() => startWith(baseConfig({ players: players([1000, 0]) })), "INVALID_CONFIG");
    expectCode(() => startWith(baseConfig({ smallBlind: 20 })), "INVALID_CONFIG");
    expectCode(() => PokerHand.start(baseConfig(), {}), "INVALID_CONFIG");
    expectCode(
      () => startWith({ ...baseConfig({ players: players(Array(10).fill(100)) }), variant: "PLO", runItTwice: true }),
      "INVALID_CONFIG",
    );
  });

  it("deals with an injected randomInt", () => {
    const hand = PokerHand.start(baseConfig(), { randomInt: () => 0 });
    expect(hand.getState().deck).toHaveLength(52);
  });

  it("emits a complete ordered event log", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000]) }));
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "check" });
    while (!hand.isComplete) hand.timeout();
    const types = hand.events.map((e) => e.type);
    expect(types.slice(0, 4)).toEqual(["HAND_START", "POST", "POST", "HOLE_CARDS"]);
    expect(types.filter((t) => t === "STREET")).toHaveLength(3);
    expect(types.slice(-3)).toEqual(["SHOWDOWN", "POT_AWARD", "HAND_END"]);
    hand.events.forEach((e, i) => expect(e.seq).toBe(i));
    const award = hand.events.find((e): e is PotAwardEvent => e.type === "POT_AWARD")!;
    expect(award.amount).toBe(20);
  });
});
