// Adversarial checks against TDA / standard casino and online rules. Each block targets one rule family.
import { describe, expect, it } from "vitest";
import {
  calculateEquity,
  compareHands,
  createDeck,
  EngineError,
  evaluateHand,
  evaluateOmaha,
  PokerHand,
  type Card,
  type HandEvent,
  type Variant,
} from "../src";
import { baseConfig, players, stackedDeck, startWith, streets, sumStacks } from "./helpers";

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

const checkDown = (hand: PokerHand) => {
  while (!hand.isComplete) {
    const id = hand.toActPlayerId!;
    const legal = hand.legalActions(id)!;
    hand.act(id, { type: legal.canCheck ? "check" : "call" });
  }
};

function expectZeroSum(hand: PokerHand) {
  const s = hand.summary!;
  expect(s.players.reduce((a, p) => a + p.net, 0)).toBe(0);
  for (const p of s.players) expect(p.net).toBe(p.endingStack - p.startingStack);
  expect(s.players.reduce((a, p) => a + p.won, 0)).toBe(s.totalPot);
}

// A royal flush on board: every live player ties.
const ROYAL = streets("AsKsQs Js Ts");

describe("adversarial: betting", () => {
  it("min bet postflop is the big blind; a bet below it is rejected unless all-in", () => {
    const hand = startWith(baseConfig());
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    expect(hand.legalActions("p2")).toMatchObject({ isBet: true, minTo: 10 });
    expectCode(() => hand.act("p2", { type: "bet", amount: 9 }), "INVALID_AMOUNT");
    expectCode(() => hand.act("p2", { type: "bet", amount: 0 }), "INVALID_AMOUNT");
    expectCode(() => hand.act("p2", { type: "bet", amount: 10.5 }), "INVALID_AMOUNT");
  });

  it("incomplete all-in raise: acted players may only call/fold, unacted players may raise a full increment", () => {
    // p4 UTG, p1 BTN (40 chips), p2 SB, p3 BB
    const hand = startWith(baseConfig({ players: players([40, 1000, 1000, 1000]) }));
    hand.act("p4", { type: "raise", amount: 30 }); // raise of 20
    hand.act("p1", { type: "allin" }); // to 40: incomplete (10 < 20)
    const ev = ofType(hand, "ACTION").at(-1)!;
    expect(ev).toMatchObject({ action: "raise", to: 40, fullRaise: false, allIn: true });
    expect(hand.legalActions("p2")).toMatchObject({ canBetOrRaise: true, minTo: 60, callAmount: 35 });
    hand.act("p2", { type: "fold" });
    expect(hand.legalActions("p3")).toMatchObject({ canBetOrRaise: true, minTo: 60 }); // BB has not acted
    hand.act("p3", { type: "call" });
    expect(hand.legalActions("p4")).toMatchObject({ canBetOrRaise: false, callAmount: 10, canCheck: false });
    expectCode(() => hand.act("p4", { type: "raise", amount: 100 }), "CANNOT_RAISE");
    expectCode(() => hand.act("p4", { type: "allin" }), "CANNOT_RAISE");
  });

  it("cumulative short all-ins totalling a full raise reopen the action (TDA)", () => {
    // Preflop everyone calls 10. Flop: p2 bets 100, p3 all-in 150, p4 all-in 200, p1 calls; p2 may re-raise.
    const hand = startWith(baseConfig({ players: players([1000, 1000, 160, 210]) }));
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    expect(hand.toActPlayerId).toBe("p2");
    hand.act("p2", { type: "bet", amount: 100 });
    hand.act("p3", { type: "allin" }); // 150: +50
    hand.act("p4", { type: "allin" }); // 200: +50 -> cumulative +100 over p2's bet
    expect(hand.legalActions("p1")).toMatchObject({ canBetOrRaise: true, minTo: 300 });
    hand.act("p1", { type: "call" });
    expect(hand.legalActions("p2")).toMatchObject({ canBetOrRaise: true, callAmount: 100, minTo: 300 });
  });

  it("two short all-ins that do not add up to a full raise do not reopen", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 160, 200]) }));
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    hand.act("p2", { type: "bet", amount: 100 });
    hand.act("p3", { type: "allin" }); // 150
    hand.act("p4", { type: "allin" }); // 190: cumulative +90 < 100
    hand.act("p1", { type: "call" });
    expect(hand.legalActions("p2")).toMatchObject({ canBetOrRaise: false, callAmount: 90 });
  });

  it("BB keeps the option when the pot is limped", () => {
    const hand = startWith(baseConfig());
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    expect(hand.toActPlayerId).toBe("p3");
    expect(hand.legalActions("p3")).toMatchObject({ canCheck: true, canBetOrRaise: true, minTo: 20 });
    hand.act("p3", { type: "raise", amount: 40 });
    expect(hand.toActPlayerId).toBe("p1");
  });

  it("straddle acts last preflop and the min raise is to twice the straddle", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 1000, 1000]), straddleSeat: 4 }));
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
    expect(hand.toActPlayerId).toBe("p2");
  });

  it("heads-up with a dead button (3 -> 2 handed): the SB acts first preflop and LAST postflop", () => {
    // Last hand: button 1, SB 2, BB 3. Seat 2 busted, the button moves to the empty seat 2.
    // Seat 3 (last BB) must not post the BB again: seat 3 = SB, seat 1 = BB.
    const cfg = baseConfig({ players: [{ id: "a", seat: 1, stack: 1000 }, { id: "c", seat: 3, stack: 1000 }], buttonSeat: 2 });
    const hand = startWith(cfg);
    const snap = hand.snapshot();
    expect(snap.smallBlindSeat).toBe(3);
    expect(snap.bigBlindSeat).toBe(1);
    expect(hand.toActPlayerId).toBe("c");
    hand.act("c", { type: "call" });
    hand.act("a", { type: "check" });
    expect(hand.street).toBe("FLOP");
    expect(hand.toActPlayerId).toBe("a"); // BB acts first postflop heads-up
  });

  it("antes and blinds posted short go all-in and are capped in side pots", () => {
    // p2 (SB) has 3 chips: all-in on the 5-chip ante. p3 (BB) has 8: ante 5 + 3 of the BB.
    const cfg = baseConfig({ players: players([1000, 3, 8, 1000]), ante: 5 });
    const hand = startWith(cfg, { p2: ["As", "Ad"], p3: ["Ks", "Kd"], p1: ["7c", "2d"], p4: ["8c", "3d"] }, streets("Ah Kh 4c 9d Jc"));
    const posts = ofType(hand, "POST").map((p) => [p.playerId, p.kind, p.amount, p.allIn]);
    expect(posts).toContainEqual(["p2", "ANTE", 3, true]);
    expect(posts).toContainEqual(["p3", "BIG_BLIND", 3, true]);
    expect(hand.toActPlayerId).toBe("p4");
    expect(hand.legalActions("p4")).toMatchObject({ callAmount: 10 }); // still the full BB
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    checkDown(hand);
    const s = hand.summary!;
    // Committed: p2 3, p3 8, p1/p4 15 -> pots 3x4, 5x3, 7x2.
    expect(s.pots.map((p) => [p.amount, p.eligiblePlayerIds])).toEqual([
      [12, ["p1", "p2", "p3", "p4"]],
      [15, ["p1", "p3", "p4"]],
      [14, ["p1", "p4"]],
    ]);
    expect(s.players.find((p) => p.id === "p2")!.won).toBe(12);
    expect(s.players.find((p) => p.id === "p3")!.won).toBe(15);
    expectZeroSum(hand);
  });
});

