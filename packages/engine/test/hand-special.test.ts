import { describe, expect, it } from "vitest";
import { buildPots, EngineError, splitAmount, splitBetweenBoards, type HandEvent, type PokerHand } from "../src";
import { baseConfig, players, startWith, streets } from "./helpers";

const ofType = <T extends HandEvent["type"]>(hand: PokerHand, type: T) =>
  hand.events.filter((e): e is Extract<HandEvent, { type: T }> => e.type === type);

const checkDown = (hand: PokerHand) => {
  while (!hand.isComplete) hand.act(hand.toActPlayerId!, { type: "check" });
};

describe("bomb pots", () => {
  it("everyone antes, no preflop betting, flop dealt, action starts left of the button", () => {
    const hand = startWith(baseConfig({ bombPot: { ante: 20, doubleBoard: false }, ante: 5, straddleSeat: 1 }));
    expect(ofType(hand, "POST").map((p) => [p.playerId, p.kind, p.amount])).toEqual([
      ["p2", "BOMB_POT_ANTE", 20],
      ["p3", "BOMB_POT_ANTE", 20],
      ["p1", "BOMB_POT_ANTE", 20],
    ]);
    expect(hand.street).toBe("FLOP");
    expect(hand.boards[0]).toHaveLength(3);
    expect(hand.toActPlayerId).toBe("p2");
    expect(hand.legalActions("p2")).toMatchObject({ isBet: true, canCheck: true, minTo: 10 });
    const snap = hand.snapshot();
    expect(snap).toMatchObject({ isBombPot: true, smallBlindSeat: null, bigBlindSeat: null, straddleSeat: null });
    expect(snap.pots).toEqual([{ amount: 60, eligiblePlayerIds: ["p1", "p2", "p3"] }]);
  });

  it("double board: each pot split per board, odd chip to board 1", () => {
    const cfg = baseConfig({ bombPot: { ante: 21, doubleBoard: true } });
    const hand = startWith(
      cfg,
      { p1: ["As", "Ad"], p2: ["7c", "7d"], p3: ["2h", "3h"] },
      // draw order: flop1, flop2, turn1, turn2, river1, river2
      [["Ah", "7h", "2c"], ["7s", "Ks", "Qc"], ["Kd"], ["4d"], ["9s"], ["8c"]],
    );
    expect(hand.boards).toEqual([
      ["Ah", "7h", "2c"],
      ["7s", "Ks", "Qc"],
    ]);
    checkDown(hand);
    const s = hand.summary!;
    expect(s.boards).toEqual([
      ["Ah", "7h", "2c", "Kd", "9s"],
      ["7s", "Ks", "Qc", "4d", "8c"],
    ]);
    expect(s.pots[0]!.awards.map((a) => [a.boardIndex, a.amount, a.winners.map((w) => w.playerId)])).toEqual([
      [0, 32, ["p1"]],
      [1, 31, ["p2"]],
    ]);
    expect(s.players.map((p) => p.net)).toEqual([11, 10, -21]);
    expect(s.players[0]!.hands.map((h) => h.name)).toEqual(["Three of a Kind, Aces", "Pair of Aces"]);
    expect(s).toMatchObject({ isBombPot: true, doubleBoard: true, preflopStatsEligible: false, ante: 21 });
    expect(s.players.every((p) => !p.stats.vpip && !p.stats.pfr && p.stats.sawFlop)).toBe(true);
  });

  it("double board with a split on one board", () => {
    const cfg = baseConfig({ players: players([1000, 1000]), bombPot: { ante: 25, doubleBoard: true } });
    const hand = startWith(
      cfg,
      { p1: ["As", "Ad"], p2: ["Ks", "Kd"] },
      [["2c", "3c", "4c"], ["Qh", "Jh", "Th"], ["5c"], ["9h"], ["6c"], ["8h"]],
    );
    checkDown(hand);
    const awards = hand.summary!.pots[0]!.awards;
    // board 1: straight flush on board -> split 25 between both (odd chip left of button: p2)
    expect(awards[0]!.winners.map((w) => [w.playerId, w.amount])).toEqual([
      ["p2", 13],
      ["p1", 12],
    ]);
    // board 2: Q-J-T-9-8 hearts straight flush on board too -> split
    expect(awards[1]!.winners.map((w) => w.amount)).toEqual([13, 12]);
  });

  it("all-in bomb pot antes run out automatically", () => {
    const hand = startWith(baseConfig({ players: players([10, 10, 1000]), bombPot: { ante: 20, doubleBoard: true } }));
    expect(hand.isComplete).toBe(true);
    const s = hand.summary!;
    expect(s.pots.map((p) => p.amount)).toEqual([30]);
    expect(ofType(hand, "UNCALLED_RETURN")).toEqual([expect.objectContaining({ playerId: "p3", amount: 10 })]);
    expect(s.boards.every((b) => b.length === 5)).toBe(true);
  });
});

