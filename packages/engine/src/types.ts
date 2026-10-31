// Public types of the hand engine. Everything here is plain JSON data (no classes, no undefined in state).
import type { Card, RandomInt } from "./cards";

export type Variant = "NLHE" | "PLO";
export type Street = "PREFLOP" | "FLOP" | "TURN" | "RIVER";
/** BETTING: waiting for `toActPlayerId`. RUNOUT_DECISION: all-in, waiting for chooseRunout(1|2). */
export type HandStatus = "BETTING" | "RUNOUT_DECISION" | "COMPLETE";
/** Same values as the wire HandPhase (SHOWDOWN is instantaneous inside the engine and never observed). */
export type HandPhase = Street | "SHOWDOWN" | "COMPLETE";

export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "allin";
/** What the engine records: "allin" requests resolve to call/bet/raise with allIn = true. */
export type RecordedActionType = Exclude<ActionType, "allin">;

/** `amount` is the street total ("to") for bet/raise; ignored for the other actions. */
export type PlayerAction = { type: ActionType; amount?: number };

/** Identical to LegalActions in packages/shared/src/types/table-view.ts (checked by a type test). */
export type LegalActions = {
  canFold: boolean;
  canCheck: boolean;
  callAmount: number; // chips needed to call (0 when checking is possible); capped by stack
  canBetOrRaise: boolean;
  isBet: boolean; // true: no bet yet this street ("Bet"), false: "Raise"
  minTo: number; // minimum total for this street when betting/raising (0 when canBetOrRaise is false)
  maxTo: number; // maximum total (all-in for NLHE, pot limit for PLO)
  potTo: number; // total for a pot-sized bet/raise (capped at maxTo)
};

export type HandPlayerInput = { id: string; seat: number; stack: number };

export type BombPotConfig = {
  ante: number; // chips every dealt-in player antes (dead money); replaces blinds and the regular ante
  doubleBoard: boolean;
};

export type StartHandConfig = {
  handId?: string | null; // echoed in events / summary
  variant: Variant;
  players: HandPlayerInput[]; // dealt-in players, any order, 2..10, stacks > 0
  buttonSeat: number; // need not be a dealt-in seat (dead button)
  smallBlind: number;
  bigBlind: number;
  ante?: number; // regular per-player ante (dead money), 0 = none
  straddleSeat?: number | null; // must equal computePositions(...).straddleSeat
  bombPot?: BombPotConfig | null;
  runItTwice?: boolean; // allow the RUNOUT_DECISION pause when everyone is all-in before the river
  /** Players (not in the blinds) posting a live big blind out of position, e.g. new players who chose to post. */
  extraBlindPlayerIds?: string[];
};

export type StartHandOptions = {
  randomInt?: RandomInt; // required unless `deck` is given
  deck?: readonly string[]; // injected deck order (tests/replays); a prefix is completed in a fixed order
};

export type Positions = {
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  /** Seat allowed to straddle (first to act preflop), null heads-up. */
  straddleSeat: number | null;
  /** Seat order used for dealing, starting left of the button. */
  dealOrder: number[];
};

export type LastAction = { type: ActionType | "post" | "straddle" | "ante"; amount: number | null };

export type PlayerState = {
  id: string;
  seat: number;
  startingStack: number;
  stack: number; // chips behind (excludes streetBet)
  holeCards: Card[];
  streetBet: number; // live chips put in this street (0 after the street is collected)
  committed: number; // total chips put in this hand (antes + all bets, minus uncalled returns)
  folded: boolean;
  foldedStreet: Street | null;
  allIn: boolean;
  hasActed: boolean; // voluntary action this street
  actedLevel: number; // currentBet right after this player's last voluntary action this street
  lastAction: LastAction | null;
  uncalledReturned: number;
  won: number;
};

export type PostKind = "ANTE" | "BOMB_POT_ANTE" | "SMALL_BLIND" | "BIG_BLIND" | "EXTRA_BLIND" | "STRADDLE";

type EventBase = { seq: number };

