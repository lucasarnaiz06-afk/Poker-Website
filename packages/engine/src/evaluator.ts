// Fast poker hand evaluator (5, 6 or 7 cards, best five), written from scratch.
//
// Cards are indices 0..51 (rank * 4 + suit). A hand value is a non-negative integer where a higher
// value is a better hand and equal values tie:
//   value = category << 20 | r1 << 16 | r2 << 12 | r3 << 8 | r4 << 4 | r5
// with category 0 (high card) .. 8 (straight flush) and r1..r5 the rank indices (0 = deuce ..
// 12 = ace) that decide the hand in order of significance.
//
// The evaluator builds four rank bitmasks ("rank seen at least 1/2/3/4 times") plus one rank mask
// per suit, then resolves the category with small precomputed 8192-entry tables. No allocation
// happens on the hot path.
import { cardToIndex, indexToCard, type Card } from "./cards";
import { EngineError } from "./errors";

export const HandCategory = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
} as const;
export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory];

export const CATEGORY_NAMES = [
  "High Card",
  "Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
] as const;
export type HandCategoryName = (typeof CATEGORY_NAMES)[number];

const SHIFT = 1 << 20;

// ---- Lookup tables over 13-bit rank masks ---------------------------------------------------
const POPCOUNT = new Uint8Array(8192);
const TOP_BIT = new Int8Array(8192);
const STRAIGHT_TOP = new Int8Array(8192);
// Top five ranks of the mask packed as r1<<16|r2<<12|r3<<8|r4<<4|r5 (missing ranks are 0).
const TOP5 = new Int32Array(8192);

(function buildTables() {
  for (let m = 0; m < 8192; m++) {
    let count = 0;
    let top = -1;
    for (let r = 0; r < 13; r++) {
      if (m & (1 << r)) {
        count++;
        top = r;
      }
    }
    POPCOUNT[m] = count;
    TOP_BIT[m] = top;

    let straight = -1;
    for (let t = 12; t >= 4; t--) {
      const need = 0b11111 << (t - 4);
      if ((m & need) === need) {
        straight = t;
        break;
      }
    }
    // Wheel: A-2-3-4-5, five high (rank index 3).
    if (straight < 0 && (m & 0b1000000001111) === 0b1000000001111) straight = 3;
    STRAIGHT_TOP[m] = straight;

    let packed = 0;
    let rest = m;
    for (let k = 0; k < 5; k++) {
      packed <<= 4;
      if (rest) {
        let t = 12;
        while (!(rest & (1 << t))) t--;
        packed |= t;
        rest &= ~(1 << t);
      }
    }
    TOP5[m] = packed;
  }
})();

/** Resolves the hand value from the multiplicity masks and per-suit masks. */
function resolve(m1: number, m2: number, m3: number, m4: number, s0: number, s1: number, s2: number, s3: number): number {
  let flush = 0;
  if (POPCOUNT[s0]! >= 5) flush = s0;
  else if (POPCOUNT[s1]! >= 5) flush = s1;
  else if (POPCOUNT[s2]! >= 5) flush = s2;
  else if (POPCOUNT[s3]! >= 5) flush = s3;

  if (flush) {
    const sf = STRAIGHT_TOP[flush]!;
    if (sf >= 0) return 8 * SHIFT + (sf << 16);
  }
  if (m4) {
    const q = TOP_BIT[m4]!;
    return 7 * SHIFT + (q << 16) + (TOP_BIT[m1 & ~(1 << q)]! << 12);
  }
  if (m3) {
    const t = TOP_BIT[m3]!;
    const pairs = m2 & ~(1 << t);
    if (pairs) return 6 * SHIFT + (t << 16) + (TOP_BIT[pairs]! << 12);
  }
  if (flush) return 5 * SHIFT + TOP5[flush]!;
  const st = STRAIGHT_TOP[m1]!;
  if (st >= 0) return 4 * SHIFT + (st << 16);
  if (m3) {
    const t = TOP_BIT[m3]!;
    return 3 * SHIFT + (t << 16) + ((TOP5[m1 & ~(1 << t)]! >> 12) << 8);
  }
  if (m2) {
    const p1 = TOP_BIT[m2]!;
    const rest = m2 & ~(1 << p1);
    if (rest) {
      const p2 = TOP_BIT[rest]!;
      return 2 * SHIFT + (p1 << 16) + (p2 << 12) + (TOP_BIT[m1 & ~(1 << p1) & ~(1 << p2)]! << 8);
    }
    return 1 * SHIFT + (p1 << 16) + ((TOP5[m1 & ~(1 << p1)]! >> 8) << 4);
  }
  return TOP5[m1]!;
}

