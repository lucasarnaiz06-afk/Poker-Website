import { Prisma, type LedgerEntry, type LedgerEntryType } from "@prisma/client";
import { prisma } from "../db/prisma";

/**
 * Play-money wallet. Every balance change is a LedgerEntry written in the same transaction as a
 * conditional UPDATE on User.chipBalance, so:
 *   - the balance can never go negative (WHERE clause + SQL CHECK constraint), even under concurrency;
 *   - each movement is idempotent by `refKey` (unique). Replaying a refKey returns the original entry.
 */

export type TxClient = Prisma.TransactionClient;

export type WalletErrorCode =
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_FUNDS"
  | "USER_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "ALREADY_CLAIMED"
  | "NOT_ELIGIBLE"
  | "ACCOUNT_RESTRICTED";

export class WalletError extends Error {
  constructor(
    public readonly code: WalletErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

export const MAX_SINGLE_MOVEMENT = 1_000_000_000;

export type LedgerWriteInput = {
  userId: string;
  /** Positive whole number of chips. */
  amount: number;
  type: LedgerEntryType;
  /** Idempotency key, unique across the whole ledger (e.g. `buyin:<lobbyId>:<userId>:<seatSessionId>`). */
  refKey: string;
  lobbyId?: string | null;
  meta?: Prisma.InputJsonValue;
};

export type LedgerWriteResult = {
  entry: LedgerEntry;
  /** Wallet balance right after this entry (for duplicates: the balance recorded on the original entry). */
  balance: number;
  /** True when the refKey had already been applied and nothing changed. */
  duplicate: boolean;
};

const CREDIT_TYPES: readonly LedgerEntryType[] = [
  "SIGNUP_BONUS",
  "DAILY_BONUS",
  "REFILL",
  "CASH_OUT",
  "REFUND",
  "ADJUSTMENT",
];
const DEBIT_TYPES: readonly LedgerEntryType[] = ["BUY_IN", "REBUY", "ADJUSTMENT"];

function assertAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_SINGLE_MOVEMENT) {
    throw new WalletError("INVALID_AMOUNT", "Amount must be a positive whole number of chips.");
  }
}

function assertRefKey(refKey: string) {
  if (typeof refKey !== "string" || refKey.length < 3 || refKey.length > 200) {
    throw new WalletError("INVALID_AMOUNT", "A refKey (3-200 chars) is required for every ledger write.");
  }
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function duplicateResult(existing: LedgerEntry, input: LedgerWriteInput, delta: number): LedgerWriteResult {
  if (existing.userId !== input.userId || existing.delta !== delta || existing.type !== input.type) {
    throw new WalletError(
      "IDEMPOTENCY_CONFLICT",
      `refKey ${input.refKey} was already used for a different ledger movement.`,
    );
  }

  return { entry: existing, balance: existing.balanceAfter, duplicate: true };
}

/** Applies one signed movement inside an existing transaction. */
async function applyInTx(tx: TxClient, input: LedgerWriteInput, delta: number): Promise<LedgerWriteResult> {
  const existing = await tx.ledgerEntry.findUnique({ where: { refKey: input.refKey } });

  if (existing) {
    return duplicateResult(existing, input, delta);
  }

  const rows = await tx.$queryRaw<Array<{ chipBalance: number }>>`
    UPDATE "User"
    SET "chipBalance" = "chipBalance" + ${delta}::integer, "updatedAt" = NOW()
    WHERE "id" = ${input.userId} AND "chipBalance" + ${delta}::integer >= 0
    RETURNING "chipBalance"
  `;

  if (rows.length === 0) {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });

    if (!user) {
      throw new WalletError("USER_NOT_FOUND", "User not found.");
    }

    throw new WalletError("INSUFFICIENT_FUNDS", "Not enough chips in your wallet.");
  }

  const balance = Number(rows[0]!.chipBalance);
  const entry = await tx.ledgerEntry.create({
    data: {
      userId: input.userId,
      delta,
      balanceAfter: balance,
      type: input.type,
      lobbyId: input.lobbyId ?? null,
      refKey: input.refKey,
      meta: input.meta ?? {},
    },
  });

  return { entry, balance, duplicate: false };
}

async function applyMovement(input: LedgerWriteInput, delta: number, tx?: TxClient): Promise<LedgerWriteResult> {
  assertAmount(Math.abs(delta));
  assertRefKey(input.refKey);

  if (tx) {
    // Caller owns the transaction: a concurrent duplicate refKey surfaces as a P2002 error to the caller.
    return applyInTx(tx, input, delta);
  }

  try {
    return await prisma.$transaction((innerTx) => applyInTx(innerTx, input, delta));
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Lost a race with a concurrent write using the same refKey: return the winner.
      const existing = await prisma.ledgerEntry.findUnique({ where: { refKey: input.refKey } });

      if (existing) {
        return duplicateResult(existing, input, delta);
      }
    }

    throw error;
  }
}

