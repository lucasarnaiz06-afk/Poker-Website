import { randomInt as cryptoRandomInt } from "node:crypto";

export const CARD_RANKS = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
  "A",
] as const;

export const CARD_SUITS = ["c", "d", "h", "s"] as const;

export type CardRank = (typeof CARD_RANKS)[number];
export type CardSuit = (typeof CARD_SUITS)[number];

export type Card = {
  rank: CardRank;
  suit: CardSuit;
};

export type RandomInt = (maxExclusive: number) => number;

function isCardRank(value: string): value is CardRank {
  return (CARD_RANKS as readonly string[]).includes(value);
}

function isCardSuit(value: string): value is CardSuit {
  return (CARD_SUITS as readonly string[]).includes(value);
}

export function createDeck() {
  const deck: Card[] = [];

  for (const suit of CARD_SUITS) {
    for (const rank of CARD_RANKS) {
      deck.push({ rank, suit });
    }
  }

  return deck;
}

export function secureRandomInt(maxExclusive: number) {
  return cryptoRandomInt(maxExclusive);
}

export function shuffleDeck(
  deck: readonly Card[] = createDeck(),
  randomInt: RandomInt = secureRandomInt,
) {
  const shuffled = deck.map((card) => ({ ...card }));

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);

    if (
      !Number.isInteger(swapIndex) ||
      swapIndex < 0 ||
      swapIndex > index
    ) {
      throw new Error("Random integer generator returned an invalid index.");
    }

    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

export function cardToNotation(card: Card) {
  return `${card.rank}${card.suit}`;
}

export function parseCardNotation(rawCard: string): Card {
  const normalizedCard = rawCard.trim();
  const rawRank = normalizedCard.slice(0, -1).toUpperCase();
  const rank = rawRank === "10" ? "T" : rawRank;
  const suit = normalizedCard.slice(-1).toLowerCase();

  if (!isCardRank(rank) || !isCardSuit(suit)) {
    throw new Error(`Invalid card notation: ${rawCard}`);
  }

  return { rank, suit };
}

export function assertUniqueCards(cards: readonly Card[]) {
  const seenCards = new Set<string>();

  for (const card of cards) {
    const notation = cardToNotation(card);

    if (seenCards.has(notation)) {
      throw new Error(`Duplicate card in deck: ${notation}`);
    }

    seenCards.add(notation);
  }
}
