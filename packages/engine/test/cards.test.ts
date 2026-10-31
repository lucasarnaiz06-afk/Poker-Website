import { describe, expect, it } from "vitest";
import { createDeck, normalizeDeck, parseCard, parseCards, shuffledDeck, shuffleInPlace, toPublicCard } from "../src";

describe("cards", () => {
  it("parses codes", () => {
    expect(parseCard("as")).toBe("As");
    expect(parseCard("10h")).toBe("Th");
    expect(parseCards("AsKd Qc,Jh")).toEqual(["As", "Kd", "Qc", "Jh"]);
    expect(() => parseCard("1x")).toThrow();
    expect(toPublicCard("Td")).toEqual({ rank: "T", suit: "d" });
  });

  it("creates a 52 card deck of unique cards", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it("Fisher-Yates uses the injected randomInt with shrinking bounds", () => {
    const bounds: number[] = [];
    const deck = shuffledDeck((max) => {
      bounds.push(max);
      return 0;
    });
    expect(bounds).toEqual(Array.from({ length: 51 }, (_, i) => 52 - i));
    expect(new Set(deck).size).toBe(52);
  });

  it("is unbiased for a small array (chi-square sanity check)", () => {
    const counts = new Map<string, number>();
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    for (let i = 0; i < 60_000; i++) {
      const key = shuffleInPlace([1, 2, 3], rnd).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const n of counts.values()) expect(Math.abs(n - 10_000)).toBeLessThan(500);
  });

  it("rejects a randomInt out of range", () => {
    expect(() => shuffledDeck(() => 99)).toThrow(/randomInt/);
  });

  it("normalizes injected decks", () => {
    expect(normalizeDeck(["As", "Kd"], true)).toHaveLength(52);
    expect(() => normalizeDeck(["As", "As"], true)).toThrow();
    expect(() => normalizeDeck(["As"], false)).toThrow();
  });
});
