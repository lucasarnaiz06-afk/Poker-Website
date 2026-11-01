// Realtime wire contract between the game server (server/src/realtime, server/src/table-runtime)
// and the table UI (client/components/table). The server sends one full TableView per viewer after
// every change ("table:state"); views are redacted per viewer: hole cards of other players are only
// present when they were shown at showdown or voluntarily.
import type { PublicCard } from "./table";
import type { TableSettings, VoteRule } from "./table-settings";

export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "allin";

export type HandPhase = "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN" | "COMPLETE";

export type TableStatus = "WAITING" | "RUNNING" | "PAUSED" | "CLOSED";

export type SeatStatus =
  | "ACTIVE" // dealt into hands
  | "SITTING_OUT" // seated, not dealt in
  | "WAITING_BB"; // just sat down; dealt in when the big blind reaches them (or posts)

export type LegalActions = {
  canFold: boolean;
  canCheck: boolean;
  callAmount: number; // chips needed to call (0 when checking is possible); capped by stack
  canBetOrRaise: boolean;
  isBet: boolean; // true: no bet yet this street ("Bet"), false: "Raise"
  minTo: number; // minimum total for this street when betting/raising
  maxTo: number; // maximum total (all-in for NLHE, pot limit for PLO)
  potTo: number; // total for a pot-sized bet/raise (capped at maxTo), for the "Pot" button
};

export type TableSeatView = {
  seat: number; // 1..maxPlayers
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  stack: number; // chips behind (excludes `bet`)
  bet: number; // chips put in on the current street
  status: SeatStatus;
  connected: boolean;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  cardCount: number; // number of hole cards dealt (render backs when holeCards is null)
  holeCards: PublicCard[] | null; // null = hidden from this viewer
  lastAction: { type: ActionType | "post" | "straddle" | "ante"; amount: number | null } | null;
  timeBankSec: number;
  wantsStraddle: boolean;
  isNit: boolean | null; // null when no nit game is running
  handName: string | null; // e.g. "Two Pair, Kings and Sevens" when shown
};

export type PotView = { amount: number; eligibleSeats: number[] };

export type HandResultView = {
  winners: Array<{
    seat: number;
    userId: string;
    amount: number;
    potIndex: number;
    boardIndex: number; // which board (double board / run it twice), 0-based
    handName: string | null;
  }>;
  shown: Array<{ seat: number; cards: PublicCard[]; handName: string | null }>;
  uncalledReturn: { seat: number; amount: number } | null;
  sidePayments: Array<{
    fromSeat: number;
    toSeat: number;
    amount: number;
    reason: "NIT_GAME" | "BOUNTY_7_2";
  }>;
};

export type HandView = {
  handId: string;
  handNumber: number;
  phase: HandPhase;
  isBombPot: boolean;
  // Usually one board; two for double-board bomb pots or run it twice. Each board is the full array of
  // cards dealt on it so far, shared cards included: run it twice after the flop sends two boards with
  // the same first 3 cards and their own turn/river. Before the runout only the dealt cards are sent.
  boards: PublicCard[][];
  runItTwice: boolean;
  buttonSeat: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  straddleSeat: number | null;
  toActSeat: number | null;
  actionDeadline: string | null; // ISO time the current actor times out (incl. time bank once used)
  usingTimeBank: boolean;
  currentBet: number;
  pots: PotView[]; // settled pots from previous streets (main first)
  totalPot: number; // pots + all current-street bets
  result: HandResultView | null; // set once the hand is complete
  // Shuffle commitment, published at hand start (scheme: packages/shared/src/hands/deck-proof.ts):
  //   leaf_i = sha256hex(`${i}|${card_i}|${salt_i}`) per deck position i (0 = top), salt_i 16 random bytes (hex);
  //   deckCommitment = sha256hex(leaf_0 + leaf_1 + ... + leaf_51).
  deckCommitment: string;
  // null until the hand is complete. Then: this viewer's proof, JSON of
  //   { v: 2, size: 52, open: [{ i, card, salt }], leaves: [{ i, leaf }] }
  // `open` holds only the cards this viewer was entitled to see (own hole cards, dealt board cards, cards shown at
  // showdown or voluntarily; spectators: board + shown); every other position (mucked/folded hands, burns,
  // undealt cards) is a leaf hash only. Parse/verify with parseDeckProof/proofCommitment from
  // "@poker-platform/shared/hands/client". Never the full deck (the name is kept for compatibility).
  revealedDeck: string | null;
};

export type VoteKind = "BOMB_POT" | "NIT_GAME" | "BOUNTY_GAME" | "RUN_IT_TWICE";

export type TableVote = {
  id: string;
  kind: VoteKind;
  // BOUNTY_GAME / NIT_GAME: "START" turns it on, "STOP" turns it off. BOMB_POT: "START" = next hand.
  action: "START" | "STOP";
  proposedByUserId: string;
  proposedByName: string;
  rule: VoteRule;
  eligibleUserIds: string[];
  yesUserIds: string[];
  noUserIds: string[];
  status: "OPEN" | "PASSED" | "FAILED";
  createdAt: string;
  expiresAt: string;
};