describe("adversarial: pot-limit Omaha", () => {
  const plo = (stacks = [1000, 1000, 1000, 1000]) => baseConfig({ variant: "PLO", players: players(stacks) });

  it("preflop pot = 3.5 BB for UTG, and facing a raise = call + pot after call", () => {
    const hand = startWith(plo());
    expect(hand.legalActions("p4")).toMatchObject({ minTo: 20, maxTo: 35, potTo: 35 });
    hand.act("p4", { type: "raise", amount: 35 });
    // pot after call = 5 + 10 + 35 + 35 = 85 -> raise to 35 + 85 = 120
    expect(hand.legalActions("p1")).toMatchObject({ minTo: 60, maxTo: 120 });
    hand.act("p1", { type: "call" });
    // SB: pot 5+10+35+35 = 85, call 30 -> 115, raise to 35 + 115 = 150
    expect(hand.legalActions("p2")).toMatchObject({ maxTo: 150, callAmount: 30 });
  });

  it("multiway postflop: bet pot, then raise pot", () => {
    const hand = startWith(plo());
    for (const id of ["p4", "p1", "p2"]) hand.act(id, { type: "call" });
    hand.act("p3", { type: "check" });
    expect(hand.legalActions("p2")).toMatchObject({ isBet: true, minTo: 10, maxTo: 40 });
    hand.act("p2", { type: "bet", amount: 40 });
    // pot 40 + 40 bet + 40 call = 120 -> raise to 160
    expect(hand.legalActions("p3")).toMatchObject({ minTo: 80, maxTo: 160 });
    hand.act("p3", { type: "call" });
    // pot 40 + 40 + 40 + call 40 = 160 -> raise to 200
    expect(hand.legalActions("p4")).toMatchObject({ maxTo: 200 });
  });

  it("short stack: maxTo is the stack; all-in over the pot is rejected", () => {
    const hand = startWith(plo([1000, 1000, 1000, 30]));
    expect(hand.legalActions("p4")).toMatchObject({ maxTo: 30, minTo: 20 });
    hand.act("p4", { type: "allin" });
    expect(ofType(hand, "ACTION").at(-1)).toMatchObject({ to: 30, allIn: true });
    expectCode(() => hand.act("p1", { type: "allin" }), "CANNOT_RAISE");
  });
});

