// Persisted hand-history JSON shapes (Hand.events / Hand.boards / Hand.pots / Hand.deckReveal) and the
// per-viewer (redacted) view sent to browsers. Browser-safe: no Prisma or Node imports.
import type { HandEvent, PotSummary, Street, Variant } from "@poker-platform/engine";
import type { DeckProof, StoredDeckReveal } from "./deck-proof";

export type SidePaymentReason = "NIT_GAME" | "BOUNTY_7_2";

/** Platform event: a side-game transfer settled after the pots (nit penalty, 7-2 bounty). Public. */
export type SidePaymentEvent = {
  type: "SIDE_PAYMENT";
  seq: number;
  reason: SidePaymentReason;
  fromUserId: string;
  fromSeat: number | null;
  toUserId: string;
  toSeat: number | null;
  amount: number;
};

/** Platform event: a player showed cards they did not have to show (e.g. the 7-2 claim, "show" after a win). */
export type ShowEvent = {
  type: "SHOW";
  seq: number;
  playerId: string;
  seat: number;
  cards: string[];
};

/** Hand.events: the engine event log followed by platform events (seq keeps increasing). */
export type StoredHandEvent = HandEvent | SidePaymentEvent | ShowEvent;

/** Hand.deckReveal (server-only): v2 per-position salts, or a legacy { deck, salt }. See ./deck-proof.ts. */
export type DeckReveal = StoredDeckReveal;

/** Hand.pots */
export type StoredPots = PotSummary[];

/** Hand.boards */
export type StoredBoards = string[][];

export type ViewerRelation = "PLAYER" | "SPECTATOR";

export type HandViewPlayer = {
  userId: string;
  username: string | null;
  displayName: string;
  avatar: string | null;
  seat: number;
  position: string;
  startingStack: number;
  endingStack: number;
  net: number;
  won: number;
  /** Only the viewer's own cards and cards shown at showdown / voluntarily. null = hidden. */
  holeCards: string[] | null;
  shown: boolean;
  isViewer: boolean;
  sawFlop: boolean;
  wentToShowdown: boolean;
  wonAtShowdown: boolean;
  /** Only for the viewer and shown hands. */
  allInEvNet: number | null;
};

/** Everything the hand page needs, already redacted for one viewer. Safe to serialize to the browser. */
export type HandView = {
  id: string;
  lobbyId: string;
  tableName: string;
  handNumber: number;
  variant: Variant;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  buttonSeat: number;
  isBombPot: boolean;
  runItTwice: boolean;
  boards: string[][];
  pots: StoredPots;
  totalPot: number;
  startedAt: string;
  endedAt: string | null;
  deckCommitment: string;
  /** The viewer's shuffle proof (only their visible cards opened). null for legacy hands: not verifiable. */
  deckProof: DeckProof | null;
  viewerId: string;
  relation: ViewerRelation;
  players: HandViewPlayer[];
  events: StoredHandEvent[];
  /** Street on which the action closed with players all-in (for "EV" display), null otherwise. */
  allInStreet: Street | null;
};
