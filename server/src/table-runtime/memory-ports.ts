// In-memory implementations of every runtime port. Used by tests; they mirror the transactional
// semantics of the Prisma adapters (idempotent refKeys, balance >= 0, seat rows written with money).
import type { ChatMessage, TableView } from "@poker-platform/shared/types";
import { RuntimeError } from "./errors";
import type {
  HandRecord,
  HandStorePort,
  LobbyStorePort,
  PlayCheck,
  PlayGatePort,
  Profile,
  Rng,
  SeatedStack,
  HandAmendment,
  TableRecord,
  TableTransport,
  WalletPort,
} from "./ports";

export class WalletFailure extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

type SeatRow = { tableId: string; userId: string; seat: number | null; stack: number | null; status: "SEATED" | "JOINED"; joinedAt: number };

export class MemoryStore implements LobbyStorePort, WalletPort, HandStorePort, PlayGatePort {
  tables = new Map<string, TableRecord>();
  balances = new Map<string, number>();
  profiles = new Map<string, Profile>();
  members = new Set<string>();
  rows = new Map<string, SeatRow>();
  ledger = new Map<string, { userId: string; delta: number; type: string }>();
  hands: HandRecord[] = [];
  amendments: HandAmendment[] = [];
  restricted = new Map<string, PlayCheck & { ok: false }>();
  failNextSaveHand = 0;
  failCashOut = false;
  private joinCounter = 0;

  addTable(record: Partial<TableRecord> & Pick<TableRecord, "id" | "settings" | "hostUserId">) {
    this.tables.set(record.id, {
      name: `Table ${record.id}`,
      visibility: "PUBLIC",
      passwordHash: null,
      inviteCode: null,
      closed: false,
      lastHandNumber: 0,
      ...record,
    });
  }

  addUser(userId: string, balance: number, name = userId) {
    this.balances.set(userId, balance);
    this.profiles.set(userId, { userId, username: name.toLowerCase(), displayName: name, avatarUrl: null });
  }

  /** Wallets + chips persisted on seats (what survives a crash). */
  totalChips() {
    let total = 0;
    for (const balance of this.balances.values()) total += balance;
    for (const row of this.rows.values()) if (row.status === "SEATED") total += row.stack ?? 0;
    return total;
  }

  private key(tableId: string, userId: string) {
    return `${tableId}:${userId}`;
  }

  private move(userId: string, delta: number, type: string, refKey: string) {
    const existing = this.ledger.get(refKey);
    if (existing) {
      if (existing.userId !== userId || existing.delta !== delta) throw new WalletFailure("IDEMPOTENCY_CONFLICT", "refKey reused");
      return { duplicate: true, balance: this.balances.get(userId)! };
    }
    const balance = this.balances.get(userId);
    if (balance === undefined) throw new WalletFailure("USER_NOT_FOUND", "User not found.");
    if (balance + delta < 0) throw new WalletFailure("INSUFFICIENT_FUNDS", "Not enough chips in your wallet.");
    this.balances.set(userId, balance + delta);
    this.ledger.set(refKey, { userId, delta, type });
    return { duplicate: false, balance: balance + delta };
  }

