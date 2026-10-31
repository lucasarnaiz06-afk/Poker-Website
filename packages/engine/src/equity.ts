// Equity calculation: exact enumeration of the remaining board when cheap, Monte Carlo otherwise.
import { cardToIndex, mathRandomInt, type Card, type RandomInt } from "./cards";
import { EngineError } from "./errors";
import { evaluateIndices } from "./evaluator";
import { evaluateOmahaIndices } from "./omaha";
import type { Variant } from "./types";

export type EquityInput = {
  hands: readonly (readonly Card[])[]; // known hole cards per player (2 for NLHE, 4 for PLO)
  board?: readonly Card[]; // 0, 3, 4 or 5 cards
  dead?: readonly Card[]; // known cards out of play (mucked, burned and shown, ...)
  variant: Variant;
  iterations?: number; // Monte Carlo iterations (default 20,000)
  randomInt?: RandomInt; // defaults to Math.random (fine for equity, never for dealing)
  /** Enumerate exactly when (board combinations x hands x evaluation cost) is at most this (default 4,000,000). */
  maxExactEvaluations?: number;
};

export type HandEquity = {
  win: number; // fraction of runouts this hand wins outright
  tie: number; // fraction of runouts this hand splits
  equity: number; // win + split shares (sums to 1 over all hands)
};

export type EquityResult = {
  exact: boolean;
  samples: number; // boards enumerated or simulated
  results: HandEquity[];
};

export const DEFAULT_EQUITY_ITERATIONS = 20_000;
export const DEFAULT_MAX_EXACT_EVALUATIONS = 4_000_000;

