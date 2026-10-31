import { describe, expect, it } from "vitest";
import { players } from "./helpers";
import { baseConfig, startWith } from "./helpers";

const statsOf = (hand: ReturnType<typeof startWith>, id: string) => hand.summary!.players.find((p) => p.id === id)!.stats;

describe("stat flags", () => {
  it("VPIP, PFR, 3-bet, faced/folded to 3-bet, c-bet, saw flop", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 1000, 1000]) }));
    hand.act("p4", { type: "raise", amount: 30 }); // open (2-bet)
    hand.act("p1", { type: "raise", amount: 90 }); // 3-bet
    hand.act("p2", { type: "fold" });
    hand.act("p3", { type: "fold" });
    hand.act("p4", { type: "call" });
    expect(hand.street).toBe("FLOP");
    hand.act("p4", { type: "check" });
    hand.act("p1", { type: "bet", amount: 100 }); // c-bet
    hand.act("p4", { type: "fold" });
    const p1 = statsOf(hand, "p1");
    const p4 = statsOf(hand, "p4");
    const p2 = statsOf(hand, "p2");
    const p3 = statsOf(hand, "p3");
    expect(p4).toMatchObject({ vpip: true, pfr: true, threeBet: false, threeBetOpportunity: false, facedThreeBet: true, foldedToThreeBet: false, sawFlop: true, cbetOpportunity: false, postflopChecks: 1, postflopFolds: 1 });
    expect(p1).toMatchObject({ vpip: true, pfr: true, threeBet: true, threeBetOpportunity: true, cbet: true, cbetOpportunity: true, sawFlop: true, postflopBets: 1 });
    expect(p2).toMatchObject({ vpip: false, pfr: false, threeBetOpportunity: false, sawFlop: false });
    expect(p3).toMatchObject({ vpip: false, pfr: false, sawFlop: false });
    expect(hand.summary!.isWalk).toBe(false);
  });

  it("3-bet opportunity when calling or folding to one raise; fold to 3-bet", () => {
    const hand = startWith(baseConfig({ players: players([1000, 1000, 1000, 1000]) }));
    hand.act("p4", { type: "raise", amount: 30 });
    hand.act("p1", { type: "call" });
    hand.act("p2", { type: "raise", amount: 120 }); // squeeze = 3-bet
    hand.act("p3", { type: "fold" });
    hand.act("p4", { type: "fold" });
    hand.act("p1", { type: "fold" });
    expect(statsOf(hand, "p1")).toMatchObject({ vpip: true, pfr: false, threeBetOpportunity: true, threeBet: false });
    expect(statsOf(hand, "p2")).toMatchObject({ vpip: true, pfr: true, threeBet: true, threeBetOpportunity: true });
    expect(statsOf(hand, "p3")).toMatchObject({ threeBetOpportunity: false });
    expect(statsOf(hand, "p4")).toMatchObject({ facedThreeBet: true, foldedToThreeBet: true });
  });

  it("checking the big blind is not VPIP; missed c-bet keeps the opportunity", () => {
    const hand = startWith(baseConfig());
    hand.act("p1", { type: "raise", amount: 30 });
    hand.act("p2", { type: "fold" });
    hand.act("p3", { type: "call" });
    hand.act("p3", { type: "bet", amount: 20 }); // donk bet: p1 never gets a c-bet chance
    hand.act("p1", { type: "call" });
    while (!hand.isComplete) hand.timeout();
    expect(statsOf(hand, "p1").cbetOpportunity).toBe(false);

    const limp = startWith(baseConfig());
    limp.act("p1", { type: "call" });
    limp.act("p2", { type: "call" });
    limp.act("p3", { type: "check" });
    limp.act("p2", { type: "check" });
    limp.act("p3", { type: "check" });
    limp.act("p1", { type: "check" });
    while (!limp.isComplete) limp.timeout();
    expect(statsOf(limp, "p3")).toMatchObject({ vpip: false, pfr: false, sawFlop: true });
    expect(statsOf(limp, "p2")).toMatchObject({ vpip: true });
  });

  it("c-bet opportunity when checked to; not taken", () => {
    const hand = startWith(baseConfig());
    hand.act("p1", { type: "raise", amount: 30 });
    hand.act("p2", { type: "fold" });
    hand.act("p3", { type: "call" });
    hand.act("p3", { type: "check" });
    hand.act("p1", { type: "check" });
    expect(hand.street).toBe("TURN");
    hand.foldOutOfTurn("p3");
    expect(statsOf(hand, "p1")).toMatchObject({ cbetOpportunity: true, cbet: false });
  });

  it("walks", () => {
    const hand = startWith(baseConfig());
    hand.act("p1", { type: "fold" });
    hand.act("p2", { type: "fold" });
    expect(hand.summary!.isWalk).toBe(true);
    expect(statsOf(hand, "p3")).toMatchObject({ vpip: false, sawFlop: false });
  });
});