export type HandStartEvent = EventBase & {
  type: "HAND_START";
  handId: string | null;
  variant: Variant;
  buttonSeat: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  straddleSeat: number | null;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  bombPot: BombPotConfig | null;
  runItTwiceAllowed: boolean;
  players: HandPlayerInput[];
};

export type PostEvent = EventBase & {
  type: "POST";
  playerId: string;
  seat: number;
  kind: PostKind;
  amount: number;
  allIn: boolean;
  stackAfter: number;
};

/** Private: contains every player's hole cards. Redact before sending anywhere. */
export type HoleCardsEvent = EventBase & {
  type: "HOLE_CARDS";
  hands: Array<{ playerId: string; seat: number; cards: Card[] }>;
};

export type ActionEvent = EventBase & {
  type: "ACTION";
  playerId: string;
  seat: number;
  street: Street;
  action: RecordedActionType;
  amount: number; // chips added by this action (0 for check/fold)
  to: number; // player's street total after the action
  allIn: boolean;
  stackAfter: number;
  potAfter: number; // all chips in the middle (incl. current street bets)
  currentBetAfter: number;
  facingAmount: number; // call amount the player faced before acting
  raisesBefore: number; // bets/raises already made this street before this action (posts excluded)
  couldRaise: boolean; // a bet/raise was legal for the player at that moment
  fullRaise: boolean; // bet/raise that met the minimum (reopens betting); false for incomplete all-ins
  reason: "timeout" | "left" | null; // automatic action
  outOfTurn: boolean;
};

export type StreetEvent = EventBase & {
  type: "STREET";
  street: Exclude<Street, "PREFLOP">;
  boardIndex: number;
  cards: Card[]; // newly dealt
  board: Card[]; // the full board after dealing
};

export type UncalledReturnEvent = EventBase & {
  type: "UNCALLED_RETURN";
  playerId: string;
  seat: number;
  amount: number;
};

export type RunoutDecisionEvent = EventBase & {
  type: "RUNOUT_DECISION";
  playerIds: string[]; // players still in the hand
  street: Street; // last street reached before the runout
};

export type RunoutEvent = EventBase & { type: "RUNOUT"; runs: 1 | 2 };

export type ShowReason = "WINNER" | "ALL_IN" | "CALLED";

export type BoardHand = {
  boardIndex: number;
  value: number;
  name: string;
  description: string;
  bestFive: Card[];
};

export type ShowdownEvent = EventBase & {
  type: "SHOWDOWN";
  order: string[]; // player ids in showing order
  hands: Array<{
    playerId: string;
    seat: number;
    cards: Card[];
    mustShow: boolean;
    showReason: ShowReason | null;
    boards: BoardHand[];
  }>;
};

export type AwardWinner = { playerId: string; seat: number; amount: number; handName: string | null };

export type PotAwardEvent = EventBase & {
  type: "POT_AWARD";
  potIndex: number; // 0 = main pot
  boardIndex: number;
  amount: number; // this board's share of the pot
  eligiblePlayerIds: string[];
  winners: AwardWinner[];
  uncontested: boolean;
};

export type HandEndEvent = EventBase & {
  type: "HAND_END";
  stacks: Array<{ playerId: string; seat: number; stack: number }>;
};

export type HandEvent =
  | HandStartEvent
  | PostEvent
  | HoleCardsEvent
  | ActionEvent
  | StreetEvent
  | UncalledReturnEvent
  | RunoutDecisionEvent
  | RunoutEvent
  | ShowdownEvent
  | PotAwardEvent
  | HandEndEvent;

export type HandEventType = HandEvent["type"];

export type Pot = { amount: number; eligiblePlayerIds: string[] };

export type PotSummary = Pot & {
  index: number;
  awards: Array<{ boardIndex: number; amount: number; winners: AwardWinner[] }>;
};