/** Adds chips. Pass `tx` to join an existing transaction. */
export async function credit(input: LedgerWriteInput, tx?: TxClient): Promise<LedgerWriteResult> {
  if (!CREDIT_TYPES.includes(input.type)) {
    throw new WalletError("INVALID_AMOUNT", `${input.type} is not a credit type.`);
  }

  assertAmount(input.amount);
  return applyMovement(input, input.amount, tx);
}

/** Removes chips; throws WalletError("INSUFFICIENT_FUNDS") rather than going negative. */
export async function debit(input: LedgerWriteInput, tx?: TxClient): Promise<LedgerWriteResult> {
  if (!DEBIT_TYPES.includes(input.type)) {
    throw new WalletError("INVALID_AMOUNT", `${input.type} is not a debit type.`);
  }

  assertAmount(input.amount);
  return applyMovement(input, -input.amount, tx);
}

export async function getBalance(userId: string, tx?: TxClient): Promise<number> {
  const user = await (tx ?? prisma).user.findUnique({ where: { id: userId }, select: { chipBalance: true } });

  if (!user) {
    throw new WalletError("USER_NOT_FOUND", "User not found.");
  }

  return user.chipBalance;
}

// ---------------------------------------------------------------------------
// Game-server API
// ---------------------------------------------------------------------------

/** Wallet -> table. refKey must be unique per buy-in (e.g. `buyin:<lobbyId>:<userId>:<nonce>`). */
export function buyIn(userId: string, lobbyId: string, amount: number, refKey: string, tx?: TxClient) {
  return debit({ userId, lobbyId, amount, type: "BUY_IN", refKey }, tx);
}

/** Wallet -> table top-up while seated. */
export function rebuy(userId: string, lobbyId: string, amount: number, refKey: string, tx?: TxClient) {
  return debit({ userId, lobbyId, amount, type: "REBUY", refKey }, tx);
}

/** Table -> wallet when leaving (amount = stack at the last completed hand boundary). */
export function cashOut(userId: string, lobbyId: string, amount: number, refKey: string, tx?: TxClient) {
  return credit({ userId, lobbyId, amount, type: "CASH_OUT", refKey }, tx);
}

/** Returns chips to a wallet when a buy-in/hand is voided (e.g. table closed, server crash recovery). */
export function refund(
  userId: string,
  lobbyId: string | null,
  amount: number,
  refKey: string,
  meta?: Prisma.InputJsonValue,
  tx?: TxClient,
) {
  return credit({ userId, lobbyId, amount, type: "REFUND", refKey, meta }, tx);
}

/** Admin adjustment (positive or negative delta). Writes an audit row too. */
export async function adjustBalance(input: {
  userId: string;
  delta: number;
  reason: string;
  refKey: string;
  actorUserId: string | null;
}): Promise<LedgerWriteResult> {
  const movement: LedgerWriteInput = {
    userId: input.userId,
    amount: Math.abs(input.delta),
    type: "ADJUSTMENT",
    refKey: input.refKey,
    meta: { reason: input.reason, actorUserId: input.actorUserId },
  };

  return prisma.$transaction(async (tx) => {
    const result = input.delta >= 0 ? await credit(movement, tx) : await debit(movement, tx);

    if (!result.duplicate) {
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: "wallet.adjustment",
          meta: { delta: input.delta, reason: input.reason, actorUserId: input.actorUserId, refKey: input.refKey },
        },
      });
    }

    return result;
  });
}

export type LedgerPage = {
  entries: LedgerEntry[];
  nextCursor: string | null;
};

/** Newest first. `cursor` is the id of the last entry of the previous page. */
export async function listLedger(
  userId: string,
  options: { cursor?: string | null; take?: number } = {},
): Promise<LedgerPage> {
  const take = Math.min(Math.max(options.take ?? 25, 1), 100);
  const entries = await prisma.ledgerEntry.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = entries.length > take;
  const page = hasMore ? entries.slice(0, take) : entries;

  return { entries: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
}

/** Chips currently sitting on tables (active lobby seats). */
export async function getChipsOnTables(userId: string, tx?: TxClient): Promise<number> {
  const result = await (tx ?? prisma).lobbyPlayer.aggregate({
    where: { userId, status: { in: ["JOINED", "SEATED"] }, leftAt: null },
    _sum: { chipStack: true },
  });

  return result._sum.chipStack ?? 0;
}
