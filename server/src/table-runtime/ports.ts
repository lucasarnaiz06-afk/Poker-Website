// Small interfaces the table runtime depends on. Production adapters live in prisma-ports.ts,
// in-memory fakes (tests, local experiments) in memory-ports.ts.
import type { HandEvent, HandSummary } from "@poker-platform/engine";
import type {
  ChatMessage,
  HandResultView,
  LobbyTableSummary,
  TableSettings,
  TableView,
} from "@poker-platform/shared/types";

export type Profile = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

export type TableRecord = {
  id: string;
  name: string;
  hostUserId: string;
  settings: TableSettings;
  visibility: "PUBLIC" | "PRIVATE";
  passwordHash: string | null;
  inviteCode: string | null;
  closed: boolean;
  /** Highest persisted hand number (hand numbers continue after a restart). */
  lastHandNumber: number;
};

export type SeatedStack = {
  tableId: string;
  userId: string;
  stack: number;
  /** Idempotency key for the recovery refund of exactly this seating. */
  refKey: string;
};

export interface LobbyStorePort {
  loadTable(tableId: string): Promise<TableRecord | null>;
  /** Public, not closed tables for the lobby list (newest first, bounded). */
  listOpenPublicTables(): Promise<TableRecord[]>;
  /** True when the user already belongs to the table (joined through an invite link / password before). */
  isMember(tableId: string, userId: string): Promise<boolean>;
  addMember(tableId: string, userId: string): Promise<void>;
  getProfiles(userIds: string[]): Promise<Profile[]>;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
  /** Seats holding chips that were left behind by a previous process (crash recovery). */
  listSeatedStacks(): Promise<SeatedStack[]>;
  /** Host closed the table: mark the lobby closed (seats were already cashed out). */
  closeTable(tableId: string): Promise<void>;
  /** Normalizes lobby rows after recovery (no seated players, legacy JOINED stacks cleared). */
  resetTables(): Promise<void>;
}

export type WalletErrorCode = "INSUFFICIENT_FUNDS" | "USER_NOT_FOUND" | "INVALID_AMOUNT" | "IDEMPOTENCY_CONFLICT";

export interface WalletPort {
  getBalance(userId: string): Promise<number>;
  /** Atomically: wallet -> table (ledger BUY_IN) and the seat row (seat, stack = amount). Returns the new balance. */
  buyIn(input: { userId: string; tableId: string; seat: number; amount: number; refKey: string }): Promise<number>;
  /** Atomically: wallet -> table (ledger REBUY) and the seat stack = newStack. */
  topUp(input: { userId: string; tableId: string; amount: number; newStack: number; refKey: string }): Promise<number>;
  /**
   * Atomically: table -> wallet (ledger CASH_OUT, or REFUND for recovery/shutdown) and releases the seat row.
   * amount may be 0 (only releases the seat).
   */
  cashOut(input: {
    userId: string;
    tableId: string;
    amount: number;
    refKey: string;
    reason: "STAND" | "SHUTDOWN" | "RECOVERY";
  }): Promise<number>;
}

export type SidePayment = HandResultView["sidePayments"][number] & { fromUserId: string; toUserId: string };

/**
 * Everything needed to persist one completed hand (see packages/shared/src/hands/persist.ts). Engine
 * player ids are user ids. Contains the deck and every hole card: server-side only.
 */
export type HandRecord = {
  handId: string;
  tableId: string;
  handNumber: number;
  startedAt: Date;
  endedAt: Date;
  summary: HandSummary;
  events: HandEvent[];
  /** Side-game transfers settled with the hand (already applied to `stacks`). */
  sidePayments: SidePayment[];
  /** Players who showed voluntarily (mustShow players are always shown). */
  shownPlayerIds: string[];
  deckCommitment: string;
  /** Server-only full reveal (cards + per-position salts). Never sent to clients as is. */
  deckReveal: { v: 2; cards: string[]; salts: string[] };
  /** Position name by user id ("BTN", "SB", ...). */
  positions: Record<string, string>;
  /** Stack of every seated player at this hand boundary (LobbyPlayer.chipStack). */
  stacks: Array<{ userId: string; stack: number }>;
};

export type HandAmendment = {
  tableId: string;
  /** Persisted hand the payment/show belongs to (null when no hand was persisted yet). */
  handId: string | null;
  payments: SidePayment[];
  shownPlayerIds: string[];
  /** New stacks of the affected seated players. */
  stacks: Array<{ userId: string; stack: number }>;
  at: Date;
};

export interface HandStorePort {
  /** One transaction: Hand + HandPlayer rows, PlayerDailyStat upserts, LobbyPlayer stacks. */
  saveHand(record: HandRecord): Promise<void>;
  /** One transaction: side payments / shows after the hand was saved (7-2 claim, nit leaving, "Show"). */
  amendHand(amendment: HandAmendment): Promise<void>;
}

export type PlayCheck = { ok: true } | { ok: false; code: string; message: string };

export interface PlayGatePort {
  check(userId: string): Promise<PlayCheck>;
}

export interface Rng {
  randomInt(maxExclusive: number): number;
  randomHex(bytes: number): string;
  uuid(): string;
}

/** Where the runtime sends per-connection output. Implemented by the socket layer (or a test fake). */
export interface TableTransport {
  sendState(connId: string, view: TableView): void;
  sendChat(connIds: string[], message: ChatMessage): void;
  sendError(connId: string, error: { tableId: string; code: string; message: string }): void;
  sendBalance(userId: string, balance: number): void;
}

export interface LobbyFeedListener {
  (tables: LobbyTableSummary[]): void;
}