describe("adversarial: evaluator", () => {
  const e = (s: string) => evaluateHand(s.match(/.{2}/g)! as Card[]);
  const o = (h: string, b: string) => evaluateOmaha(h.match(/.{2}/g)! as Card[], b.match(/.{2}/g)! as Card[]);

  it("Omaha: four hearts on board + one heart in hand is not a flush", () => {
    const r = o("Ah2c3d4s", "KhQhJh9h5c");
    expect(r.categoryName).not.toBe("Flush");
    expect(o("Ah2h3d4s", "KhQhJh9c5c").categoryName).toBe("Flush");
  });

  it("Omaha: board quads cannot play; two hole cards must be used", () => {
    const r = o("2c2d7h8s", "AsAhAdAcKs");
    expect(r.name).toBe("Full House, Aces full of Twos");
    const r2 = o("3c4d7h8s", "AsAhAdAcKs");
    expect(r2.categoryName).toBe("Three of a Kind");
  });

  it("Omaha: wheel and a board straight that needs two hole cards", () => {
    expect(o("Ac2dKhKs", "3h4s5cJdQd").name).toBe("Straight, Five high");
    expect(o("AcKdQhJs", "9h8s7c6d5d").categoryName).not.toBe("Straight"); // board straight does not play
  });

  it("kickers and ties", () => {
    // Two pair with a third pair on board: best two pairs + best kicker.
    expect(compareHands(e("AhJd" + "QhQs8c8d2h"), e("KcJd" + "QhQs8c8d2h"))).toBeGreaterThan(0);
    expect(compareHands(e("2c2d" + "QhQs8c8dAh"), e("3c4d" + "QhQs8c8dAh"))).toBe(0);
    // Board straight vs a higher straight using one hole card.
    expect(compareHands(e("Tc2d" + "9h8s7c6d5h"), e("Ac2h" + "9h8s7c6d5h"))).toBeGreaterThan(0);
    expect(compareHands(e("Kc2d" + "9h8s7c6d5h"), e("Ac2h" + "9h8s7c6d5h"))).toBe(0);
    // Wheel < six-high straight.
    expect(compareHands(e("6c7d" + "As2h3c4d5h").value, e("KcKd" + "As2h3c4d5h").value)).toBeGreaterThan(0);
    expect(e("Ac2d3h4s5c").name).toBe("Straight, Five high");
    expect(compareHands(e("2c3d4h5s6c"), e("Ac2d3h4s5c"))).toBeGreaterThan(0);
    // Flushes rank by all five cards.
    expect(compareHands(e("AhKh9h7h3h"), e("AhKh9h7h2h"))).toBeGreaterThan(0);
    // Two trips: the higher trips + pair of the lower trips.
    expect(e("KcKd" + "KhQsQcQd2h").name).toBe("Full House, Kings full of Queens");
    expect(e("KcKd" + "KhQsQc2d2h").name).toBe("Full House, Kings full of Queens");
    // Quads kicker from the board.
    expect(compareHands(e("2c3d" + "9h9s9c9dAh"), e("KcQd" + "9h9s9c9dAh"))).toBe(0);
  });

  it("best five reflects the hand", () => {
    expect(e("AsKs" + "QsJsTs9s8s").name).toBe("Royal Flush");
    expect(new Set(e("2c3d" + "9h9s9c9dAh").bestFive)).toEqual(new Set(["9h", "9s", "9c", "9d", "Ah"]));
  });
});

