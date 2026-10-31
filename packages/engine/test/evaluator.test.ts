import pokersolver from "pokersolver";
import { describe, expect, it } from "vitest";
import {
  cardToIndex,
  categoryOf,
  compareHands,
  createDeck,
  evaluate5,
  evaluate7,
  evaluateHand,
  evaluateIndices,
  HandCategory,
  indexToCard,
  parseCards,
  shuffleInPlace,
  type Card,
} from "../src";

const h = (text: string) => evaluateHand(parseCards(text));

describe("5-card enumeration", () => {
  it("counts all 2,598,960 hands by category and 7,462 distinct values", () => {
    const counts = new Array<number>(9).fill(0);
    const distinct = new Set<number>();
    let mismatches = 0;
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++)
            for (let e = d + 1; e < 52; e++) {
              const v = evaluate5(a, b, c, d, e);
              if (v !== evaluateIndices([a, b, c, d, e])) mismatches++;
              counts[categoryOf(v)]!++;
              distinct.add(v);
            }
    expect(mismatches).toBe(0);
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
    expect(distinct.size).toBe(7462);
  });
});

describe("7-card enumeration", () => {
  it("counts all 133,784,560 hands by category", () => {
    const counts = new Array<number>(9).fill(0);
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++)
            for (let e = d + 1; e < 52; e++)
              for (let f = e + 1; f < 52; f++)
                for (let g = f + 1; g < 52; g++) counts[categoryOf(evaluate7(a, b, c, d, e, f, g))]!++;
    expect(counts).toEqual([23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584]);
  }, 120_000);
});

describe("hand names and best five", () => {
  const cases: Array<[string, string, string]> = [
    ["AsKsQsJsTs 2c 3d", "Royal Flush", "AsKsQsJsTs"],
    ["9h8h7h6h5h Ah Kh", "Straight Flush, Nine high", "9h8h7h6h5h"],
    ["5d4d3d2dAd Kc Qc", "Straight Flush, Five high", "5d4d3d2dAd"],
    ["JcJdJhJs 2c 3c 9d", "Four of a Kind, Jacks", "JsJhJdJc9d"],
    ["KcKdKh7s7c 2d 3h", "Full House, Kings full of Sevens", "KhKdKc7s7c"],
    ["KcKdKh7s7c7d 2h", "Full House, Kings full of Sevens", "KhKdKc7s7d"],
    ["Ah Jh 9h 6h 2h Kc Qc", "Flush, Ace high", "AhJh9h6h2h"],
    ["Ac 2d 3h 4s 5c Kd 9h", "Straight, Five high", "5c4s3h2dAc"],
    ["Tc Jd Qh Ks Ac 2d 3h", "Straight, Ace high", "AcKsQhJdTc"],
    ["6c 7d 8h 9s Tc Ac Ad", "Straight, Ten high", "Tc9s8h7d6c"],
    ["QcQdQh 9s 4c 2d 3h", "Three of a Kind, Queens", "QhQdQc9s4c"],
    ["KcKd 7h7s Ac 2d 3h", "Two Pair, Kings and Sevens", "KdKc7s7hAc"],
    ["KcKd 7h7s 2c2d Ah", "Two Pair, Kings and Sevens", "KdKc7s7hAh"],
    ["AcAd 9h 7s 4c 3d 2h", "Pair of Aces", "AdAc9h7s4c"],
    ["Ac Jd 9h 7s 4c 3d 2h", "High Card, Ace", "AcJd9h7s4c"],
  ];
  for (const [cards, name, best] of cases) {
    it(`${cards} -> ${name}`, () => {
      const r = h(cards);
      expect(r.name).toBe(name);
      expect(r.bestFive.join("")).toBe(best);
    });
  }

  it("describes kickers", () => {
    expect(h("AcAd Kh Qs 9c 3d 2h").description).toBe("Pair of Aces, King-Queen-Nine kickers");
    expect(h("KcKd 7h7s Ac 2d 3h").description).toBe("Two Pair, Kings and Sevens, Ace kicker");
    expect(h("Ah Jh 9h 6h 2h Kc Qc").description).toBe("Flush, Ace-Jack-Nine-Six-Two");
    expect(h("JcJdJhJs 2c 3c 9d").description).toBe("Four of a Kind, Jacks, Nine kicker");
  });

  it("rejects bad input", () => {
    expect(() => evaluateHand(parseCards("AcKc"))).toThrow();
    expect(() => evaluateHand(parseCards("AcAcKdQd2s"))).toThrow();
  });
});

