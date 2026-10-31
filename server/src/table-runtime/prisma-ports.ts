// Production adapters: Postgres through Prisma, the wallet ledger and the shared hand persistence.
// Every chip movement writes the ledger and the LobbyPlayer seat row in the same transaction.
import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { checkCanPlay } from "@poker-platform/shared/accounts";
import { avatarDataUrl } from "@poker-platform/shared/accounts/avatars";
import { prisma } from "@poker-platform/shared/db";
import { persistCompletedHand, recordSidePayments } from "@poker-platform/shared/hands/persist";
import { readStoredTableSettings } from "@poker-platform/shared/lobbies/client";
import * as wallet from "@poker-platform/shared/wallet";
import type { Prisma } from "@prisma/client";
import { RuntimeError } from "./errors";
import type {
  HandAmendment,
  HandRecord,
  HandStorePort,
  LobbyStorePort,
  PlayCheck,
  PlayGatePort,
  Profile,
  SeatedStack,
  TableRecord,
  WalletPort,
} from "./ports";

const scrypt = promisify(scryptCallback);
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;

/** Verifies a table password hashed by packages/shared/src/lobbies/passwords.ts (`scrypt$salt$hex`). */
export async function verifyTablePassword(password: string, passwordHash: string) {
  const [algorithm, salt, storedKey] = passwordHash.split("$");
  if (algorithm !== "scrypt" || !salt || !storedKey) return false;
  const stored = Buffer.from(storedKey, "hex");
  const derived = (await scrypt(password, salt, stored.length)) as Buffer;
  return stored.length === derived.length && timingSafeEqual(stored, derived);
}

const tableSelect = {
  id: true,
  name: true,
  createdByUserId: true,
  settings: true,
  smallBlind: true,
  bigBlind: true,
  minBuyIn: true,
  maxBuyIn: true,
  maxPlayers: true,
  visibility: true,
  passwordHash: true,
  inviteCode: true,
  status: true,
} satisfies Prisma.LobbySelect;

type TableRow = Prisma.LobbyGetPayload<{ select: typeof tableSelect }>;

function toRecord(row: TableRow, lastHandNumber: number): TableRecord {
  return {
    id: row.id,
    name: row.name,
    hostUserId: row.createdByUserId,
    settings: readStoredTableSettings(row.settings, row),
    visibility: row.visibility,
    passwordHash: row.passwordHash,
    inviteCode: row.inviteCode,
    closed: row.status === "CLOSED",
    lastHandNumber,
  };
}

export class PrismaLobbyStore implements LobbyStorePort {
  /**
   * `onlyTableIds` limits boot recovery / reset to those tables. Tests that run against the shared dev
   * database must pass it, or recover() would refund the stacks of tables a running dev server owns.
   */
  constructor(private readonly options: { onlyTableIds?: string[] } = {}) {}

  private scope(): { lobbyId?: { in: string[] } } {
    return this.options.onlyTableIds ? { lobbyId: { in: this.options.onlyTableIds } } : {};
  }

  async loadTable(tableId: string) {
    if (tableId.length > 64) return null;
    const row = await prisma.lobby.findUnique({ where: { id: tableId }, select: tableSelect });
    if (!row) return null;
    const [hands, legacy] = await Promise.all([
      prisma.hand.aggregate({ where: { lobbyId: tableId }, _max: { handNumber: true } }),
      prisma.handHistory.aggregate({ where: { lobbyId: tableId }, _max: { handNumber: true } }),
    ]);
    return toRecord(row, Math.max(hands._max.handNumber ?? 0, legacy._max.handNumber ?? 0));
  }

