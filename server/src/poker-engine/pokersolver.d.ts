declare module "pokersolver" {
  export type SolvedPokerHand = {
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
