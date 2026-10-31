declare module "pokersolver" {
  export type SolvedPokerHand = {
    cards: Array<{
      value: string;
      suit: string;
      rank: number;
    }>;
    name: string;
    descr: string;
    rank: number;
  };

  const pokerSolver: {
    Hand: {
      solve(cards: string[]): SolvedPokerHand;
      winners(hands: SolvedPokerHand[]): SolvedPokerHand[];
    };
  };

  export default pokerSolver;
}