describe("run it twice", () => {
  const hu = () => baseConfig({ players: players([1000, 1000]), runItTwice: true });

  it("pauses for a runout decision, then splits each pot per run", () => {
    const hand = startWith(
      hu(),
      { p1: ["As", "Ad"], p2: ["Ks", "Kd"] },
      [["2c", "7h", "9d"], ["3s"], ["4h"], ["Kc", "8h", "5d"], ["6s"], ["Jc"]],
    );
    hand.act("p1", { type: "allin" });
    hand.act("p2", { type: "call" });
    expect(hand.status).toBe("RUNOUT_DECISION");
    expect(hand.toActPlayerId).toBeNull();
    expect(hand.runoutDecisionPlayerIds()).toEqual(["p1", "p2"]);
    expect(hand.legalActions("p1")).toBeNull();
    expect(() => hand.act("p1", { type: "check" })).toThrow(EngineError);
    expect(hand.boards).toEqual([[]]);
    hand.chooseRunout(2);
    const s = hand.summary!;
    expect(s.runs).toBe(2);
    expect(s.boards).toEqual([
      ["2c", "7h", "9d", "3s", "4h"],
      ["Kc", "8h", "5d", "6s", "Jc"],
    ]);
    expect(s.players.map((p) => p.endingStack)).toEqual([1000, 1000]);
    expect(s.allIn).toEqual({ street: "PREFLOP", board: [], playerIds: ["p1", "p2"] });
    expect(ofType(hand, "RUNOUT")).toEqual([expect.objectContaining({ runs: 2 })]);
    expect(() => hand.chooseRunout(1)).toThrow(EngineError);
  });

  it("second run shares the cards already dealt", () => {
    const hand = startWith(hu(), { p1: ["As", "Ad"], p2: ["Ks", "Kd"] }, [["2c", "7h", "9d"], ["3s"], ["4h"], ["Kc"], ["Jc"]]);
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "check" });
    hand.act("p2", { type: "bet", amount: 100 });
    hand.act("p1", { type: "allin" });
    hand.act("p2", { type: "call" });
    expect(hand.status).toBe("RUNOUT_DECISION");
    hand.chooseRunout(2);
    const s = hand.summary!;
    expect(s.boards).toEqual([
      ["2c", "7h", "9d", "3s", "4h"],
      ["2c", "7h", "9d", "Kc", "Jc"],
    ]);
    expect(s.players.map((p) => p.endingStack)).toEqual([1000, 1000]);
    expect(s.allIn!.street).toBe("FLOP");
    // p1 was the last aggressor on the flop: shows first
    expect(ofType(hand, "SHOWDOWN")[0]!.order).toEqual(["p1", "p2"]);
  });

  it("choosing one run deals a single board", () => {
    const hand = startWith(hu());
    hand.act("p1", { type: "allin" });
    hand.act("p2", { type: "call" });
    hand.chooseRunout(1);
    expect(hand.summary!.boards).toHaveLength(1);
    expect(hand.summary!.runs).toBe(1);
    expect(hand.summary!.totalPot).toBe(2000);
  });

  it("odd chip goes to the first run", () => {
    const hand = startWith(baseConfig({ ante: 1, runItTwice: true }), { p2: ["As", "Ad"], p3: ["Ks", "Kd"] }, [
      ["2c", "7h", "9d"],
      ["3s"],
      ["4h"],
      ["Kc", "8h", "5d"],
      ["6s"],
      ["Jc"],
    ]);
    hand.act("p1", { type: "fold" });
    hand.act("p2", { type: "allin" });
    hand.act("p3", { type: "call" });
    hand.chooseRunout(2);
    const awards = hand.summary!.pots[0]!.awards;
    expect(awards.map((a) => [a.amount, a.winners[0]!.playerId])).toEqual([
      [1001, "p2"],
      [1000, "p3"],
    ]);
  });

  it("is not offered when the all-in happens on the river or without the flag", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000]) }));
    hand.act("p1", { type: "allin" });
    hand.act("p2", { type: "call" });
    expect(hand.isComplete).toBe(true);
  });

  it("is never offered on double-board bomb pots", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000]), runItTwice: true, bombPot: { ante: 20, doubleBoard: true } }));
    hand.act("p2", { type: "allin" });
    hand.act("p1", { type: "call" });
    expect(hand.isComplete).toBe(true);
    expect(hand.summary!.boards).toHaveLength(2);
    expect(hand.summary!.runs).toBe(1);
  });

  it("a non-all-in player leaving during the decision forfeits; all-in players stay live", () => {
    const three = startWith(baseConfig({ players: players([1000, 300, 1000]), runItTwice: true }));
    three.act("p1", { type: "call" });
    three.act("p2", { type: "allin" });
    three.act("p3", { type: "call" });
    three.act("p1", { type: "call" });
    // p1 and p3 still have chips: the flop is dealt and they keep betting.
    expect(three.status).toBe("BETTING");
    three.act("p3", { type: "allin" });
    three.act("p1", { type: "call" });
    expect(three.status).toBe("RUNOUT_DECISION");
    expect(three.foldOutOfTurn("p1")).toBe(false); // p1 called all-in too (equal stacks)
    expect(three.runoutDecisionPlayerIds()).toEqual(["p1", "p2", "p3"]);
  });

  it("a player leaving during the decision forfeits", () => {
    const hand = startWith(baseConfig({ runItTwice: true }));
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "allin" });
    hand.act("p3", { type: "call" });
    hand.act("p1", { type: "call" });
    expect(hand.status).toBe("RUNOUT_DECISION");
    expect(hand.foldOutOfTurn("p2")).toBe(false); // all-in: stays live
  });
});