  // ---- LobbyStorePort
  async loadTable(tableId: string) {
    return this.tables.get(tableId) ?? null;
  }
  async listOpenPublicTables() {
    return [...this.tables.values()].filter((t) => t.visibility === "PUBLIC" && !t.closed);
  }
  async isMember(tableId: string, userId: string) {
    return this.members.has(this.key(tableId, userId));
  }
  async addMember(tableId: string, userId: string) {
    this.members.add(this.key(tableId, userId));
  }
  async getProfiles(userIds: string[]) {
    return userIds.map((id) => this.profiles.get(id)).filter((p): p is Profile => p !== undefined);
  }
  async verifyPassword(password: string, passwordHash: string) {
    return passwordHash === `plain:${password}`;
  }
  async listSeatedStacks(): Promise<SeatedStack[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === "SEATED" && (row.stack ?? 0) > 0)
      .map((row) => ({
        tableId: row.tableId,
        userId: row.userId,
        stack: row.stack!,
        refKey: `recover:${row.tableId}:${row.userId}:${row.joinedAt}`,
      }));
  }
  async closeTable(tableId: string) {
    const table = this.tables.get(tableId);
    if (table) table.closed = true;
  }
  async resetTables() {
    for (const row of this.rows.values()) {
      if (row.status === "SEATED" && (row.stack ?? 0) === 0) {
        row.status = "JOINED";
        row.seat = null;
        row.stack = null;
      }
    }
  }

  // ---- WalletPort
  async getBalance(userId: string) {
    const balance = this.balances.get(userId);
    if (balance === undefined) throw new WalletFailure("USER_NOT_FOUND", "User not found.");
    return balance;
  }
  async buyIn(input: { userId: string; tableId: string; seat: number; amount: number; refKey: string }) {
    const result = this.move(input.userId, -input.amount, "BUY_IN", input.refKey);
    if (!result.duplicate) {
      this.joinCounter += 1;
      this.rows.set(this.key(input.tableId, input.userId), {
        tableId: input.tableId,
        userId: input.userId,
        seat: input.seat,
        stack: input.amount,
        status: "SEATED",
        joinedAt: this.joinCounter,
      });
    }
    return result.balance;
  }
  async topUp(input: { userId: string; tableId: string; amount: number; newStack: number; refKey: string }) {
    const result = this.move(input.userId, -input.amount, "REBUY", input.refKey);
    const row = this.rows.get(this.key(input.tableId, input.userId));
    if (!result.duplicate && row) row.stack = input.newStack;
    return result.balance;
  }
  async cashOut(input: { userId: string; tableId: string; amount: number; refKey: string; reason: string }) {
    if (this.failCashOut) throw new Error("db down");
    const row = this.rows.get(this.key(input.tableId, input.userId));
    let balance = this.balances.get(input.userId) ?? 0;
    // Like the Prisma adapter: only a seat that still holds chips can be cashed out (once).
    const claimable = !row || row.status === "SEATED";
    if (claimable && input.amount > 0) {
      balance = this.move(input.userId, input.amount, input.reason === "STAND" ? "CASH_OUT" : "REFUND", input.refKey).balance;
    }
    if (row) {
      row.status = "JOINED";
      row.seat = null;
      row.stack = null;
    }
    return balance;
  }

  // ---- HandStorePort
  async saveHand(record: HandRecord) {
    if (this.failNextSaveHand > 0) {
      this.failNextSaveHand -= 1;
      throw new Error("db down");
    }
    this.hands.push(structuredClone(record));
    for (const { userId, stack } of record.stacks) {
      const row = this.rows.get(this.key(record.tableId, userId));
      if (row && row.status === "SEATED") row.stack = stack;
    }
  }
  async amendHand(amendment: HandAmendment) {
    this.amendments.push(structuredClone(amendment));
    for (const { userId, stack } of amendment.stacks) {
      const row = this.rows.get(this.key(amendment.tableId, userId));
      if (row && row.status === "SEATED") row.stack = stack;
    }
  }

  // ---- PlayGatePort
  async check(userId: string): Promise<PlayCheck> {
    return this.restricted.get(userId) ?? { ok: true };
  }
}

/** Deterministic RNG for tests (mulberry32). */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  let counter = 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    randomInt: (max) => Math.floor(next() * max),
    randomHex: (bytes) =>
      Array.from({ length: bytes }, () =>
        Math.floor(next() * 256)
          .toString(16)
          .padStart(2, "0"),
      ).join(""),
    uuid: () => {
      counter += 1;
      return `id-${seed}-${counter}`;
    },
  };
}

export { cryptoRng } from "./crypto-rng";

/** Records everything the runtime sends. */
export class RecordingTransport implements TableTransport {
  states: Array<{ connId: string; view: TableView }> = [];
  chats: Array<{ connIds: string[]; message: ChatMessage }> = [];
  errors: Array<{ connId: string; code: string }> = [];
  balances: Array<{ userId: string; balance: number }> = [];
  onState?: (connId: string, view: TableView) => void;

  sendState(connId: string, view: TableView) {
    this.states.push({ connId, view });
    this.onState?.(connId, view);
  }
  sendChat(connIds: string[], message: ChatMessage) {
    this.chats.push({ connIds, message });
  }
  sendError(connId: string, error: { tableId: string; code: string; message: string }) {
    this.errors.push({ connId, code: error.code });
  }
  sendBalance(userId: string, balance: number) {
    this.balances.push({ userId, balance });
  }
  lastView(connId: string) {
    for (let i = this.states.length - 1; i >= 0; i -= 1) if (this.states[i]!.connId === connId) return this.states[i]!.view;
    return null;
  }
}

export { RuntimeError };