export type SideGamesView = {
  nitGame: { active: boolean; nitUserIds: string[]; participantUserIds: string[] };
  bountyGame: { active: boolean };
  bombPotQueued: boolean; // the next hand is a bomb pot
  handsUntilAutoBombPot: number | null;
};

export type TableLogEntry = {
  id: string;
  handNumber: number | null;
  at: string;
  text: string;
  kind: "system" | "action" | "deal" | "showdown" | "award" | "vote" | "side_game" | "seat";
};

export type TableEvent = {
  type:
    | "HAND_START"
    | "ACTION"
    | "STREET"
    | "SHOWDOWN"
    | "HAND_END"
    | "VOTE"
    | "SIDE_GAME"
    | "SEAT"
    | "TIMEOUT";
  seat: number | null;
  action: ActionType | null;
  amount: number | null;
};

export type TableView = {
  tableId: string;
  name: string;
  hostUserId: string;
  settings: TableSettings;
  status: TableStatus;
  seats: TableSeatView[]; // occupied seats only
  hand: HandView | null;
  votes: TableVote[]; // open votes plus votes resolved in the last few seconds
  sideGames: SideGamesView;
  log: TableLogEntry[]; // most recent last, capped
  nextHandAt: string | null;
  viewer: {
    userId: string;
    seat: number | null; // null = spectating
    legalActions: LegalActions | null; // non-null only when it is the viewer's turn
    canShowCards: boolean; // hand over and viewer's cards were not shown
    walletBalance: number;
  };
  version: number; // increases with every state change for this table
  serverTime: string; // ISO, lets clients correct clock skew for timers
  lastEvent: TableEvent | null;
};

export type ChatMessage = {
  id: string;
  tableId: string;
  userId: string;
  displayName: string;
  text: string | null;
  emoteId: string | null;
  sentAt: string;
};

export type LobbyTableSummary = {
  tableId: string;
  name: string;
  variant: TableSettings["variant"];
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxPlayers: number;
  seated: number;
  visibility: "PUBLIC" | "PRIVATE";
  status: TableStatus;
  features: Array<"BOMB_POT" | "NIT_GAME" | "BOUNTY_GAME" | "STRADDLE" | "RUN_IT_TWICE">;
  avgPot: number | null;
  handsPerHour: number | null;
  hasPassword?: boolean; // joining requires a password (additive, optional)
  ante?: number; // regular per-hand ante in chips (additive, optional)
};

export type AckOk<T = undefined> = { ok: true; data: T };
export type AckErr = { ok: false; code: string; message: string };
export type Ack<T = undefined> = AckOk<T> | AckErr;

// Socket.io events. Every client->server event takes an ack callback as the last argument.
export type ClientToServerEvents = {
  // inviteCode (additive, optional): grants access to a private table like the invite link does.
  "table:join": (
    p: { tableId: string; password?: string; inviteCode?: string },
    ack: (r: Ack<TableView>) => void,
  ) => void;
  "table:leave": (p: { tableId: string }, ack: (r: Ack) => void) => void;
  // postNow (additive, optional): a player joining a running game posts a big blind to be dealt in
  // immediately instead of waiting for the big blind.
  "table:sit": (
    p: { tableId: string; seat: number; buyIn: number; postNow?: boolean },
    ack: (r: Ack) => void,
  ) => void;
  "table:stand": (p: { tableId: string }, ack: (r: Ack) => void) => void;
  "table:sitOut": (p: { tableId: string; sitOut: boolean }, ack: (r: Ack) => void) => void;
  "table:rebuy": (p: { tableId: string; amount: number }, ack: (r: Ack) => void) => void;
  "table:start": (p: { tableId: string }, ack: (r: Ack) => void) => void;
  // Additive: host closes the table; a hand in progress is played out first, then every stack goes back to its wallet.
  "table:close": (p: { tableId: string }, ack: (r: Ack) => void) => void;
  "table:action": (
    p: { tableId: string; handId: string; type: ActionType; amount?: number },
    ack: (r: Ack) => void,
  ) => void;
  "table:straddle": (p: { tableId: string; enabled: boolean }, ack: (r: Ack) => void) => void;
  "table:propose": (
    p: { tableId: string; kind: VoteKind; action: "START" | "STOP" },
    ack: (r: Ack) => void,
  ) => void;
  "table:vote": (p: { tableId: string; voteId: string; yes: boolean }, ack: (r: Ack) => void) => void;
  "table:show": (p: { tableId: string; handId: string }, ack: (r: Ack) => void) => void;
  "table:chat": (p: { tableId: string; text?: string; emoteId?: string }, ack: (r: Ack) => void) => void;
  "lobby:subscribe": (p: Record<string, never>, ack: (r: Ack<LobbyTableSummary[]>) => void) => void;
  "lobby:unsubscribe": (p: Record<string, never>, ack: (r: Ack) => void) => void;
};

export type ServerToClientEvents = {
  "table:state": (view: TableView) => void;
  "table:chat": (msg: ChatMessage) => void;
  "table:error": (err: { tableId: string; code: string; message: string }) => void;
  "lobby:tables": (tables: LobbyTableSummary[]) => void;
  "wallet:balance": (p: { balance: number }) => void;
};