describe("adversarial: pots", () => {
  it("four different all-in sizes build three side pots; the big stack gets the uncalled excess back", () => {
    const cfg = baseConfig({ players: players([1000, 100, 200, 300]) });
    // p1 BTN, p2 SB 100, p3 BB 200, p4 UTG 300. Hands: p2 best, then p3, then p4, then p1.
    const hand = startWith(
      cfg,
      { p2: ["As", "Ad"], p3: ["Ks", "Kd"], p4: ["Qs", "Qd"], p1: ["7c", "2d"] },
      streets("3h 8h 9c 4d Jc"),
    );
    hand.act("p4", { type: "allin" });
    hand.act("p1", { type: "allin" });
    hand.act("p2", { type: "allin" });
    hand.act("p3", { type: "allin" });
    expect(hand.isComplete).toBe(true);
    const s = hand.summary!;
    expect(s.pots.map((p) => [p.amount, p.eligiblePlayerIds])).toEqual([
      [400, ["p1", "p2", "p3", "p4"]],
      [300, ["p1", "p3", "p4"]],
      [200, ["p1", "p4"]],
    ]);
    expect(ofType(hand, "UNCALLED_RETURN")).toMatchObject([{ playerId: "p1", amount: 700 }]);
    expect(s.players.map((p) => p.endingStack)).toEqual([700, 400, 300, 200]);
    expectZeroSum(hand);
  });

  it("uncalled return when the over-bettor is all-in and the caller is shorter (heads-up)", () => {
    const hand = startWith(baseConfig({ players: players([1000, 300]), buttonSeat: 1 }), { p1: ["As", "Ad"], p2: ["Ks", "Kd"] }, streets("2c 3d 7h 8s 9c"));
    hand.act("p1", { type: "allin" });
    hand.act("p2", { type: "call" });
    expect(ofType(hand, "UNCALLED_RETURN")).toMatchObject([{ playerId: "p1", amount: 700 }]);
    const s = hand.summary!;
    expect(s.totalPot).toBe(600);
    expect(s.players[0]).toMatchObject({ endingStack: 1300, won: 600, uncalledReturned: 700, net: 300 });
    expectZeroSum(hand);
  });

  it("folded players' chips stay in the pots they reached", () => {
    // p4 raises 100, p1 calls all-in 50, p2 folds (SB 5), p3 calls 100, flop p3/p4 check down. p1 wins main only.
    const cfg = baseConfig({ players: players([50, 1000, 1000, 1000]) });
    const hand = startWith(cfg, { p1: ["As", "Ad"], p3: ["Ks", "Kd"], p4: ["Qs", "Qd"] }, streets("2c 3d 7h 8s 9c"));
    hand.act("p4", { type: "raise", amount: 100 });
    hand.act("p1", { type: "allin" });
    hand.act("p2", { type: "fold" });
    hand.act("p3", { type: "call" });
    checkDown(hand);
    const s = hand.summary!;
    expect(s.pots.map((p) => [p.amount, p.eligiblePlayerIds])).toEqual([
      [155, ["p1", "p3", "p4"]],
      [100, ["p3", "p4"]],
    ]);
    expect(s.players.map((p) => p.won)).toEqual([155, 0, 100, 0]);
    expectZeroSum(hand);
  });

  it("odd chip goes to the first winner left of the button, per pot", () => {
    // 3 players, ante 1, p1 folds, blinds limp: pot 23 split between p2 and p3.
    const cfg = baseConfig({ ante: 1 });
    const hand = startWith(cfg, {}, ROYAL);
    hand.act("p1", { type: "fold" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    checkDown(hand);
    const award = hand.summary!.pots[0]!.awards[0]!;
    expect(award.amount).toBe(23);
    expect(award.winners.map((w) => [w.playerId, w.amount])).toEqual([
      ["p2", 12],
      ["p3", 11],
    ]);
  });

  it("odd chip with the button on the last seat wraps around to seat 1", () => {
    const cfg = baseConfig({ ante: 2, buttonSeat: 3 }); // SB p1, BB p2, UTG/BTN p3
    const hand = startWith(cfg, {}, ROYAL);
    hand.act("p3", { type: "call" });
    hand.act("p1", { type: "fold" });
    hand.act("p2", { type: "check" });
    checkDown(hand);
    const award = hand.summary!.pots[0]!.awards[0]!;
    expect(award.amount).toBe(31); // 3 antes of 2 + 5 + 10 + 10
    expect(award.winners.map((w) => [w.playerId, w.amount])).toEqual([
      ["p2", 16],
      ["p3", 15],
    ]);
  });

  it("double board with odd amounts: board 1 gets the odd chip, then odd chip left of the button per board", () => {
    const cfg = baseConfig({ bombPot: { ante: 5, doubleBoard: true } }); // pot 15 -> 8 / 7
    // p1 wins board 1 (set of eights), everyone chops board 2 (board plays a straight).
    const hand = startWith(
      cfg,
      { p1: ["8s", "8h"], p2: ["2c", "3c"], p3: ["2d", "3d"] },
      [["Ah", "Kc", "7h"], ["Ts", "Js", "Qh"], ["8d"], ["Kd"], ["4s"], ["9c"]],
    );
    checkDown(hand);
    const s = hand.summary!;
    const awards = s.pots[0]!.awards.map((a) => [a.boardIndex, a.amount, a.winners.map((w) => [w.playerId, w.amount])]);
    expect(awards[0]).toEqual([0, 8, [["p1", 8]]]);
    // Board 2: 9-T-J-Q-K straight on board plays for everyone: three-way chop of 7: 3/2/2 starting p2.
    expect(awards[1]).toEqual([1, 7, [["p2", 3], ["p3", 2], ["p1", 2]]]);
    expectZeroSum(hand);
  });

  it("run it twice: a player can win one run and lose the other; odd chips split correctly", () => {
    const cfg = baseConfig({ players: players([1001, 1000]), buttonSeat: 1, runItTwice: true });
    // HU: p1 BTN/SB. All-in preflop. Run 1 favours p1, run 2 p2.
    const holes = { p1: ["As", "Ad"], p2: ["Ks", "Kd"] };
    const deck = stackedDeck(cfg, holes, [
      ["2c", "7d", "9h"], ["3s"], ["4c"], // run 1: aces hold
      ["Kc", "8d", "Th"], ["5s"], ["6d"], // run 2: kings set
    ]);
    const hand = PokerHand.start(cfg, { deck });
    hand.act("p1", { type: "allin" });
    hand.act("p2", { type: "call" });
    expect(hand.status).toBe("RUNOUT_DECISION");
    expect(ofType(hand, "UNCALLED_RETURN")).toMatchObject([{ playerId: "p1", amount: 1 }]);
    hand.chooseRunout(2);
    const s = hand.summary!;
    expect(s.runs).toBe(2);
    expect(s.pots[0]!.awards.map((a) => [a.amount, a.winners.map((w) => w.playerId)])).toEqual([
      [1000, ["p1"]],
      [1000, ["p2"]],
    ]);
    expect(s.players.map((p) => p.net)).toEqual([0, 0]);
    expect(s.players.map((p) => p.wonAtShowdown)).toEqual([true, true]);
    expectZeroSum(hand);
  });

  it("run it twice with an odd pot: board 1 gets the odd chip", () => {
    const cfg = baseConfig({ players: players([1000, 1000, 1000]), runItTwice: true, ante: 1 });
    const hand = startWith(cfg, { p1: ["As", "Ad"], p2: ["Ks", "Kd"], p3: ["7c", "2d"] }, [
      ["2c", "7d", "9h"], ["3s"], ["4c"],
      ["Kc", "8d", "Th"], ["5s"], ["6d"],
    ]);
    hand.act("p1", { type: "allin" });
    hand.act("p2", { type: "allin" });
    hand.act("p3", { type: "fold" });
    hand.chooseRunout(2);
    const s = hand.summary!;
    // 1000 + 1000 + 10 (p3 BB) + 1 ante = 2011 -> 1006 / 1005
    expect(s.pots.map((p) => p.amount)).toEqual([2011]);
    expect(s.pots[0]!.awards.map((a) => [a.amount, a.winners.map((w) => w.playerId)])).toEqual([
      [1006, ["p1"]],
      [1005, ["p2"]],
    ]);
    expectZeroSum(hand);
  });

  it("a player who leaves after betting gets the uncalled part of the bet back", () => {
    // Flop: p1 bets 500, p2 calls all-in 300, p1 leaves (out-of-turn fold), p3 folds.
    // p2 can win at most 300 from p1: p1's uncalled 200 must be returned.
    const cfg = baseConfig({ players: players([1000, 310, 1000]) });
    const hand = startWith(cfg);
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    hand.act("p2", { type: "check" });
    hand.act("p3", { type: "check" });
    hand.act("p1", { type: "bet", amount: 500 });
    hand.act("p2", { type: "allin" });
    expect(hand.foldOutOfTurn("p1")).toBe(true);
    expect(hand.toActPlayerId).toBe("p3");
    hand.act("p3", { type: "fold" });
    const s = hand.summary!;
    expect(s.players.map((p) => p.endingStack)).toEqual([1000 - 10 - 300, 30 + 300 + 300, 990]);
    expectZeroSum(hand);
    expect(sumStacks(hand)).toBe(2310);
  });
});

describe("adversarial: state machine", () => {
  it("acting out of turn, double acting and acting after completion are rejected without changing state", () => {
    const hand = startWith(baseConfig());
    const before = JSON.stringify(hand.getState());
    expectCode(() => hand.act("p2", { type: "fold" }), "NOT_YOUR_TURN");
    expectCode(() => hand.act("nobody", { type: "fold" }), "UNKNOWN_PLAYER");
    expectCode(() => hand.act("p1", { type: "check" }), "CANNOT_CHECK");
    expectCode(() => hand.act("p1", { type: "raise", amount: 15 }), "INVALID_AMOUNT");
    expectCode(() => hand.act("p1", { type: "raise", amount: 2000 }), "INVALID_AMOUNT");
    expectCode(() => hand.act("p1", { type: "raise" }), "INVALID_AMOUNT");
    expectCode(() => hand.act("p1", { type: "bogus" as "fold" }), "INVALID_ACTION");
    expect(JSON.stringify(hand.getState())).toBe(before);
    hand.act("p1", { type: "call" });
    expectCode(() => hand.act("p1", { type: "call" }), "NOT_YOUR_TURN");
    hand.act("p2", { type: "fold" });
    hand.act("p3", { type: "raise", amount: 50 });
    hand.act("p1", { type: "fold" });
    expect(hand.isComplete).toBe(true);
    expectCode(() => hand.act("p3", { type: "check" }), "HAND_COMPLETE");
    expectCode(() => hand.timeout(), "HAND_COMPLETE");
    expect(hand.foldOutOfTurn("p3")).toBe(false);
    expectCode(() => hand.chooseRunout(1), "NOT_RUNOUT_DECISION");
  });

  it("fold out of turn of a non-actor keeps the actor; of the last opponent ends the hand", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 1000, 1000]) }));
    expect(hand.toActPlayerId).toBe("p4");
    expect(hand.foldOutOfTurn("p2")).toBe(true);
    expect(hand.toActPlayerId).toBe("p4");
    expect(hand.foldOutOfTurn("p2")).toBe(false);
    hand.act("p4", { type: "call" });
    hand.act("p1", { type: "call" });
    expect(hand.toActPlayerId).toBe("p3");
    // BB leaves while it's their turn: normal fold
    expect(hand.foldOutOfTurn("p3")).toBe(true);
    expect(hand.street).toBe("FLOP");
    expect(hand.foldOutOfTurn("p1")).toBe(true);
    expect(hand.isComplete).toBe(true);
    expect(hand.summary!.players.find((p) => p.id === "p4")!.won).toBe(35);
    expectZeroSum(hand);
  });

  it("fold out of turn by the last player who had to act closes the round", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 1000, 1000]) }));
    hand.act("p4", { type: "raise", amount: 30 });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    // p3 (BB) to act; p4 leaves -> p3 still to act
    expect(hand.foldOutOfTurn("p4")).toBe(true);
    expect(hand.toActPlayerId).toBe("p3");
    hand.act("p3", { type: "call" });
    expect(hand.street).toBe("FLOP");
  });

  it("timeout checks when possible, else folds", () => {
    const hand = startWith(baseConfig());
    expect(hand.timeout()).toMatchObject({ action: "fold", reason: "timeout" });
    hand.act("p2", { type: "call" });
    expect(hand.timeout()).toMatchObject({ action: "check", reason: "timeout", playerId: "p3" });
    expectCode(() => {
      const h = startWith(baseConfig({ runItTwice: true, players: players([100, 100]) }));
      h.act(h.toActPlayerId!, { type: "allin" });
      h.act(h.toActPlayerId!, { type: "call" });
      h.timeout();
    }, "NOT_BETTING");
  });

  it("restoring from JSON mid-hand (including mid runout decision) continues identically", () => {
    const run = (restoreAt: number) => {
      let hand = PokerHand.start(baseConfig({ runItTwice: true, players: players([500, 800, 300, 900]) }), { deck: createDeck().reverse() });
      const script: Array<(h: PokerHand) => void> = [
        (h) => h.act("p4", { type: "raise", amount: 30 }),
        (h) => h.act("p1", { type: "call" }),
        (h) => h.act("p2", { type: "fold" }),
        (h) => h.act("p3", { type: "call" }),
        (h) => h.act("p3", { type: "bet", amount: 50 }),
        (h) => h.act("p4", { type: "raise", amount: 200 }),
        (h) => h.act("p1", { type: "allin" }),
        (h) => h.act("p3", { type: "allin" }),
        (h) => h.act("p4", { type: "call" }),
        (h) => h.chooseRunout(2),
      ];
      script.forEach((step, i) => {
        if (i === restoreAt) hand = PokerHand.fromState(JSON.parse(JSON.stringify(hand.getState())));
        step(hand);
      });
      return hand;
    };
    const ref = run(-1);
    expect(ref.isComplete).toBe(true);
    for (let i = 0; i < 10; i++) {
      const h = run(i);
      expect(h.getState()).toEqual(ref.getState());
    }
  });

  it("deck injection: duplicate or invalid cards are rejected; a prefix is completed", () => {
    expectCode(() => PokerHand.start(baseConfig(), { deck: ["As", "As"] }), "DUPLICATE_CARD");
    expectCode(() => PokerHand.start(baseConfig(), { deck: ["As", "Xx"] }), "INVALID_CARD");
    const deck = createDeck();
    deck[51] = "2c";
    expectCode(() => PokerHand.start(baseConfig(), { deck }), "DUPLICATE_CARD");
    const h = PokerHand.start(baseConfig(), { deck: ["As", "Ks"] });
    const all = [...h.getState().deck];
    expect(new Set(all).size).toBe(52);
  });

  it("extreme stacks: 1 chip and 2^31", () => {
    const hand = startWith(baseConfig({ players: players([1, 2 ** 31, 2 ** 31]), buttonSeat: 3 }), {}, ROYAL);
    // p1 SB posts 1 all-in, p2 BB
    expect(hand.getPlayer("p1")).toMatchObject({ allIn: true, stack: 0 });
    hand.act("p3", { type: "allin" });
    hand.act("p2", { type: "call" });
    expect(hand.isComplete).toBe(true);
    expectZeroSum(hand);
    expect(sumStacks(hand)).toBe(1 + 2 ** 32);
  });

  it("rejects configs whose total chips are not safe integers", () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    expectCode(() => PokerHand.start(baseConfig({ players: players([big, big, big]) }), { deck: [] }), "INVALID_CONFIG");
  });
});