/** Evaluates 5..7 card indices (no duplicates). Hot path: no allocation. */
export function evaluateIndices(cards: ArrayLike<number>, count: number = cards.length): number {
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  for (let i = 0; i < count; i++) {
    const c = cards[i]!;
    const b = 1 << (c >> 2);
    switch (c & 3) {
      case 0:
        s0 |= b;
        break;
      case 1:
        s1 |= b;
        break;
      case 2:
        s2 |= b;
        break;
      default:
        s3 |= b;
    }
    if (m3 & b) m4 |= b;
    else if (m2 & b) m3 |= b;
    else if (m1 & b) m2 |= b;
    else m1 |= b;
  }
  return resolve(m1, m2, m3, m4, s0, s1, s2, s3);
}

/** Evaluates exactly five card indices (used by Omaha). */
export function evaluate5(a: number, b: number, c: number, d: number, e: number): number {
  const ba = 1 << (a >> 2);
  const bb = 1 << (b >> 2);
  const bc = 1 << (c >> 2);
  const bd = 1 << (d >> 2);
  const be = 1 << (e >> 2);
  const m1 = ba | bb | bc | bd | be;
  const suit = a & 3;
  if ((b & 3) === suit && (c & 3) === suit && (d & 3) === suit && (e & 3) === suit) {
    // Five suited cards always have five distinct ranks.
    return resolve(m1, 0, 0, 0, m1, 0, 0, 0);
  }
  if (POPCOUNT[m1] === 5) return resolve(m1, 0, 0, 0, 0, 0, 0, 0);
  // Paired hand: count multiplicities (seen -> m2 -> m3 -> m4), unrolled.
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let seen = ba;
  if (seen & bb) m2 |= bb;
  else seen |= bb;
  if (m2 & bc) m3 |= bc;
  else if (seen & bc) m2 |= bc;
  else seen |= bc;
  if (m3 & bd) m4 |= bd;
  else if (m2 & bd) m3 |= bd;
  else if (seen & bd) m2 |= bd;
  else seen |= bd;
  if (m3 & be) m4 |= be;
  else if (m2 & be) m3 |= be;
  else if (seen & be) m2 |= be;
  else seen |= be;
  return resolve(m1, m2, m3, m4, 0, 0, 0, 0);
}

const SCRATCH7 = new Int32Array(7);

/** Evaluates exactly seven card indices. */
export function evaluate7(a: number, b: number, c: number, d: number, e: number, f: number, g: number): number {
  SCRATCH7[0] = a;
  SCRATCH7[1] = b;
  SCRATCH7[2] = c;
  SCRATCH7[3] = d;
  SCRATCH7[4] = e;
  SCRATCH7[5] = f;
  SCRATCH7[6] = g;
  return evaluateIndices(SCRATCH7, 7);
}

export function categoryOf(value: number): HandCategory {
  return Math.floor(value / SHIFT) as HandCategory;
}

/** The deciding rank indices encoded in a value (most significant first; length depends on category). */
export function decodeRanks(value: number): number[] {
  const cat = categoryOf(value);
  const r = [(value >> 16) & 15, (value >> 12) & 15, (value >> 8) & 15, (value >> 4) & 15, value & 15];
  switch (cat) {
    case HandCategory.STRAIGHT_FLUSH:
    case HandCategory.STRAIGHT:
      return [r[0]!];
    case HandCategory.FOUR_OF_A_KIND:
    case HandCategory.FULL_HOUSE:
      return [r[0]!, r[1]!];
    case HandCategory.THREE_OF_A_KIND:
      return [r[0]!, r[1]!, r[2]!];
    case HandCategory.TWO_PAIR:
      return [r[0]!, r[1]!, r[2]!];
    case HandCategory.PAIR:
      return [r[0]!, r[1]!, r[2]!, r[3]!];
    default:
      return r;
  }
}

// ---- Names ------------------------------------------------------------------------------------
const RANK_NAMES = ["Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King", "Ace"];
const RANK_PLURALS = ["Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights", "Nines", "Tens", "Jacks", "Queens", "Kings", "Aces"];

const one = (r: number) => RANK_NAMES[r]!;
const many = (r: number) => RANK_PLURALS[r]!;

/** Short human name, e.g. "Full House, Kings full of Sevens", "Two Pair, Kings and Sevens". */
export function handName(value: number): string {
  const cat = categoryOf(value);
  const r = decodeRanks(value);
  switch (cat) {
    case HandCategory.STRAIGHT_FLUSH:
      return r[0] === 12 ? "Royal Flush" : `Straight Flush, ${one(r[0]!)} high`;
    case HandCategory.FOUR_OF_A_KIND:
      return `Four of a Kind, ${many(r[0]!)}`;
    case HandCategory.FULL_HOUSE:
      return `Full House, ${many(r[0]!)} full of ${many(r[1]!)}`;
    case HandCategory.FLUSH:
      return `Flush, ${one(r[0]!)} high`;
    case HandCategory.STRAIGHT:
      return `Straight, ${one(r[0]!)} high`;
    case HandCategory.THREE_OF_A_KIND:
      return `Three of a Kind, ${many(r[0]!)}`;
    case HandCategory.TWO_PAIR:
      return `Two Pair, ${many(r[0]!)} and ${many(r[1]!)}`;
    case HandCategory.PAIR:
      return `Pair of ${many(r[0]!)}`;
    default:
      return `High Card, ${one(r[0]!)}`;
  }
}

