// Cards, decks and shuffling. Cards are two-character string codes ("As", "Td", "2c").
// Internally the evaluator works on card indices 0..51: index = rankIndex * 4 + suitIndex,
// rankIndex 0 = deuce .. 12 = ace, suitIndex 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades.
import { EngineError } from "./errors";

export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const SUITS = ["c", "d", "h", "s"] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
export type Card = `${Rank}${Suit}`;

/** Returns an integer in [0, maxExclusive). The server passes crypto.randomInt. */
export type RandomInt = (maxExclusive: number) => number;

const RANK_INDEX: Record<string, number> = {};
RANKS.forEach((r, i) => {
  RANK_INDEX[r] = i;
});
const SUIT_INDEX: Record<string, number> = { c: 0, d: 1, h: 2, s: 3 };

const INDEX_TO_CARD: Card[] = [];
for (let r = 0; r < 13; r++) {
  for (let s = 0; s < 4; s++) {
    INDEX_TO_CARD.push(`${RANKS[r]!}${SUITS[s]!}` as Card);
  }
}
const CARD_TO_INDEX = new Map<string, number>(INDEX_TO_CARD.map((c, i) => [c, i]));

export function isCard(value: unknown): value is Card {
  return typeof value === "string" && CARD_TO_INDEX.has(value);
}

/** Parses a card code; accepts lowercase ranks ("ah") and "10" for ten ("10h"). */
export function parseCard(code: string): Card {
  let raw = code.trim();
  if (raw.length === 3 && raw.startsWith("10")) raw = `T${raw[2]}`;
  if (raw.length !== 2) throw new EngineError("INVALID_CARD", `Invalid card: ${code}`);
  const normalized = `${raw[0]!.toUpperCase()}${raw[1]!.toLowerCase()}`;
  if (!CARD_TO_INDEX.has(normalized)) throw new EngineError("INVALID_CARD", `Invalid card: ${code}`);
  return normalized as Card;
}

/** Parses "AsKd", "As Kd" or "As,Kd" into cards. */
export function parseCards(text: string): Card[] {
  const compact = text.replace(/[\s,]+/g, "");
  if (compact.length % 2 !== 0) throw new EngineError("INVALID_CARD", `Invalid cards: ${text}`);
  const out: Card[] = [];
  for (let i = 0; i < compact.length; i += 2) out.push(parseCard(compact.slice(i, i + 2)));
  return out;
}

export function cardToIndex(card: Card | string): number {
  const idx = CARD_TO_INDEX.get(card);
  if (idx === undefined) throw new EngineError("INVALID_CARD", `Invalid card: ${card}`);
  return idx;
}

export function indexToCard(index: number): Card {
  const card = INDEX_TO_CARD[index];
  if (card === undefined) throw new EngineError("INVALID_CARD", `Invalid card index: ${index}`);
  return card;
}

export function cardRank(card: Card): Rank {
  return card[0] as Rank;
}

export function cardSuit(card: Card): Suit {
  return card[1] as Suit;
}

export function rankIndex(rank: Rank | string): number {
  const idx = RANK_INDEX[rank];
  if (idx === undefined) throw new EngineError("INVALID_CARD", `Invalid rank: ${rank}`);
  return idx;
}

export function suitIndex(suit: Suit | string): number {
  const idx = SUIT_INDEX[suit];
  if (idx === undefined) throw new EngineError("INVALID_CARD", `Invalid suit: ${suit}`);
  return idx;
}

/** Card as the wire type PublicCard ({ rank, suit }). */
export function toPublicCard(card: Card): { rank: Rank; suit: Suit } {
  return { rank: cardRank(card), suit: cardSuit(card) };
}

/** A fresh ordered 52-card deck (2c, 2d, 2h, 2s, 3c, ... As). */
export function createDeck(): Card[] {
  return INDEX_TO_CARD.slice();
}

/** Math.random based RandomInt: fine for equity simulations, never for dealing real hands. */
export const mathRandomInt: RandomInt = (maxExclusive) => Math.floor(Math.random() * maxExclusive);

function checkedRandom(randomInt: RandomInt, maxExclusive: number): number {
  const value = randomInt(maxExclusive);
  if (!Number.isInteger(value) || value < 0 || value >= maxExclusive) {
    throw new EngineError("BAD_RANDOM", `randomInt(${maxExclusive}) returned ${value}`);
  }
  return value;
}

/** In-place Fisher-Yates shuffle with an injected uniform integer source. Returns the same array. */
export function shuffleInPlace<T>(items: T[], randomInt: RandomInt): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = checkedRandom(randomInt, i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/** A new shuffled 52-card deck. */
export function shuffledDeck(randomInt: RandomInt): Card[] {
  return shuffleInPlace(createDeck(), randomInt);
}

export function assertUniqueCards(cards: readonly string[]): void {
  const seen = new Set<string>();
  for (const card of cards) {
    if (!CARD_TO_INDEX.has(card)) throw new EngineError("INVALID_CARD", `Invalid card: ${card}`);
    if (seen.has(card)) throw new EngineError("DUPLICATE_CARD", `Duplicate card: ${card}`);
    seen.add(card);
  }
}

/**
 * Validates an injected deck (tests / replays). It must be a permutation of all 52 cards, or a prefix
 * of distinct cards when `allowPartial` is set (remaining cards are appended in a fixed order).
 */
export function normalizeDeck(deck: readonly string[], allowPartial = false): Card[] {
  assertUniqueCards(deck);
  const cards = deck.map((c) => c as Card);
  if (cards.length === 52) return cards;
  if (!allowPartial) throw new EngineError("INVALID_DECK", "Deck must contain all 52 cards");
  const used = new Set<string>(cards);
  for (const card of INDEX_TO_CARD) if (!used.has(card)) cards.push(card);
  return cards;
}
