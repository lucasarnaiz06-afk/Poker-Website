// Simple bot policies that play complete hands with the engine. Used by the dev seed script and tests to
// produce realistic hand histories. Deterministic for a given random source.
import {
  evaluateHand,
  HandCategory,
  PokerHand,
  shuffledDeck,
  type Card,
  type HandEvent,
  type HandSummary,
  type LegalActions,
  type PlayerAction,
  type RandomInt,
  type StartHandConfig,
} from "@poker-platform/engine";
import { classCombos, gridLabels, handClass } from "../stats/hand-class";

export type BotStyle = {
  /** Fraction of hands played preflop (0..1). */
  looseness: number;
  /** Probability of raising instead of calling (0..1). */
  aggression: number;
  /** Probability of bluffing / calling light postflop (0..1). */
  bluff: number;
};

export const BOT_STYLES: Record<string, BotStyle> = {
  rock: { looseness: 0.14, aggression: 0.55, bluff: 0.05 },
  tag: { looseness: 0.24, aggression: 0.7, bluff: 0.15 },
  lag: { looseness: 0.38, aggression: 0.75, bluff: 0.3 },
  station: { looseness: 0.5, aggression: 0.15, bluff: 0.45 },
  maniac: { looseness: 0.65, aggression: 0.85, bluff: 0.5 },
};

/** Mulberry32 seeded generator -> RandomInt. */
export function seededRandom(seed: number): { next: () => number; randomInt: RandomInt } {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, randomInt: (max) => Math.floor(next() * max) };
}

const RANK_VALUE: Record<string, number> = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };

/** Preflop strength percentile in [0, 1] (rough Chen-style score; 1 = AA). */
export function preflopStrength(cards: readonly string[]): number {
  if (cards.length !== 2) {
    // PLO: pairs and high cards.
    const values = cards.map((c) => RANK_VALUE[c[0]!]!).sort((x, y) => y - x);
    const pairs = new Set(values).size < values.length ? 0.2 : 0;
    const suited = new Set(cards.map((c) => c[1])).size <= 2 ? 0.1 : 0;
    return Math.min(1, (values[0]! + values[1]!) / 28 / 1.4 + pairs + suited);
  }
  const [a, b] = cards.map((c) => RANK_VALUE[c[0]!]!).sort((x, y) => y - x) as [number, number];
  const suited = cards[0]![1] === cards[1]![1];
  let score = a >= 14 ? 10 : a === 13 ? 8 : a === 12 ? 7 : a === 11 ? 6 : a / 2;
  if (a === b) score = Math.max(5, score * 2);
  if (suited) score += 2;
  const gap = a - b - 1;
  if (a !== b) score -= gap <= 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (a !== b && gap <= 1 && a < 12) score += 1;
  return Math.max(0, Math.min(1, (score + 1) / 21));
}

function postflopStrength(hole: readonly string[], board: readonly string[]): number {
  if (board.length < 3) return preflopStrength(hole);
  const cards = [...hole.slice(0, 2), ...board] as Card[];
  const result = evaluateHand(cards);
  switch (result.category) {
    case HandCategory.HIGH_CARD:
      return 0.1;
    case HandCategory.PAIR:
      return 0.45;
    case HandCategory.TWO_PAIR:
      return 0.7;
    case HandCategory.THREE_OF_A_KIND:
      return 0.8;
    default:
      return 0.92;
  }
}

function sizedBet(legal: LegalActions, fraction: number): number {
  const target = Math.round(legal.minTo + (legal.potTo - legal.minTo) * fraction);
  return Math.max(legal.minTo, Math.min(legal.maxTo, target));
}

let percentiles: Map<string, number> | null = null;

/** Share of starting hands (by combos) that are weaker than this one, in [0, 1]. Hold'em only. */
export function preflopPercentile(cards: readonly string[]): number {
  const cls = handClass(cards);
  if (!cls) return preflopStrength(cards);
  if (!percentiles) {
    const classes = gridLabels().map((label) => {
      const a = label[0]!;
      const b = label[1]!;
      const sample = label.length === 2 ? [`${a}c`, `${b}d`] : label.endsWith("s") ? [`${a}c`, `${b}c`] : [`${a}c`, `${b}d`];
      return { label, strength: preflopStrength(sample), combos: classCombos(label) };
    });
    classes.sort((x, y) => x.strength - y.strength);
    percentiles = new Map();
    let below = 0;
    for (const c of classes) {
      percentiles.set(c.label, below / 1326);
      below += c.combos;
    }
  }
  return percentiles.get(cls) ?? 0;
}