/** Longer description including kickers, e.g. "Pair of Aces, King-Queen-Nine kickers". */
export function handDescription(value: number): string {
  const cat = categoryOf(value);
  const r = decodeRanks(value);
  const list = (ranks: number[]) => ranks.map(one).join("-");
  switch (cat) {
    case HandCategory.FOUR_OF_A_KIND:
      return `${handName(value)}, ${one(r[1]!)} kicker`;
    case HandCategory.FLUSH:
      return `Flush, ${list(r)}`;
    case HandCategory.THREE_OF_A_KIND:
      return `${handName(value)}, ${list(r.slice(1))} kickers`;
    case HandCategory.TWO_PAIR:
      return `${handName(value)}, ${one(r[2]!)} kicker`;
    case HandCategory.PAIR:
      return `${handName(value)}, ${list(r.slice(1))} kickers`;
    case HandCategory.HIGH_CARD:
      return `High Card, ${list(r)}`;
    default:
      return handName(value);
  }
}

// ---- Best five cards ----------------------------------------------------------------------------

/** Picks the five cards (from `cards`) that make `value`, in display order (most significant first). */
export function bestFiveIndices(cards: readonly number[], value: number): number[] {
  const cat = categoryOf(value);
  const r = decodeRanks(value);
  let needed: number[];
  let suit = -1;
  if (cat === HandCategory.FLUSH || cat === HandCategory.STRAIGHT_FLUSH) {
    const counts = [0, 0, 0, 0];
    for (const c of cards) counts[c & 3]!++;
    suit = counts.findIndex((n) => n >= 5);
  }
  const straightRanks = (top: number) => (top === 3 ? [3, 2, 1, 0, 12] : [top, top - 1, top - 2, top - 3, top - 4]);
  switch (cat) {
    case HandCategory.STRAIGHT_FLUSH:
    case HandCategory.STRAIGHT:
      needed = straightRanks(r[0]!);
      break;
    case HandCategory.FOUR_OF_A_KIND:
      needed = [r[0]!, r[0]!, r[0]!, r[0]!, r[1]!];
      break;
    case HandCategory.FULL_HOUSE:
      needed = [r[0]!, r[0]!, r[0]!, r[1]!, r[1]!];
      break;
    case HandCategory.THREE_OF_A_KIND:
      needed = [r[0]!, r[0]!, r[0]!, r[1]!, r[2]!];
      break;
    case HandCategory.TWO_PAIR:
      needed = [r[0]!, r[0]!, r[1]!, r[1]!, r[2]!];
      break;
    case HandCategory.PAIR:
      needed = [r[0]!, r[0]!, r[1]!, r[2]!, r[3]!];
      break;
    default:
      needed = r;
  }
  const pool = cards.filter((c) => suit < 0 || (c & 3) === suit).sort((x, y) => y - x);
  const out: number[] = [];
  for (const rank of needed) {
    const idx = pool.findIndex((c) => c >> 2 === rank);
    if (idx < 0) throw new Error(`bestFive: rank ${rank} missing (value ${value})`);
    out.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return out;
}

// ---- Public card-string API ---------------------------------------------------------------------

export type HandResult = {
  value: number; // comparable: higher is better, equal values tie
  category: HandCategory;
  categoryName: HandCategoryName;
  name: string; // "Full House, Kings full of Sevens"
  description: string; // includes kickers
  bestFive: Card[];
};

export function describeValue(value: number, bestFive: Card[]): HandResult {
  const category = categoryOf(value);
  return {
    value,
    category,
    categoryName: CATEGORY_NAMES[category]!,
    name: handName(value),
    description: handDescription(value),
    bestFive,
  };
}

/** Best five-card hand from 5, 6 or 7 cards (Hold'em: any combination of hole and board). */
export function evaluateHand(cards: readonly Card[]): HandResult {
  if (cards.length < 5 || cards.length > 7) {
    throw new EngineError("INVALID_HAND_SIZE", `Expected 5-7 cards, got ${cards.length}`);
  }
  const idx = cards.map(cardToIndex);
  if (new Set(idx).size !== idx.length) throw new EngineError("DUPLICATE_CARD", "Duplicate card in hand");
  const value = evaluateIndices(idx);
  return describeValue(value, bestFiveIndices(idx, value).map(indexToCard));
}

/** Compares two hand values or results: positive when a wins, negative when b wins, 0 on a tie. */
export function compareHands(a: number | HandResult, b: number | HandResult): number {
  const va = typeof a === "number" ? a : a.value;
  const vb = typeof b === "number" ? b : b.value;
  return va - vb;
}