export type PlayerStats = {
  /** PokerTracker definitions. Preflop stats are all false in bomb pots (see HandSummary.preflopStatsEligible). */
  vpip: boolean;
  pfr: boolean;
  threeBet: boolean;
  threeBetOpportunity: boolean;
  facedThreeBet: boolean; // open-raised and faced exactly one re-raise
  foldedToThreeBet: boolean;
  cbet: boolean;
  cbetOpportunity: boolean;
  sawFlop: boolean; // still in the hand when the flop was dealt (always true in bomb pots)
  postflopBets: number;
  postflopRaises: number;
  postflopCalls: number;
  postflopChecks: number;
  postflopFolds: number;
};

export type PlayerSummary = {
  id: string;
  seat: number;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isStraddle: boolean;
  startingStack: number;
  endingStack: number;
  net: number; // endingStack - startingStack
  committed: number; // chips put in the pot (after uncalled returns)
  uncalledReturned: number;
  won: number; // total chips awarded from pots (excludes uncalled returns)
  wonPerPot: Array<{ potIndex: number; boardIndex: number; amount: number }>;
  holeCards: Card[];
  folded: boolean;
  foldedStreet: Street | null;
  allIn: boolean;
  wentToShowdown: boolean;
  wonAtShowdown: boolean;
  mustShow: boolean;
  showReason: ShowReason | null;
  hands: BoardHand[]; // evaluated hand per board (only for players at showdown)
  stats: PlayerStats;
};

export type HandSummary = {
  handId: string | null;
  variant: Variant;
  buttonSeat: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  straddleSeat: number | null;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  isBombPot: boolean;
  doubleBoard: boolean;
  runs: 1 | 2;
  boards: Card[][];
  endedOn: Street; // street reached when the hand ended
  showdown: boolean;
  isWalk: boolean; // everyone folded to the big blind preflop
  preflopStatsEligible: boolean; // false for bomb pots
  totalPot: number; // sum of all pots (after uncalled returns)
  pots: PotSummary[];
  /** Set when the hand was decided by an all-in runout: board and players at the moment action closed. */
  allIn: { street: Street; board: Card[]; playerIds: string[] } | null;
  players: PlayerSummary[];
};

export type HandState = {
  version: 1;
  config: {
    handId: string | null;
    variant: Variant;
    smallBlind: number;
    bigBlind: number;
    ante: number;
    bombPot: BombPotConfig | null;
    runItTwice: boolean;
  };
  positions: {
    buttonSeat: number;
    smallBlindSeat: number | null;
    bigBlindSeat: number | null;
    straddleSeat: number | null; // only set when the straddle was actually posted
    extraBlindSeats: number[];
  };
  deck: Card[]; // full deck order (secret)
  deckPos: number;
  burns: Card[];
  players: PlayerState[]; // sorted by seat
  boards: Card[][];
  street: Street;
  status: HandStatus;
  toActPlayerId: string | null;
  currentBet: number; // amount to call this street (preflop: at least the big blind)
  minRaise: number; // size of the last full bet/raise this street
  streetAggressorId: string | null;
  streetRaises: number;
  finalAggressorId: string | null; // last aggressor of the last betting round that took place
  runs: 1 | 2;
  allIn: { street: Street; board: Card[]; playerIds: string[] } | null;
  events: HandEvent[];
  summary: HandSummary | null;
};

export type HandSnapshotPlayer = Omit<PlayerState, "hasActed" | "actedLevel" | "startingStack" | "won" | "uncalledReturned">;

/** Everything a runtime needs to render a hand (no deck). Hole cards are included: redact per viewer. */
export type HandSnapshot = {
  handId: string | null;
  variant: Variant;
  status: HandStatus;
  phase: HandPhase;
  street: Street;
  isBombPot: boolean;
  doubleBoard: boolean;
  runs: 1 | 2;
  boards: Card[][];
  buttonSeat: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  straddleSeat: number | null;
  toActPlayerId: string | null;
  currentBet: number;
  minRaise: number;
  pots: Pot[]; // settled pots (excluding current street bets), main pot first
  totalPot: number; // pots + current street bets
  players: HandSnapshotPlayer[];
};