export function holeCardCount(variant: Variant): number {
  return variant === "PLO" ? 4 : 2;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Evaluates each hand on a complete 5-card board, writes values into `out`. */
type Evaluator = (board: Int32Array, out: Float64Array) => void;

function makeEvaluator(variant: Variant, holes: Int32Array[]): Evaluator {
  if (variant === "PLO") {
    return (board, out) => {
      for (let i = 0; i < holes.length; i++) out[i] = evaluateOmahaIndices(holes[i]!, board);
    };
  }
  const scratch = new Int32Array(7);
  return (board, out) => {
    scratch[2] = board[0]!;
    scratch[3] = board[1]!;
    scratch[4] = board[2]!;
    scratch[5] = board[3]!;
    scratch[6] = board[4]!;
    for (let i = 0; i < holes.length; i++) {
      const h = holes[i]!;
      scratch[0] = h[0]!;
      scratch[1] = h[1]!;
      out[i] = evaluateIndices(scratch, 7);
    }
  };
}

class Tally {
  readonly wins: Float64Array;
  readonly ties: Float64Array;
  readonly shares: Float64Array;
  samples = 0;
  private readonly values: Float64Array;

  constructor(readonly n: number) {
    this.wins = new Float64Array(n);
    this.ties = new Float64Array(n);
    this.shares = new Float64Array(n);
    this.values = new Float64Array(n);
  }

  record(evaluate: Evaluator, board: Int32Array): void {
    const v = this.values;
    evaluate(board, v);
    let best = -1;
    let count = 0;
    for (let i = 0; i < this.n; i++) {
      if (v[i]! > best) {
        best = v[i]!;
        count = 1;
      } else if (v[i] === best) count++;
    }
    for (let i = 0; i < this.n; i++) {
      if (v[i] !== best) continue;
      if (count === 1) this.wins[i]!++;
      else this.ties[i]!++;
      this.shares[i]! += 1 / count;
    }
    this.samples++;
  }

  result(exact: boolean): EquityResult {
    const s = this.samples || 1;
    const results: HandEquity[] = [];
    for (let i = 0; i < this.n; i++) {
      results.push({ win: this.wins[i]! / s, tie: this.ties[i]! / s, equity: this.shares[i]! / s });
    }
    return { exact, samples: this.samples, results };
  }
}

function validate(input: EquityInput): { holes: Int32Array[]; board: number[]; remaining: number[] } {
  const need = holeCardCount(input.variant);
  if (input.hands.length < 1) throw new EngineError("INVALID_CONFIG", "At least one hand is required");
  const board = (input.board ?? []).map(cardToIndex);
  if (![0, 3, 4, 5].includes(board.length)) throw new EngineError("INVALID_CONFIG", "Board must have 0, 3, 4 or 5 cards");
  const used = new Set<number>(board);
  let total = board.length;
  const holes = input.hands.map((hand) => {
    if (hand.length !== need) {
      throw new EngineError("INVALID_HAND_SIZE", `${input.variant} hands need ${need} cards, got ${hand.length}`);
    }
    const idx = hand.map(cardToIndex);
    idx.forEach((c) => used.add(c));
    total += idx.length;
    return Int32Array.from(idx);
  });
  for (const c of input.dead ?? []) {
    used.add(cardToIndex(c));
    total++;
  }
  if (used.size !== total) throw new EngineError("DUPLICATE_CARD", "Duplicate card in equity input");
  const remaining: number[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) remaining.push(c);
  if (remaining.length < 5 - board.length) throw new EngineError("DECK_EXHAUSTED", "Not enough cards left");
  return { holes, board, remaining };
}

/** Win/tie/equity for each hand. Exact enumeration when cheap, else Monte Carlo. */
export function calculateEquity(input: EquityInput): EquityResult {
  const { holes, board, remaining } = validate(input);
  const k = 5 - board.length;
  const tally = new Tally(holes.length);
  const evaluate = makeEvaluator(input.variant, holes);
  const full = new Int32Array(5);
  board.forEach((c, i) => {
    full[i] = c;
  });

  const combos = binomial(remaining.length, k);
  const cost = combos * holes.length * (input.variant === "PLO" ? 60 : 1);
  const maxExact = input.maxExactEvaluations ?? DEFAULT_MAX_EXACT_EVALUATIONS;
  if (cost <= maxExact) {
    const n = remaining.length;
    const base = board.length;
    // Iterative k-combination enumeration.
    const pick = new Int32Array(k);
    for (let i = 0; i < k; i++) pick[i] = i;
    if (k === 0) {
      tally.record(evaluate, full);
      return tally.result(true);
    }
    for (;;) {
      for (let i = 0; i < k; i++) full[base + i] = remaining[pick[i]!]!;
      tally.record(evaluate, full);
      let i = k - 1;
      while (i >= 0 && pick[i] === n - k + i) i--;
      if (i < 0) break;
      pick[i]!++;
      for (let j = i + 1; j < k; j++) pick[j] = pick[j - 1]! + 1;
    }
    return tally.result(true);
  }

  const iterations = Math.max(1, Math.floor(input.iterations ?? DEFAULT_EQUITY_ITERATIONS));
  const randomInt = input.randomInt ?? mathRandomInt;
  const pool = Int32Array.from(remaining);
  for (let it = 0; it < iterations; it++) {
    // Partial Fisher-Yates: draw k distinct cards into the front of the pool.
    for (let i = 0; i < k; i++) {
      const j = i + randomInt(pool.length - i);
      const t = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = t;
      full[board.length + i] = pool[i]!;
    }
    tally.record(evaluate, full);
  }
  return tally.result(false);
}

export type RangeEquityInput = {
  ranges: readonly (readonly (readonly Card[])[])[]; // per player: list of possible hole-card combos
  board?: readonly Card[];
  dead?: readonly Card[];
  variant: Variant;
  iterations?: number;
  randomInt?: RandomInt;
};

/**
 * Monte Carlo range-vs-range equity. Each iteration draws one combo per player uniformly (redrawing on card
 * conflicts) and a random completion of the board.
 */
export function calculateRangeEquity(input: RangeEquityInput): EquityResult {
  const need = holeCardCount(input.variant);
  const board = (input.board ?? []).map(cardToIndex);
  const dead = new Set<number>([...board, ...(input.dead ?? []).map(cardToIndex)]);
  if (dead.size !== board.length + (input.dead ?? []).length) throw new EngineError("DUPLICATE_CARD", "Duplicate card");
  const ranges = input.ranges.map((range, p) => {
    const combos = range
      .map((combo) => {
        if (combo.length !== need) throw new EngineError("INVALID_HAND_SIZE", `Range ${p} has a combo of ${combo.length} cards`);
        return Int32Array.from(combo.map(cardToIndex));
      })
      .filter((combo) => !Array.from(combo).some((c) => dead.has(c)));
    if (combos.length === 0) throw new EngineError("INVALID_RANGE", `Range ${p} is empty after removing dead cards`);
    return combos;
  });
  const iterations = Math.max(1, Math.floor(input.iterations ?? DEFAULT_EQUITY_ITERATIONS));
  const randomInt = input.randomInt ?? mathRandomInt;
  const holes = ranges.map(() => new Int32Array(need));
  const evaluate = makeEvaluator(input.variant, holes);
  const tally = new Tally(ranges.length);
  const full = new Int32Array(5);
  board.forEach((c, i) => {
    full[i] = c;
  });
  const used = new Uint8Array(52);
  const k = 5 - board.length;
  let attempts = 0;
  while (tally.samples < iterations) {
    if (++attempts > iterations * 200) throw new EngineError("INVALID_RANGE", "Ranges conflict too often to sample");
    used.fill(0);
    for (const c of dead) used[c] = 1;
    let ok = true;
    for (let p = 0; p < ranges.length && ok; p++) {
      const range = ranges[p]!;
      const combo = range[randomInt(range.length)]!;
      for (const c of combo) if (used[c]) ok = false;
      if (!ok) break;
      for (let i = 0; i < need; i++) {
        used[combo[i]!] = 1;
        holes[p]![i] = combo[i]!;
      }
    }
    if (!ok) continue;
    for (let i = 0; i < k; i++) {
      let c: number;
      do c = randomInt(52);
      while (used[c]);
      used[c] = 1;
      full[board.length + i] = c;
    }
    tally.record(evaluate, full);
  }
  return tally.result(false);
}
