import type { LegalActions, TableView } from "@poker-platform/shared/types";
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "./fixtures";
import {
  betPresets,
  buyInRange,
  estimateSkew,
  isNewerView,
  ovalPoints,
  resolvePreAction,
  snapBet,
  votesNeeded,
} from "./logic";

const scenario = (id: string): TableView => SCENARIOS.find((s) => s.id === id)!.build(Date.parse("2026-01-01T00:00:00Z"));
const me = (v: TableView) => v.seats.find((s) => s.seat === v.viewer.seat)!;

const legal = (l: Partial<LegalActions>): LegalActions => ({
  canFold: true,
  canCheck: false,
  callAmount: 0,
  canBetOrRaise: true,
  isBet: false,
  minTo: 0,
  maxTo: 0,
  potTo: 0,
  ...l,
});

describe("betPresets", () => {
  it("uses BB multiples preflop and keeps min, pot and all-in", () => {
    const v = scenario("preflop");
    const presets = betPresets(v, v.viewer.legalActions!, me(v));
    expect(presets.map((p) => p.label)).toEqual(["Min", "2.5x", "3x", "4x", "Pot", "All-in"]);
    // Facing a raise to 30: 2.5x = 75, pot = 135 (potTo), all-in = 1480.
    expect(presets.find((p) => p.label === "2.5x")!.to).toBe(75);
    expect(presets.find((p) => p.label === "Pot")!.to).toBe(135);
    expect(presets.at(-1)!.to).toBe(1480);
  });

  it("drops fractions that would reach the max so All-in is always offered", () => {
    const v = scenario("multiway");
    const presets = betPresets(v, v.viewer.legalActions!, me(v));
    expect(presets.at(-1)).toEqual({ label: "All-in", to: 1650 });
    expect(presets.every((p) => p.to >= 600 && p.to <= 1650)).toBe(true);
    expect(new Set(presets.map((p) => p.to)).size).toBe(presets.length);
  });

  it("uses pot fractions postflop including the call", () => {
    const v = scenario("bomb"); // flop, no bet, pot 100
    const presets = betPresets(v, v.viewer.legalActions!, me(v));
    expect(presets.find((p) => p.label === "½ pot")!.to).toBe(50);
    expect(presets.find((p) => p.label === "⅓ pot")!.to).toBe(33);
    expect(presets.find((p) => p.label === "Pot")!.to).toBe(100);
  });

  it("PLO: the max is the pot (labelled Pot, never All-in) when the stack is deeper", () => {
    const v = scenario("plo");
    const presets = betPresets(v, v.viewer.legalActions!, me(v));
    expect(presets.at(-1)).toEqual({ label: "Pot", to: 120 });
    expect(presets.some((p) => p.label === "All-in")).toBe(false);
  });
});

describe("snapBet", () => {
  const l = legal({ minTo: 50, maxTo: 1480 });
  it("snaps to the step but keeps the exact min and max reachable", () => {
    expect(snapBet(53, l, 5)).toBe(55);
    expect(snapBet(10, l, 5)).toBe(50);
    expect(snapBet(1479, l, 5)).toBe(1480);
    expect(snapBet(1478, l, 5)).toBe(1480);
  });
});

describe("resolvePreAction", () => {
  it("check/fold checks when free and folds otherwise", () => {
    expect(resolvePreAction({ kind: "checkFold" }, legal({ canCheck: true }))).toEqual({ type: "check" });
    expect(resolvePreAction({ kind: "checkFold" }, legal({ callAmount: 20 }))).toEqual({ type: "fold" });
  });
  it("check is dropped if someone bet", () => {
    expect(resolvePreAction({ kind: "check" }, legal({ callAmount: 20 }))).toBeNull();
  });
  it("call X only fires for the same price", () => {
    expect(resolvePreAction({ kind: "call", amount: 20 }, legal({ callAmount: 20 }))).toEqual({ type: "call" });
    expect(resolvePreAction({ kind: "call", amount: 20 }, legal({ callAmount: 60 }))).toBeNull();
  });
  it("call any checks when free", () => {
    expect(resolvePreAction({ kind: "callAny" }, legal({ canCheck: true }))).toEqual({ type: "check" });
    expect(resolvePreAction({ kind: "callAny" }, legal({ callAmount: 500 }))).toEqual({ type: "call" });
  });
});

describe("buyInRange", () => {
  it("caps the sit buy-in by the wallet", () => {
    const v = scenario("empty");
    expect(buyInRange(v, { kind: "sit", seat: 1 })).toEqual({ min: 400, max: 2000, reason: null });
    const poor = { ...v, viewer: { ...v.viewer, walletBalance: 300 } };
    expect(buyInRange(poor, { kind: "sit", seat: 1 }).reason).toMatch(/at least 400/);
  });
  it("rebuy tops up to the table max", () => {
    const v = scenario("preflop"); // stack 1480, max 2000
    const r = buyInRange(v, { kind: "rebuy" });
    expect(r.max).toBe(520);
    expect(r.reason).toBeNull();
  });
});

describe("votesNeeded", () => {
  const base = scenario("bomb-vote").votes[0];
  it("majority needs more than half", () => {
    expect(votesNeeded({ ...base, rule: "majority", eligibleUserIds: ["a", "b", "c", "d", "e", "f"] })).toBe(4);
    expect(votesNeeded({ ...base, rule: "majority", eligibleUserIds: ["a", "b", "c"] })).toBe(2);
  });
  it("unanimous needs everyone", () => {
    expect(votesNeeded({ ...base, rule: "unanimous", eligibleUserIds: ["a", "b", "c"] })).toBe(3);
  });
});

describe("realtime helpers", () => {
  it("only accepts newer versions of the same table", () => {
    const v = scenario("preflop");
    expect(isNewerView(null, v)).toBe(true);
    expect(isNewerView(v, { ...v, version: v.version + 1 })).toBe(true);
    expect(isNewerView(v, { ...v })).toBe(false);
    expect(isNewerView({ ...v, version: 9 }, { ...v, version: 3 })).toBe(false);
    expect(isNewerView(v, { ...v, tableId: "other", version: 0 })).toBe(true);
  });
  it("estimates skew from the least-delayed sample", () => {
    expect(estimateSkew([])).toBe(0);
    expect(estimateSkew([-120, -40, -300])).toBe(-40);
  });
});

describe("ovalPoints", () => {
  it("starts at the bottom centre and spreads seats clockwise", () => {
    const pts = ovalPoints(6, 200, 100);
    expect(pts[0].x).toBeCloseTo(0, 5);
    expect(pts[0].y).toBeCloseTo(100, 5);
    expect(pts[1].x).toBeLessThan(0); // next seat is to the viewer's left
    expect(pts[3].y).toBeCloseTo(-100, 0); // opposite seat at the top
  });
});