describe("adversarial: summary stats", () => {
  it("VPIP / PFR / 3-bet / c-bet / WTSD flags (PokerTracker)", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 1000, 1000]) }), {
      p1: ["As", "Ad"], p2: ["Ks", "Kd"], p3: ["Qs", "Qd"], p4: ["Js", "Jd"],
    }, streets("2c7d9h 3s 4c"));
    hand.act("p4", { type: "raise", amount: 30 }); // open
    hand.act("p1", { type: "raise", amount: 90 }); // 3-bet
    hand.act("p2", { type: "fold" });
    hand.act("p3", { type: "call" }); // cold call of a 3-bet
    hand.act("p4", { type: "call" });
    // flop: p3 first, checks; p4 checks; p1 c-bets
    hand.act("p3", { type: "check" });
    hand.act("p4", { type: "check" });
    hand.act("p1", { type: "bet", amount: 100 });
    hand.act("p3", { type: "fold" });
    hand.act("p4", { type: "call" });
    checkDown(hand);
    const st = Object.fromEntries(hand.summary!.players.map((p) => [p.id, { ...p.stats, wtsd: p.wentToShowdown, wsd: p.wonAtShowdown }]));
    expect(st.p4).toMatchObject({ vpip: true, pfr: true, threeBet: false, facedThreeBet: true, foldedToThreeBet: false, sawFlop: true, wtsd: true, wsd: false });
    expect(st.p1).toMatchObject({ vpip: true, pfr: true, threeBet: true, threeBetOpportunity: true, cbet: true, cbetOpportunity: true, wtsd: true, wsd: true });
    expect(st.p2).toMatchObject({ vpip: false, pfr: false, threeBetOpportunity: false, sawFlop: false });
    expect(st.p3).toMatchObject({ vpip: true, pfr: false, threeBet: false, threeBetOpportunity: false, sawFlop: true, wtsd: false });
    expectZeroSum(hand);
  });

  it("BB check and SB complete: VPIP only for the voluntary call", () => {
    const hand = startWith(baseConfig());
    hand.act("p1", { type: "fold" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    hand.act("p2", { type: "bet", amount: 10 });
    hand.act("p3", { type: "fold" });
    const st = Object.fromEntries(hand.summary!.players.map((p) => [p.id, p.stats]));
    expect(st.p2!.vpip).toBe(true);
    expect(st.p3!.vpip).toBe(false);
    expect(st.p2!.cbetOpportunity).toBe(false); // nobody raised preflop
    expectZeroSum(hand);
  });

  it("bomb pots: no preflop stats", () => {
    const hand = startWith(baseConfig({ bombPot: { ante: 10, doubleBoard: false } }));
    hand.act("p2", { type: "bet", amount: 10 });
    hand.act("p3", { type: "fold" });
    hand.act("p1", { type: "fold" });
    const s = hand.summary!;
    expect(s.preflopStatsEligible).toBe(false);
    for (const p of s.players) expect(p.stats).toMatchObject({ vpip: false, pfr: false, cbet: false, cbetOpportunity: false, sawFlop: true });
    expectZeroSum(hand);
  });
});

