import type { HandView, TableView } from "@poker-platform/shared/types";
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "./fixtures";
import { advanceSession, closeSession, type SeatSession } from "./session";

const base = SCENARIOS.find((s) => s.id === "preflop")!.build(Date.parse("2026-01-01T00:00:00Z"));
const heroSeat = base.viewer.seat!;

/** The fixture with the hero's stack / bet and the hand replaced. */
function view(stack: number, hand: Partial<HandView> | null, bet = 0, inHand = true): TableView {
  return {
    ...base,
    hand: hand === null ? null : ({ ...base.hand!, result: null, ...hand } as HandView),
    seats: base.seats.map((s) => (s.seat === heroSeat ? { ...s, stack, bet, inHand } : s)),
  };
}

const result = (amount: number) => ({
  winners: amount > 0 ? [{ seat: heroSeat, userId: base.viewer.userId, amount, potIndex: 0, boardIndex: 0, handName: null }] : [],
  shown: [],
  uncalledReturn: null,
  sidePayments: [],
});

const start = (stack: number): SeatSession => ({
  tableId: base.tableId,
  userId: base.viewer.userId,
  startedAt: 0,
  handsPlayed: 0,
  net: 0,
  biggestPotWon: 0,
  idleStack: stack,
  live: null,
  counted: [],
  lastStack: stack,
});

describe("seat session", () => {
  it("adds up each hand's result and ignores top-ups between hands", () => {
    let s = start(1000);
    // Hand 1: blinds posted, then wins 300 (net +150).
    s = advanceSession(s, view(990, { handId: "h1" }, 10));
    s = advanceSession(s, view(1150, { handId: "h1", result: result(300) }));
    // Top-up between hands: never counted as winnings.
    s = advanceSession(s, view(1650, null));
    // Hand 2: loses 400.
    s = advanceSession(s, view(1640, { handId: "h2" }, 10));
    s = advanceSession(s, view(1250, { handId: "h2", result: result(0) }));
    // The same result broadcast twice is counted once.
    s = advanceSession(s, view(1250, { handId: "h2", result: result(0) }));
    expect(s.handsPlayed).toBe(2);
    expect(s.net).toBe(150 - 400);
    expect(s.biggestPotWon).toBe(300);
  });

  it("skips a hand already running when the session started and hands the viewer sat out", () => {
    let s: SeatSession = { ...start(1000), idleStack: null };
    s = advanceSession(s, view(900, { handId: "h0" }, 100));
    s = advanceSession(s, view(1400, { handId: "h0", result: result(500) }));
    s = advanceSession(s, view(1400, { handId: "h1" }, 0, false));
    s = advanceSession(s, view(1400, { handId: "h1", result: result(0) }));
    expect(s.handsPlayed).toBe(0);
    expect(s.net).toBe(0);
  });

  it("counts a hand abandoned by standing up", () => {
    let s = start(1000);
    s = advanceSession(s, view(950, { handId: "h1" }, 50));
    s = closeSession(advanceSession(s, view(950, { handId: "h1" }, 0, false)));
    expect(s.handsPlayed).toBe(1);
    expect(s.net).toBe(-50);
  });
});
