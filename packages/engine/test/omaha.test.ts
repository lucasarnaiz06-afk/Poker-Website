import { describe, expect, it } from "vitest";
import { compareHands, evaluateOmaha, parseCards } from "../src";

const o = (hole: string, board: string) => evaluateOmaha(parseCards(hole), parseCards(board));

describe("Omaha evaluation (exactly 2 hole + 3 board)", () => {
  it("needs two suited hole cards for a flush", () => {
    const r = o("AsAd3h4c", "AhKhQhJh2c");
    expect(r.name).toBe("Three of a Kind, Aces");
    expect(o("Ts9h3h4c", "AhKhQhJh2c").name).toBe("Flush, Ace high");
  });

  it("cannot play four board cards (no board quads)", () => {
    expect(o("AhKh2d3d", "9c9d9h9s2c").name).toBe("Three of a Kind, Nines");
    expect(o("2h2dAhKh", "9c9d9h9s5c").name).toBe("Full House, Nines full of Twos");
    expect(o("AhKhQdJd", "9c9d9h9s5c").name).toBe("Three of a Kind, Nines");
  });

  it("cannot play one hole card", () => {
    // Hold'em would make a straight with the 8 alone; Omaha needs 2 hole cards.
    expect(o("8cKsKd2h", "4h5s6d7cQh").name).toBe("Pair of Kings");
    expect(o("8c3sKd2h", "4h5s6d7cQh").name).toBe("Straight, Six high");
    expect(o("8c4sKd2h", "Th5s6d7cQh").name).toBe("Straight, Eight high");
  });

  it("uses exactly two hole cards even with trips in hand", () => {
    expect(o("AcAdAh2c", "Kc7d4s9hJd").name).toBe("Pair of Aces");
  });

  it("picks the best of all 60 combinations and returns the five cards", () => {
    const r = o("AhKh7c7d", "QhJhTh7s2c");
    expect(r.name).toBe("Royal Flush");
    expect(r.bestFive.join("")).toBe("AhKhQhJhTh");
    expect(compareHands(o("7c7d2s3s", "7hKd9c2c4h"), o("KcKs2s3d", "7hKd9c2c4h"))).toBeLessThan(0);
  });

  it("works with 3 and 4 board cards", () => {
    expect(o("AsAd3h4c", "AhKhQh").name).toBe("Three of a Kind, Aces");
    expect(o("AsAd3h4c", "AhKhQh3c").name).toBe("Three of a Kind, Aces");
  });

  it("validates sizes", () => {
    expect(() => o("AsAd3h", "AhKhQh")).toThrow();
    expect(() => o("AsAd3h4c", "AhKh")).toThrow();
    expect(() => o("AsAd3h4c", "AsKhQh")).toThrow();
  });
});