// ---- Equity vs brute force --------------------------------------------------------------------------

function bruteEquity(hands: Card[][], board: Card[], variant: Variant): number[] {
  const used = new Set<string>([...hands.flat(), ...board]);
  const rest = createDeck().filter((c) => !used.has(c));
  const k = 5 - board.length;
  const shares = hands.map(() => 0);
  let n = 0;
  const visit = (start: number, picked: Card[]) => {
    if (picked.length === k) {
      const full = [...board, ...picked];
      const vals = hands.map((h) => (variant === "PLO" ? evaluateOmaha(h, full).value : evaluateHand([...h, ...full]).value));
      const best = Math.max(...vals);
      const winners = vals.filter((v) => v === best).length;
      vals.forEach((v, i) => {
        if (v === best) shares[i]! += 1 / winners;
      });
      n++;
      return;
    }
    for (let i = start; i < rest.length; i++) visit(i + 1, [...picked, rest[i]!]);
  };
  visit(0, []);
  return shares.map((s) => s / n);
}

describe("adversarial: equity", () => {
  const spots: Array<{ hands: string[]; board: string; variant: Variant }> = [
    { hands: ["AhKh", "QsQd"], board: "2h7hTc", variant: "NLHE" },
    { hands: ["AhKh", "QsQd", "JcTd"], board: "2h7hTc3s", variant: "NLHE" },
    { hands: ["AhKd", "AcKs"], board: "2h7h9c3s", variant: "NLHE" }, // mostly ties
    { hands: ["AhKd", "AcKs"], board: "QhJhTc2s5d", variant: "NLHE" }, // river tie
    { hands: ["AhAdKhKd", "QsJsTs9s"], board: "2h7s8c", variant: "PLO" },
    { hands: ["AhAdKhKd", "QsJsTs9s", "6c6d5c5d"], board: "2h7s8c4d", variant: "PLO" },
  ];
  for (const spot of spots) {
    it(`${spot.variant} ${spot.hands.join(" vs ")} on ${spot.board}`, () => {
      const hands = spot.hands.map((h) => h.match(/.{2}/g)! as Card[]);
      const board = spot.board.match(/.{2}/g)! as Card[];
      const r = calculateEquity({ hands, board, variant: spot.variant });
      expect(r.exact).toBe(true);
      const brute = bruteEquity(hands, board, spot.variant);
      r.results.forEach((res, i) => expect(res.equity).toBeCloseTo(brute[i]!, 10));
      expect(r.results.reduce((a, x) => a + x.equity, 0)).toBeCloseTo(1, 10);
      for (const res of r.results) expect(res.win + res.tie).toBeLessThanOrEqual(1 + 1e-12);
    });
  }
});

