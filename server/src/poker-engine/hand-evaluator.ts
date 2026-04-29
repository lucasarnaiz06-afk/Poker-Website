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

export function evaluateHoldemHand(playerId: string, cards: readonly Card[]) {
  if (cards.length !== 7) {
    throw new Error("Texas Hold'em showdown evaluation requires seven cards.");
  }

  const solverHand = Hand.solve(cards.map(cardToNotation));

  return {
    playerId,
    name: solverHand.name,
    description: solverHand.descr,
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
