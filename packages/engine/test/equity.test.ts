import { describe, expect, it } from "vitest";
import {
  calculateEquity,
  calculateRangeEquity,
  createDeck,
  evaluateHand,
  evaluateOmaha,
  parseCards,
  parseRange,
  rangeComboCount,
  type Card,
} from "../src";

/** Independent brute force over the remaining cards using the public evaluators. */
function bruteForce(hands: Card[][], board: Card[], variant: "NLHE" | "PLO"): number[] {
  const used = new Set<string>([...hands.flat(), ...board]);
  const rest = createDeck().filter((c) => !used.has(c));
  const shares = hands.map(() => 0);
  let total = 0;
  const k = 5 - board.length;
  const rec = (start: number, picked: Card[]) => {
    if (picked.length === k) {
      const full = [...board, ...picked];
      const values = hands.map((hc) => (variant === "PLO" ? evaluateOmaha(hc, full) : evaluateHand([...hc, ...full])).value);
      const best = Math.max(...values);
      const winners = values.filter((v) => v === best).length;
      values.forEach((v, i) => {
        if (v === best) shares[i]! += 1 / winners;
      });
      total++;
      return;
    }
    for (let i = start; i < rest.length; i++) rec(i + 1, [...picked, rest[i]!]);
  };
  rec(0, []);
  return shares.map((s) => s / total);
}

describe("calculateEquity", () => {
  it("matches brute force on the flop (NLHE, 3-way)", () => {
    const hands = [parseCards("AhAd"), parseCards("KsKc"), parseCards("9h8h")];
    const board = parseCards("7h6c2h");
    const r = calculateEquity({ hands, board, variant: "NLHE" });
    expect(r.exact).toBe(true);
    const bf = bruteForce(hands, board, "NLHE");
    r.results.forEach((x, i) => expect(x.equity).toBeCloseTo(bf[i]!, 10));
    expect(r.results.reduce((s, x) => s + x.equity, 0)).toBeCloseTo(1, 10);
  });

  it("matches brute force on the turn (PLO)", () => {
    const hands = [parseCards("AhAdKsKd"), parseCards("9h8h7c6c")];
    const board = parseCards("Th5c2h3s");
    const r = calculateEquity({ hands, board, variant: "PLO" });
    expect(r.exact).toBe(true);
    const bf = bruteForce(hands, board, "PLO");
    r.results.forEach((x, i) => expect(x.equity).toBeCloseTo(bf[i]!, 10));
  });

  it("enumerates preflop heads-up exactly (AA vs KK about 81-82%)", () => {
    const r = calculateEquity({ hands: [parseCards("AhAd"), parseCards("KsKc")], variant: "NLHE" });
    expect(r.exact).toBe(true);
    expect(r.samples).toBe(1712304);
    expect(r.results[0]!.equity).toBeGreaterThan(0.81);
    expect(r.results[0]!.equity).toBeLessThan(0.825);
  });

  it("splits identical hands", () => {
    const r = calculateEquity({ hands: [parseCards("AhKh"), parseCards("AdKd")], board: parseCards("2c3c7s"), variant: "NLHE" });
    expect(r.results[0]!.equity).toBeCloseTo(0.5, 10);
    expect(r.results[0]!.tie).toBeGreaterThan(0.9);
  });

  it("complete board is a single evaluation", () => {
    const r = calculateEquity({ hands: [parseCards("AhKh"), parseCards("QdQc")], board: parseCards("2c3c7sQs9d"), variant: "NLHE" });
    expect(r.samples).toBe(1);
    expect(r.results.map((x) => x.win)).toEqual([0, 1]);
  });

  it("falls back to Monte Carlo and converges", () => {
    let seed = 99;
    const randomInt = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * n);
    };
    const hands = [parseCards("AhAd"), parseCards("KsKc")];
    const exact = calculateEquity({ hands, variant: "NLHE" });
    const mc = calculateEquity({ hands, variant: "NLHE", maxExactEvaluations: 0, iterations: 40_000, randomInt });
    expect(mc.exact).toBe(false);
    expect(mc.samples).toBe(40_000);
    expect(Math.abs(mc.results[0]!.equity - exact.results[0]!.equity)).toBeLessThan(0.01);
  });

  it("respects dead cards", () => {
    const hands = [parseCards("AhAd"), parseCards("KsKc")];
    const r = calculateEquity({ hands, board: parseCards("2c7d9s"), dead: parseCards("KhKd"), variant: "NLHE" });
    expect(r.samples).toBe(903); // C(43, 2)
    const bf = bruteForce(hands, parseCards("2c7d9s"), "NLHE");
    expect(r.results[1]!.equity).toBeLessThan(bf[1]!);
  });

  it("validates input", () => {
    expect(() => calculateEquity({ hands: [parseCards("AhAd"), parseCards("AhKc")], variant: "NLHE" })).toThrow();
    expect(() => calculateEquity({ hands: [parseCards("AhAdKc")], variant: "NLHE" })).toThrow();
    expect(() => calculateEquity({ hands: [parseCards("AhAd")], board: parseCards("2c3c"), variant: "NLHE" })).toThrow();
  });
});

describe("ranges", () => {
  it("parses common notation", () => {
    expect(rangeComboCount("AA")).toBe(6);
    expect(rangeComboCount("AKs")).toBe(4);
    expect(rangeComboCount("AKo")).toBe(12);
    expect(rangeComboCount("AK")).toBe(16);
    expect(rangeComboCount("TT+")).toBe(30);
    expect(rangeComboCount("A5s-A2s")).toBe(16);
    expect(rangeComboCount("ATs+")).toBe(16);
    expect(rangeComboCount("KTo+")).toBe(36);
    expect(rangeComboCount("99-66")).toBe(24);
    expect(rangeComboCount("AKs, TT+, A5s-A2s")).toBe(50);
    expect(rangeComboCount("AhKh, AKs")).toBe(4);
    expect(rangeComboCount("KA s".replace(" ", ""))).toBe(4);
    expect(parseRange("AhKh")).toEqual([["Ah", "Kh"]]);
  });

  it("rejects malformed ranges", () => {
    expect(() => parseRange("AAs")).toThrow();
    expect(() => parseRange("AK-QJ")).toThrow();
    expect(() => parseRange("XYZ")).toThrow();
  });

  it("range equity: AA vs KK range equals the hand equity", () => {
    let seed = 5;
    const randomInt = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * n);
    };
    const r = calculateRangeEquity({ ranges: [parseRange("AA"), parseRange("KK")], variant: "NLHE", iterations: 20_000, randomInt });
    expect(r.results[0]!.equity).toBeGreaterThan(0.79);
    expect(r.results[0]!.equity).toBeLessThan(0.84);
  });
});