  async listOpenPublicTables() {
    const rows = await prisma.lobby.findMany({
      where: { visibility: "PUBLIC", status: { not: "CLOSED" } },
      select: tableSelect,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((row) => toRecord(row, 0));
  }

  async isMember(tableId: string, userId: string) {
    const row = await prisma.lobbyPlayer.findUnique({
      where: { lobbyId_userId: { lobbyId: tableId, userId } },
      select: { status: true },
    });
    return row?.status === "JOINED" || row?.status === "SEATED";
  }

  async addMember(tableId: string, userId: string) {
    const existing = await prisma.lobbyPlayer.findUnique({
      where: { lobbyId_userId: { lobbyId: tableId, userId } },
      select: { status: true },
    });
    if (existing?.status === "KICKED") throw new RuntimeError("PLAYER_REMOVED", "You cannot join this table.");
    if (existing?.status === "JOINED" || existing?.status === "SEATED") return;
    await prisma.lobbyPlayer.upsert({
      where: { lobbyId_userId: { lobbyId: tableId, userId } },
      create: { lobbyId: tableId, userId, status: "JOINED", seatNumber: null, chipStack: null },
      update: { status: "JOINED", seatNumber: null, chipStack: null, leftAt: null },
    });
  }

  async getProfiles(userIds: string[]): Promise<Profile[]> {
    if (userIds.length === 0) return [];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, displayName: true, name: true, avatar: true },
    });
    return users.map((user) => {
      const displayName = user.displayName ?? user.username ?? user.name ?? "Player";
      return {
        userId: user.id,
        username: user.username ?? "player",
        displayName,
        avatarUrl: avatarDataUrl(user.avatar, displayName, 64),
      };
    });
  }

  verifyPassword(password: string, passwordHash: string) {
    return verifyTablePassword(password, passwordHash);
  }

  async listSeatedStacks(): Promise<SeatedStack[]> {
    const rows = await prisma.lobbyPlayer.findMany({
      where: { status: "SEATED", chipStack: { gt: 0 }, ...this.scope() },
      select: { lobbyId: true, userId: true, chipStack: true, joinedAt: true },
    });
    return rows.map((row) => ({
      tableId: row.lobbyId,
      userId: row.userId,
      stack: row.chipStack ?? 0,
      refKey: `recover:${row.lobbyId}:${row.userId}:${row.joinedAt.getTime()}`,
    }));
  }

  async closeTable(tableId: string) {
    await prisma.$transaction([
      prisma.lobby.update({ where: { id: tableId }, data: { status: "CLOSED" } }),
      prisma.lobbyPlayer.updateMany({
        where: { lobbyId: tableId, status: { in: ["JOINED", "SEATED"] }, OR: [{ chipStack: null }, { chipStack: 0 }, { status: "JOINED" }] },
        data: { seatNumber: null, chipStack: null },
      }),
    ]);
  }

  async resetTables() {
    await prisma.$transaction([
      // Seats whose chips were refunded (or that never held chips) are released. Seats still holding chips
      // (a failed refund) stay SEATED so the next boot retries them.
      prisma.lobbyPlayer.updateMany({
        where: { status: "SEATED", OR: [{ chipStack: null }, { chipStack: { lte: 0 } }], ...this.scope() },
        data: { status: "JOINED", seatNumber: null, chipStack: null },
      }),
      // Legacy membership rows carried a fake chipStack and a seat number: chips only exist after a buy-in.
      prisma.lobbyPlayer.updateMany({
        where: { status: "JOINED", OR: [{ chipStack: { not: null } }, { seatNumber: { not: null } }], ...this.scope() },
        data: { seatNumber: null, chipStack: null },
      }),
      prisma.lobby.updateMany({
        where: { status: "ACTIVE", ...(this.options.onlyTableIds ? { id: { in: this.options.onlyTableIds } } : {}) },
        data: { status: "WAITING" },
      }),
    ]);
  }
}

function toRuntimeWalletError(error: unknown): never {
  if (error instanceof wallet.WalletError) throw new RuntimeError(error.code, error.message);
  throw error;
}

export class PrismaWallet implements WalletPort {
  getBalance(userId: string) {
    return wallet.getBalance(userId);
  }

