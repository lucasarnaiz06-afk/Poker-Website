import type { TableView } from "@poker-platform/shared/types";
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "./fixtures";
import { applyAction, castVote, initMockState, legalFor, propose, sit, startNextHand, type MockState } from "./mock-engine";

const build = (id: string): TableView => SCENARIOS.find((s) => s.id === id)!.build(Date.now());

/** Chips on the table: stacks + current bets + settled pots (+ pot already awarded into stacks). */
function tableChips(v: TableView): number {
  const hand = v.hand;
  const inStacks = v.seats.reduce((n, s) => n + s.stack + s.bet, 0);
  if (!hand || hand.result) return inStacks;
  return inStacks + hand.pots.reduce((n, p) => n + p.amount, 0);
}

function playOut(state: MockState): MockState {
  let s = state;
  for (let i = 0; i < 200 && s.view.hand && s.view.hand.phase !== "COMPLETE"; i += 1) {
    const seat = s.view.hand.toActSeat;
    if (seat === null) break;
    const legal = legalFor(s, seat)!;
    s = applyAction(s, seat, legal.canCheck ? "check" : "call").state;
  }
  return s;
}

describe("mock engine", () => {
  it("every fixture builds and initialises", () => {
    for (const sc of SCENARIOS) {
      const v = sc.build(Date.now());
      expect(v.settings.maxPlayers).toBeGreaterThanOrEqual(2);
      expect(() => initMockState(v)).not.toThrow();
      // The viewer's legal actions in the fixture should agree with the simulator's.
      if (v.viewer.legalActions) {
        const s = initMockState(v);
        const mine = legalFor(s, v.viewer.seat!);
        expect(mine?.callAmount).toBe(v.viewer.legalActions.callAmount);
        expect(mine?.canCheck).toBe(v.viewer.legalActions.canCheck);
      }
    }
  });

  it("rejects actions out of turn", () => {
    const s = initMockState(build("timebank"));
    const r = applyAction(s, s.view.viewer.seat!, "check");
    expect(r.ack.ok).toBe(false);
  });

  it("conserves chips through a whole hand and pays the winner", () => {
    let s = initMockState(build("preflop"));
    const before = tableChips(s.view);
    const r = applyAction(s, s.view.viewer.seat!, "call");
    expect(r.ack.ok).toBe(true);
    s = playOut(r.state);
    expect(s.view.hand!.phase).toBe("COMPLETE");
    expect(s.view.hand!.boards[0]).toHaveLength(5);
    const won = s.view.hand!.result!.winners.reduce((n, w) => n + w.amount, 0);
    expect(won).toBe(s.view.hand!.pots.reduce((n, p) => n + p.amount, 0));
    expect(tableChips(s.view)).toBe(before);
  });

  it("raises reopen the action and enforce the minimum", () => {
    const s = initMockState(build("preflop"));
    const seat = s.view.viewer.seat!;
    expect(applyAction(s, seat, "raise", 40).ack.ok).toBe(false); // below min 50
    const r = applyAction(s, seat, "raise", 90);
    expect(r.ack.ok).toBe(true);
    expect(r.state.view.hand!.currentBet).toBe(90);
    expect(r.state.view.hand!.toActSeat).not.toBe(seat);
  });

  it("starts the next hand: moves the button and posts blinds", () => {
    let s = playOut(applyAction(initMockState(build("preflop")), 4, "call").state);
    const button = s.view.hand!.buttonSeat;
    s = startNextHand(s);
    const h = s.view.hand!;
    expect(h.phase).toBe("PREFLOP");
    expect(h.buttonSeat).not.toBe(button);
    expect(h.currentBet).toBe(s.view.settings.bigBlind);
    expect(s.view.seats.find((x) => x.seat === h.bigBlindSeat)!.bet).toBe(s.view.settings.bigBlind);
    expect(s.view.viewer.legalActions === null || h.toActSeat === s.view.viewer.seat).toBe(true);
  });

  it("bomb pot vote passes and the next hand is a bomb pot with antes and a flop", () => {
    let s = initMockState(build("preflop"));
    s = playOut(applyAction(s, s.view.viewer.seat!, "call").state);
    const p = propose(s, "BOMB_POT", "START");
    expect(p.ack.ok).toBe(true);
    s = p.state;
    const vote = s.view.votes.find((v) => v.kind === "BOMB_POT")!;
    for (const id of vote.eligibleUserIds) if (id !== s.view.viewer.userId) s = castVote(s, id, vote.id, true).state;
    expect(s.view.sideGames.bombPotQueued).toBe(true);
    s = startNextHand(s);
    expect(s.view.hand!.isBombPot).toBe(true);
    expect(s.view.hand!.phase).toBe("FLOP");
    expect(s.view.hand!.boards[0]).toHaveLength(3);
    expect(s.view.hand!.pots[0].amount).toBe(s.view.settings.bombPot.anteBB * s.view.settings.bigBlind * 6);
  });

  it("unanimous votes fail on the first no", () => {
    const s = initMockState(build("nit"));
    const vote = s.view.votes[0];
    const r = castVote(s, vote.eligibleUserIds.find((id) => !vote.yesUserIds.includes(id))!, vote.id, false);
    expect(r.state.view.votes[0].status).toBe("FAILED");
  });

  it("sitting down takes chips from the wallet", () => {
    const s = initMockState(build("empty"));
    const r = sit(s, 3, 1000);
    expect(r.ack.ok).toBe(true);
    expect(r.state.view.viewer.seat).toBe(3);
    expect(r.state.view.viewer.walletBalance).toBe(s.view.viewer.walletBalance - 1000);
    expect(sit(s, 3, 50).ack.ok).toBe(false);
  });
});
