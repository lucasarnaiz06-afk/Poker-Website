import type {
  PublicCard,
  PublicGameLogEntry,
  PublicHandCompletePayload,
  PublicHandHistoryEntry,
  PublicPotAward,
  PublicSidePot,
  PublicTablePhase,
  PublicTableState,
} from "./table";

export type CommandCenterPlayer = {
  id: string;
  name: string;
  seat: number;
  stack: number;
  holeCards: PublicCard[];
  folded: boolean;
  allIn: boolean;
  currentBet: number;
  committed: number;
  hasActed: boolean;
  inHand: boolean;
};

export type CommandCenterGameSummary = {
  lobbyId: string;
  lobbyName: string;
  phase: PublicTablePhase;
  handNumber: number;
  playerCount: number;
  maxPlayers: number;
  currentTurnPlayerId: string | null;
  currentTurnPlayerName: string | null;
  potTotal: number;
  board: PublicCard[];
  updatedAt: string;
  players: Array<{
    id: string;
    name: string;
    seat: number;
    stack: number;
    folded: boolean;
    allIn: boolean;
    currentBet: number;
    inHand: boolean;
  }>;
};

export type CommandCenterGameDetail = {
  lobbyId: string;
  lobbyName: string;
  handNumber: number;
  phase: PublicTablePhase;
  buttonSeat: number | null;
  currentTurnSeat: number | null;
  currentTurnPlayerId: string | null;
  currentTurnPlayerName: string | null;
  currentBet: number;
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  board: PublicCard[];
  burnedCards: PublicCard[];
  deckCount: number;
  updatedAt: string;
  createdAt: string;
  startedByUserId: string;
  startedByName: string | null;
  pot: {
    total: number;
    sidePots: PublicSidePot[];
    awards: PublicPotAward[];
  };
  showdownHands: PublicTableState["showdownHands"];
  actionLog: PublicGameLogEntry[];
  handHistory: PublicHandHistoryEntry[];
  lastHandCompletePayload: PublicHandCompletePayload | null;
  players: CommandCenterPlayer[];
};