export function botDecision(input: {
  legal: LegalActions;
  style: BotStyle;
  hole: readonly string[];
  board: readonly string[];
  preflop: boolean;
  next: () => number;
}): PlayerAction {
  const { legal, style, next } = input;
  const r = next();
  const facing = legal.callAmount;
  // maxTo approximates the effective stack; potTo the pot.
  const bigCall = facing > 0.3 * legal.maxTo;
  const fold: PlayerAction = { type: "fold" };
  const passive: PlayerAction = legal.canCheck ? { type: "check" } : fold;

  if (input.preflop) {
    const pct = preflopPercentile(input.hole);
    const strong = pct >= 0.93;
    const playable = pct >= 1 - style.looseness;
    if (legal.canBetOrRaise && (strong || (playable && r < style.aggression * 0.5 && !bigCall))) {
      const amount = sizedBet(legal, strong && next() < 0.15 ? 1 : 0.1 + next() * 0.25);
      if (amount >= legal.maxTo && !strong) return facing > 0 && playable && !bigCall ? { type: "call" } : passive;
      return { type: legal.isBet ? "bet" : "raise", amount };
    }
    if (legal.canCheck) return { type: "check" };
    if (bigCall && !strong && !(pct >= 0.85 && r < 0.5)) return fold;
    if (playable || facing <= Math.max(1, legal.potTo * 0.1) * (style.bluff + 0.3)) return { type: "call" };
    return fold;
  }

  const s = postflopStrength(input.hole, input.board);
  if (facing === 0) {
    const value = s >= 0.45 && r < 0.45 + style.aggression * 0.45;
    const bluff = s < 0.45 && r < 0.12 + style.bluff * 0.5;
    if (legal.canBetOrRaise && (value || bluff)) {
      const amount = sizedBet(legal, 0.3 + next() * 0.5);
      if (amount >= legal.maxTo && s < 0.7) return passive;
      return { type: "bet", amount };
    }
    return passive;
  }
  if (s >= 0.7 && legal.canBetOrRaise && r < style.aggression * 0.6) {
    return { type: "raise", amount: sizedBet(legal, 0.4 + next() * 0.6) };
  }
  if (s >= 0.7) return { type: "call" };
  const potOdds = facing / Math.max(1, legal.potTo);
  if (s >= 0.45) return potOdds > 0.5 && r > style.bluff + 0.3 ? fold : { type: "call" };
  if (r < style.bluff * 0.2 && !bigCall) return { type: "call" };
  return fold;
}

export type BotHandResult = {
  summary: HandSummary;
  events: HandEvent[];
  deck: string[];
  /** Players (not forced to show) who showed anyway. */
  voluntaryShows: string[];
};

export function playBotHand(
  config: StartHandConfig,
  styles: ReadonlyMap<string, BotStyle>,
  rng: { next: () => number; randomInt: RandomInt },
  options: { runItTwiceChance?: number } = {},
): BotHandResult {
  const deck = shuffledDeck(rng.randomInt);
  const hand = PokerHand.start(config, { deck });
  let guard = 0;
  while (!hand.isComplete) {
    if (++guard > 500) throw new Error("Bot hand did not finish");
    if (hand.status === "RUNOUT_DECISION") {
      hand.chooseRunout(rng.next() < (options.runItTwiceChance ?? 0.5) ? 2 : 1);
      continue;
    }
    const id = hand.toActPlayerId!;
    const legal = hand.legalActions(id)!;
    const player = hand.getPlayer(id)!;
    const action = botDecision({
      legal,
      style: styles.get(id) ?? BOT_STYLES.tag!,
      hole: player.holeCards,
      board: hand.boards[0] ?? [],
      preflop: hand.street === "PREFLOP",
      next: rng.next,
    });
    try {
      hand.act(id, action);
    } catch {
      hand.act(id, legal.canCheck ? { type: "check" } : { type: "fold" });
    }
  }
  const summary = hand.summary!;
  const voluntaryShows = summary.players.filter((p) => p.wentToShowdown && !p.mustShow && rng.next() < 0.3).map((p) => p.id);
  return { summary, events: hand.events, deck, voluntaryShows };
}