describe("pots helpers", () => {
  it("layers side pots by all-in amounts", () => {
    expect(
      buildPots([
        { id: "a", committed: 50, folded: false, allIn: true },
        { id: "b", committed: 200, folded: false, allIn: false },
        { id: "c", committed: 120, folded: false, allIn: true },
        { id: "d", committed: 30, folded: true, allIn: false },
      ]),
    ).toEqual([
      { amount: 180, eligiblePlayerIds: ["a", "b", "c"] },
      { amount: 140, eligiblePlayerIds: ["b", "c"] },
      { amount: 80, eligiblePlayerIds: ["b"] },
    ]);
  });

  it("a layer above every live contribution goes to live players who are not all-in", () => {
    // b is all-in for 50 and can win at most 50 from a; a's other 50 is dead money only c can win.
    expect(
      buildPots([
        { id: "a", committed: 100, folded: true, allIn: false },
        { id: "b", committed: 50, folded: false, allIn: true },
        { id: "c", committed: 0, folded: false, allIn: false },
      ]),
    ).toEqual([
      { amount: 100, eligiblePlayerIds: ["b"] },
      { amount: 50, eligiblePlayerIds: ["c"] },
    ]);
  });

  it("merges layers nobody live can win into the previous pot", () => {
    expect(
      buildPots([
        { id: "a", committed: 100, folded: true, allIn: false },
        { id: "b", committed: 50, folded: false, allIn: true },
      ]),
    ).toEqual([{ amount: 150, eligiblePlayerIds: ["b"] }]);
  });

  it("splits with odd chips in order", () => {
    expect(splitAmount(10, ["x", "y", "z"])).toEqual([
      { id: "x", amount: 4 },
      { id: "y", amount: 3 },
      { id: "z", amount: 3 },
    ]);
    expect(splitBetweenBoards(7, 2)).toEqual([4, 3]);
    expect(splitBetweenBoards(7, 1)).toEqual([7]);
  });
});