describe("comparisons", () => {
  const better = (a: string, b: string) => expect(compareHands(h(a), h(b))).toBeGreaterThan(0);
  const tie = (a: string, b: string) => expect(compareHands(h(a), h(b))).toBe(0);

  it("orders categories", () => {
    better("2c3c4c5c6c 9d Kh", "AcAdAhAs Kd 2h 3s"); // straight flush > quads
    better("2c2d2h2s 3c 4d 5h", "AcAdAhKdKc 2h 3s"); // quads > full house
    better("2c2d2h3s3c 9d Jh", "AcKcQcJc9c 2h 3s"); // full house > flush
    better("2c5c7c9cJc 3d 4h", "AcKdQhJsTc 2h 3s"); // flush > straight
    better("Ac2d3h4s5c 9d Jh", "AcAdAh Kc Qd 2h 3s"); // wheel > trips
  });

  it("uses kickers", () => {
    better("AcAd Kh 9s 4c 3d 2h", "AhAs Qh 9d 4d 3c 2c");
    better("AcAd Kh 9s 5c 3d 2h", "AhAs Kd 9d 4d 3c 2c");
    better("KcKd 7h7s Ac 2d 3h", "KhKs 7d7c Qc 2h 3s");
    better("QcQdQh 9s 5c 2d 3h", "QsQhQd 8s 4c 2h 3d"); // trips kicker
  });

  it("wheel is the lowest straight", () => {
    better("2c3d4h5s6c 9d Kh", "Ac2d3h4s5c 9d Kh");
    better("2c3d4h5s6h 9d Kc", "Ac2d3h4s5c Td Kh");
  });

  it("board plays: both players tie", () => {
    // Board AKQJT straight, nobody beats it.
    tie("Ac Kd Qh Js Tc 2c 3d", "Ac Kd Qh Js Tc 4h 5s");
    // Board quads with Ace kicker on board.
    tie("9c9d9h9s Ac 2d 3h", "9c9d9h9s Ac 4d 5h");
  });

  it("counterfeited two pair uses the best two pairs", () => {
    tie("KcKd 7h7s QcQd 2h", "KhKs 7d7c QsQh 3s");
    better("KcKd QcQd 7h7s Ah", "KhKs QsQh 7d7c 3s");
  });

  it("six-card hands work", () => {
    expect(h("AcKcQcJcTc 2d").name).toBe("Royal Flush");
    expect(h("AcAd 2c 2d 7h 9s").name).toBe("Two Pair, Aces and Twos");
  });
});

describe("cross-check against pokersolver", () => {
  it("agrees on category and ordering for 30,000 random 7-card pairs", () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const solverCategory: Record<string, number> = {
      "High Card": 0,
      Pair: 1,
      "Two Pair": 2,
      "Three of a Kind": 3,
      Straight: 4,
      Flush: 5,
      "Full House": 6,
      "Four of a Kind": 7,
      "Straight Flush": 8,
      "Royal Flush": 8,
    };
    for (let i = 0; i < 30_000; i++) {
      const deck = shuffleInPlace(createDeck(), rnd);
      const board = deck.slice(0, 5);
      const a = [...board, deck[5]!, deck[6]!] as Card[];
      const b = [...board, deck[7]!, deck[8]!] as Card[];
      const ea = evaluateHand(a);
      const eb = evaluateHand(b);
      const sa = pokersolver.Hand.solve(a);
      const sb = pokersolver.Hand.solve(b);
      expect(ea.category).toBe(solverCategory[sa.name]);
      const winners = pokersolver.Hand.winners([sa, sb]);
      const solverCmp = winners.length === 2 ? 0 : winners[0] === sa ? 1 : -1;
      expect(Math.sign(compareHands(ea, eb))).toBe(solverCmp);
    }
  });
});

describe("index helpers", () => {
  it("round-trips card indices", () => {
    for (let i = 0; i < 52; i++) expect(cardToIndex(indexToCard(i))).toBe(i);
    expect(categoryOf(evaluateIndices(parseCards("AsKsQsJsTs").map(cardToIndex)))).toBe(HandCategory.STRAIGHT_FLUSH);
  });
});
