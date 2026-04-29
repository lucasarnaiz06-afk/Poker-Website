export type PublicCardRank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "T"
  | "J"
  | "Q"
  | "K"
  | "A";

export type PublicCardSuit = "c" | "d" | "h" | "s";

export type PublicCard = {
  rank: PublicCardRank;
  suit: PublicCardSuit;
};

export type PublicTablePhase =
  | "NOT_STARTED"
  | "PRE_FLOP"
  | "FLOP"
  | "TURN"
  | "RIVER"
  | "SHOWDOWN"
  | "COMPLETE";

export type PublicSidePot = {
  amount: number;
  contributorPlayerIds: string[];
  eligiblePlayerIds: string[];
};

export type PublicPotAward = {
  amount: number;
  winnerIds: string[];
  eligiblePlayerIds: string[];
  handName: string | null;
  handDescription: string | null;
};

export type PublicTablePlayer = {
  id: string;
  seat: number;
  stack: number;
  holeCards: PublicCard[];
  folded: boolean;
  allIn: boolean;
  currentBet: number;
  committed: number;
  hasActed: boolean;
  inHand: boolean;
  hasHiddenHoleCards: boolean;
  isViewer: boolean;
};

export type PublicTableState = {
  lobbyId: string;
  viewerPlayerId: string;
  phase: PublicTablePhase;
  buttonSeat: number | null;
  currentTurnSeat: number | null;
  currentTurnPlayerId: string | null;
  currentBet: number;
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  board: PublicCard[];
  burnedCardCount: number;
  pot: {
    total: number;
    sidePots: PublicSidePot[];
    awards: PublicPotAward[];
  };
  showdownHands: Array<{
    playerId: string;
    name: string;
    description: string;
    rank: number;
  }>;
  players: PublicTablePlayer[];
};
