import pokerSolver, { type SolvedPokerHand } from "pokersolver";
import { cardToNotation, type Card } from "./cards";

const { Hand } = pokerSolver;

export type EvaluatedHand = {
  playerId: string;
  name: string;
  description: string;
  rank: number;
  solverHand: SolvedPokerHand;
};

const RANK_NAMES: Record<string, string> = {
  "2": "Twos",
  "3": "Threes",
  "4": "Fours",
  "5": "Fives",
  "6": "Sixes",
  "7": "Sevens",
  "8": "Eights",
  "9": "Nines",
  T: "Tens",
  J: "Jacks",
  Q: "Queens",
  K: "Kings",
  A: "Aces",
};

const HIGH_CARD_NAMES: Record<string, string> = {
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  T: "Ten",
  J: "Jack",
  Q: "Queen",
  K: "King",
  A: "Ace",
};

function rankName(value?: string) {
  return value ? (RANK_NAMES[value] ?? value) : "";
}

function highCardName(value?: string) {
  return value ? (HIGH_CARD_NAMES[value] ?? value) : "";
}

function valueCounts(hand: SolvedPokerHand) {
  const counts = new Map<string, number>();

  for (const card of hand.cards) {
    counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  }

  return counts;
}

function valuesByCount(hand: SolvedPokerHand, count: number) {
  const counts = valueCounts(hand);

  return hand.cards
    .filter((card) => counts.get(card.value) === count)
    .map((card) => card.value)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function kickerValue(hand: SolvedPokerHand, excludedValues: readonly string[]) {
  return hand.cards.find((card) => !excludedValues.includes(card.value))?.value;
}

function describeSolvedHand(hand: SolvedPokerHand) {
  if (hand.name === "Pair") {
    const pairValue = valuesByCount(hand, 2)[0];
    const kicker = kickerValue(hand, pairValue ? [pairValue] : []);

    return kicker
      ? `Pair of ${rankName(pairValue)}, ${highCardName(kicker)} Kicker`
      : `Pair of ${rankName(pairValue)}`;
  }

  if (hand.name === "Two Pair") {
    const pairValues = valuesByCount(hand, 2);
    const kicker = kickerValue(hand, pairValues);

    return kicker
      ? `Two Pair, ${rankName(pairValues[0])} and ${rankName(
          pairValues[1],
        )}, ${highCardName(kicker)} Kicker`
      : `Two Pair, ${rankName(pairValues[0])} and ${rankName(pairValues[1])}`;
  }

  if (hand.name === "Three of a Kind") {
    const tripValue = valuesByCount(hand, 3)[0];
    const kicker = kickerValue(hand, tripValue ? [tripValue] : []);

    return kicker
      ? `Three ${rankName(tripValue)}, ${highCardName(kicker)} Kicker`
      : `Three ${rankName(tripValue)}`;
  }

  if (hand.name === "Four of a Kind") {
    const quadValue = valuesByCount(hand, 4)[0];
    const kicker = kickerValue(hand, quadValue ? [quadValue] : []);

    return kicker
      ? `Four ${rankName(quadValue)}, ${highCardName(kicker)} Kicker`
      : `Four ${rankName(quadValue)}`;
  }

  if (hand.name === "Full House") {
    const tripValue = valuesByCount(hand, 3)[0];
    const pairValue = valuesByCount(hand, 2)[0];

    return `Full House, ${rankName(tripValue)} over ${rankName(pairValue)}`;
  }

  if (hand.name === "Flush") {
    return `${highCardName(hand.cards[0]?.value)}-High Flush`;
  }

  if (hand.name === "Straight") {
    return `${highCardName(hand.cards[0]?.value)}-High Straight`;
  }

  if (hand.name === "High Card") {
    const kicker = hand.cards[1]?.value;

    return kicker
      ? `${highCardName(hand.cards[0]?.value)} High, ${highCardName(
          kicker,
        )} Kicker`
      : `${highCardName(hand.cards[0]?.value)} High`;
  }

  return hand.descr;
}

export function evaluateHoldemHand(playerId: string, cards: readonly Card[]) {
  if (cards.length !== 7) {
    throw new Error("Texas Hold'em showdown evaluation requires seven cards.");
  }

  const solverHand = Hand.solve(cards.map(cardToNotation));

  return {
    playerId,
    name: solverHand.name,
    description: describeSolvedHand(solverHand),
    rank: solverHand.rank,
    solverHand,
  };
}

export function findWinningEvaluations(evaluations: readonly EvaluatedHand[]) {
  const winningHands = new Set(
    Hand.winners(evaluations.map((evaluation) => evaluation.solverHand)),
  );

  return evaluations.filter((evaluation) =>
    winningHands.has(evaluation.solverHand),
  );
}