  async buyIn(input: { userId: string; tableId: string; seat: number; amount: number; refKey: string }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.lobbyPlayer.findUnique({
          where: { lobbyId_userId: { lobbyId: input.tableId, userId: input.userId } },
          select: { status: true, chipStack: true },
        });
        if (existing?.status === "KICKED") throw new RuntimeError("PLAYER_REMOVED", "You cannot join this table.");
        if (existing?.status === "SEATED" && (existing.chipStack ?? 0) > 0) {
          throw new RuntimeError("RECOVERY_PENDING", "Your previous stack at this table is still being returned.");
        }
        // Legacy/member rows may still hold a seat number: the runtime owns seat numbers now.
        await tx.lobbyPlayer.updateMany({
          where: { lobbyId: input.tableId, seatNumber: input.seat, NOT: { userId: input.userId } },
          data: { seatNumber: null },
        });
        const result = await wallet.buyIn(input.userId, input.tableId, input.amount, input.refKey, tx);
        await tx.lobbyPlayer.upsert({
          where: { lobbyId_userId: { lobbyId: input.tableId, userId: input.userId } },
          create: {
            lobbyId: input.tableId,
            userId: input.userId,
            seatNumber: input.seat,
            chipStack: input.amount,
            status: "SEATED",
          },
          update: { seatNumber: input.seat, chipStack: input.amount, status: "SEATED", leftAt: null, joinedAt: new Date() },
        });
        return result.balance;
      }, TX_OPTIONS);
    } catch (error) {
      toRuntimeWalletError(error);
    }
  }

  async topUp(input: { userId: string; tableId: string; amount: number; newStack: number; refKey: string }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const result = await wallet.rebuy(input.userId, input.tableId, input.amount, input.refKey, tx);
        await tx.lobbyPlayer.update({
          where: { lobbyId_userId: { lobbyId: input.tableId, userId: input.userId } },
          data: { chipStack: input.newStack },
        });
        return result.balance;
      }, TX_OPTIONS);
    } catch (error) {
      toRuntimeWalletError(error);
    }
  }

  async cashOut(input: { userId: string; tableId: string; amount: number; refKey: string; reason: "STAND" | "SHUTDOWN" | "RECOVERY" }) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Claim the seat row first: chips leave the table exactly once, whichever path gets here first
        // (stand, shutdown, or another process's boot recovery). The refKeys of those paths differ, so the
        // ledger's idempotency alone can't stop a double refund; the row update serialises them (a
        // concurrent claimer blocks on the row lock, then sees status JOINED and claims nothing).
        const claimed = await tx.lobbyPlayer.updateMany({
          where: { lobbyId: input.tableId, userId: input.userId, status: "SEATED" },
          data: { status: "JOINED", seatNumber: null, chipStack: null },
        });
        if (claimed.count === 0 || input.amount <= 0) {
          return wallet.getBalance(input.userId, tx);
        }
        const result =
          input.reason === "STAND"
            ? await wallet.cashOut(input.userId, input.tableId, input.amount, input.refKey, tx)
            : await wallet.refund(input.userId, input.tableId, input.amount, input.refKey, { reason: input.reason }, tx);
        return result.duplicate ? wallet.getBalance(input.userId, tx) : result.balance;
      }, TX_OPTIONS);
    } catch (error) {
      toRuntimeWalletError(error);
    }
  }
}

async function writeStacks(
  tx: Prisma.TransactionClient,
  tableId: string,
  stacks: ReadonlyArray<{ userId: string; stack: number }>,
) {
  for (const { userId, stack } of stacks) {
    await tx.lobbyPlayer.updateMany({
      where: { lobbyId: tableId, userId, status: "SEATED" },
      data: { chipStack: stack },
    });
  }
}

export class PrismaHandStore implements HandStorePort {
  async saveHand(record: HandRecord) {
    await prisma.$transaction(async (tx) => {
      await persistCompletedHand(tx, {
        handId: record.handId,
        lobbyId: record.tableId,
        handNumber: record.handNumber,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        summary: record.summary,
        events: record.events,
        sidePayments: record.sidePayments.map(({ reason, fromUserId, toUserId, amount }) => ({
          reason,
          fromUserId,
          toUserId,
          amount,
        })),
        shownPlayerIds: record.shownPlayerIds,
        deckCommitment: record.deckCommitment,
        deckReveal: record.deckReveal,
        positions: record.positions,
      });
      await writeStacks(tx, record.tableId, record.stacks);
    }, TX_OPTIONS);
  }

  async amendHand(amendment: HandAmendment) {
    await prisma.$transaction(async (tx) => {
      if (amendment.handId && (amendment.payments.length > 0 || amendment.shownPlayerIds.length > 0)) {
        await recordSidePayments(tx, {
          handId: amendment.handId,
          payments: amendment.payments.map(({ reason, fromUserId, toUserId, amount }) => ({
            reason,
            fromUserId,
            toUserId,
            amount,
          })),
          shownPlayerIds: amendment.shownPlayerIds,
        });
      }
      await writeStacks(tx, amendment.tableId, amendment.stacks);
    }, TX_OPTIONS);
  }
}

export class PrismaPlayGate implements PlayGatePort {
  async check(userId: string): Promise<PlayCheck> {
    const result = await checkCanPlay(userId);
    return result.ok ? { ok: true } : { ok: false, code: result.code, message: result.message };
  }
}
