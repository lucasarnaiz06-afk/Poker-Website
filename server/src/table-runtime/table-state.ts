import type { PokerHand } from "@poker-platform/engine";
import type { DeckRevealV2 } from "@poker-platform/shared/hands/client";
import type { HandResultView, SeatStatus, TableEvent, TableLogEntry, TableVote, VoteKind } from "@poker-platform/shared/types";
import type { TimerHandle } from "./clock";
import type { Profile, SidePayment } from "./ports";

export type SitOutReason = "user" | "timeout" | "busted" | "restricted" | null;

export type SeatState = {
  seat: number;
  userId: string;
  profile: Profile;
  /** Chips behind at the last hand boundary (the live stack during a hand lives in the engine). */
  stack: number;
  status: SeatStatus;
  sitOutReason: SitOutReason;
  sitOutSince: number | null;
  sitOutTimer: TimerHandle | null;
  wantsStraddle: boolean;
  /** New player chose to post a big blind instead of waiting for it. */
  postNow: boolean;
  timeBankMs: number;
  handsTowardsBank: number;
  consecutiveTimeouts: number;
  /** Stand requested while in a hand: cashed out when the hand ends. */
  leaving: boolean;
  pendingTopUp: number;
  seatSessionId: string;
  topUps: number;
  /** A hand was dealt while this player sat out (they wait for the big blind when sitting in). */
  missedHand: boolean;
};

export type ShownHand = { cards: string[]; handName: string | null };

export type TurnClock = {
  token: string | null;
  actorId: string | null;
  deadline: number | null;
  usingBank: boolean;
  bankStartedAt: number | null;
  timer: TimerHandle | null;
};

export type ActiveHand = {
  id: string;
  number: number;
  engine: PokerHand;
  startedAt: number;
  completedAt: number | null;
  deck: string[];
  /** Server-only: cards + per-position salts behind `commitment`. Clients get per-viewer proofs (view.ts). */
  reveal: DeckRevealV2;
  commitment: string;
  lastSeq: number;
  dealt: Array<{ userId: string; seat: number }>;
  positions: Map<number, string>;
  bountyActive: boolean;
  nitRound: boolean;
  clock: TurnClock;
  shown: Map<string, ShownHand>;
  result: HandResultView | null;
  sidePayments: SidePayment[];
  bountyClaimableBy: string | null;
  persisted: boolean;
};

export type VoteState = TableVote & {
  createdAtMs: number;
  expiresAtMs: number;
  resolvedAtMs: number | null;
  timer: TimerHandle | null;
};

export type NitState = {
  active: boolean;
  /** A round is running: participants fixed at its first hand. */
  roundRunning: boolean;
  participants: string[];
  nits: string[];
};

export type TableTimings = {
  firstHandDelayMs: number;
  nextHandDelayMs: number;
  showdownExtraDelayMs: number;
  voteMs: number;
  ritVoteMs: number;
  voteCooldownMs: number;
  resolvedVoteVisibleMs: number;
  disconnectGraceMs: number;
  sitOutAutoStandMs: number;
  timeBankReplenishEveryHands: number;
  timeBankReplenishMs: number;
  autoSitOutAfterTimeouts: number;
};

export const DEFAULT_TIMINGS: TableTimings = {
  firstHandDelayMs: 2_000,
  nextHandDelayMs: 4_000,
  showdownExtraDelayMs: 2_000,
  voteMs: 20_000,
  ritVoteMs: 8_000,
  voteCooldownMs: 60_000,
  resolvedVoteVisibleMs: 5_000,
  disconnectGraceMs: 15_000,
  sitOutAutoStandMs: 10 * 60_000,
  timeBankReplenishEveryHands: 10,
  timeBankReplenishMs: 5_000,
  autoSitOutAfterTimeouts: 2,
};

export type LogKind = TableLogEntry["kind"];
export type { TableEvent, VoteKind };