describe("adversarial: more edge cases", () => {
  it("an ante-all-in player left alone (others leave) wins only what they matched", () => {
    // p1 is all-in for a 2-chip ante; p2 and p3 build a big pot preflop, then both leave.
    const cfg = baseConfig({ players: players([2, 1000, 1000]), ante: 2, runItTwice: true });
    const hand = startWith(cfg);
    expect(hand.getPlayer("p1")).toMatchObject({ allIn: true, committed: 2 });
    expect(hand.toActPlayerId).toBe("p2");
    hand.act("p2", { type: "raise", amount: 500 });
    hand.act("p3", { type: "allin" });
    hand.act("p2", { type: "fold" }); // p3's uncalled excess comes back; p3 vs p1 all-in -> runout decision
    expect(hand.status).toBe("RUNOUT_DECISION");
    expect(hand.foldOutOfTurn("p3")).toBe(true);
    const s = hand.summary!;
    expect(s.players.find((p) => p.id === "p1")!.won).toBe(6); // 2 from each player
    // Nobody live can win the 500 + 500 side layer: it goes back to the two players who put it in.
    expect(s.players.map((p) => p.endingStack)).toEqual([6, 998, 998]);
    expectZeroSum(hand);
  });

  it("heads-up dead button: odd chip goes to the BB (left of the SB/button)", () => {
    const cfg = baseConfig({ players: [{ id: "a", seat: 1, stack: 1000 }, { id: "c", seat: 3, stack: 1000 }], buttonSeat: 2, ante: 1, smallBlind: 5, bigBlind: 10 });
    const hand = startWith(cfg, {}, ROYAL);
    hand.act("c", { type: "call" });
    hand.act("a", { type: "check" });
    checkDown(hand);
    const award = hand.summary!.pots[0]!.awards[0]!;
    expect(award.amount).toBe(22);
    // Even pot: the winners are listed in odd-chip order, BB first.
    expect(award.winners.map((w) => w.playerId)).toEqual(["a", "c"]);
  });

  it("straddle requested heads-up or from a wrong seat is rejected", () => {
    expectCode(() => startWith(baseConfig({ players: players([1000, 1000]), straddleSeat: 1 })), "INVALID_STRADDLE");
    expectCode(() => startWith(baseConfig({ straddleSeat: 2 })), "INVALID_STRADDLE");
  });

  it("extra (new-player) blind poster has the option and may check", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 1000, 1000]), extraBlindPlayerIds: ["p4"] }));
    expect(hand.toActPlayerId).toBe("p4");
    expect(hand.legalActions("p4")).toMatchObject({ canCheck: true, canBetOrRaise: true, minTo: 20 });
    hand.act("p4", { type: "check" });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    expect(hand.street).toBe("FLOP");
    expect(hand.totalPot()).toBe(40);
  });

  it("showdown order: river bettor shows first; a caller who loses may muck", () => {
    const hand = startWith(baseConfig(), { p1: ["As", "Ad"], p2: ["Ks", "Kd"], p3: ["7c", "2d"] }, streets("3h8h9c 4d Jc"));
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    for (let i = 0; i < 6; i++) hand.act(hand.toActPlayerId!, { type: "check" });
    expect(hand.street).toBe("RIVER");
    hand.act("p2", { type: "check" });
    hand.act("p3", { type: "bet", amount: 10 });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    const sd = ofType(hand, "SHOWDOWN")[0]!;
    expect(sd.order).toEqual(["p3", "p1", "p2"]);
    expect(sd.hands.map((h) => [h.playerId, h.showReason])).toEqual([
      ["p3", "CALLED"],
      ["p1", "WINNER"],
      ["p2", null],
    ]);
  });

  it("dead money above an all-in player's stake goes to the live player who is not all-in", () => {
    // Flop: p1 bets 500, p2 calls all-in 300, p1 leaves, p3 calls 300. p2 wins the main pot only.
    const cfg = baseConfig({ players: players([1000, 310, 1000]) });
    const hand = startWith(cfg, { p1: ["7c", "2d"], p2: ["As", "Ad"], p3: ["Ks", "Kd"] }, streets("3h8h9c 4d Jc"));
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "call" });
    hand.act("p3", { type: "check" });
    hand.act("p2", { type: "check" });
    hand.act("p3", { type: "check" });
    hand.act("p1", { type: "bet", amount: 500 });
    hand.act("p2", { type: "allin" });
    hand.foldOutOfTurn("p1");
    expect(hand.legalActions("p3")).toMatchObject({ callAmount: 300, canBetOrRaise: false });
    hand.act("p3", { type: "call" });
    const s = hand.summary!;
    expect(s.pots.map((p) => [p.amount, p.eligiblePlayerIds])).toEqual([
      [930, ["p2", "p3"]],
      [200, ["p3"]],
    ]);
    expect(s.players.map((p) => p.endingStack)).toEqual([490, 930, 890]);
    expectZeroSum(hand);
  });
});
