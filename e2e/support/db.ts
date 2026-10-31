// Direct DB reads for assertions only (balances, ledger, hands). Tests never write game state here.
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../../.env") });

let client: PrismaClient | null = null;
export function db() {
  client ??= new PrismaClient();
  return client;
}

export async function userIdFor(username: string) {
  const user = await db().user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
  if (!user) throw new Error(`No user ${username}`);
  return user.id;
}

export async function walletBalance(username: string) {
  const user = await db().user.findUnique({ where: { username: username.toLowerCase() }, select: { chipBalance: true } });
  if (!user) throw new Error(`No user ${username}`);
  return user.chipBalance;
}

const GRANT_TYPES = ["SIGNUP_BONUS", "DAILY_BONUS", "REFILL", "ADJUSTMENT"] as const;

/**
 * Chip conservation for a set of users: wallet balances + chips persisted on tables must equal every chip
 * ever granted to them (signup/daily/refill/admin). Only meaningful at a hand boundary or after cash-out.
 */
export async function chipAudit(usernames: string[]) {
  const users = await db().user.findMany({
    where: { username: { in: usernames.map((u) => u.toLowerCase()) } },
    select: { id: true, username: true, chipBalance: true },
  });
  if (users.length !== usernames.length) throw new Error(`Expected ${usernames.length} users, found ${users.length}`);
  const ids = users.map((u) => u.id);
  const [grants, onTables] = await Promise.all([
    db().ledgerEntry.aggregate({ where: { userId: { in: ids }, type: { in: [...GRANT_TYPES] } }, _sum: { delta: true } }),
    db().lobbyPlayer.aggregate({
      where: { userId: { in: ids }, status: { in: ["JOINED", "SEATED"] }, leftAt: null },
      _sum: { chipStack: true },
    }),
  ]);
  const wallets = users.reduce((sum, u) => sum + u.chipBalance, 0);
  return {
    granted: grants._sum.delta ?? 0,
    wallets,
    onTables: onTables._sum.chipStack ?? 0,
    byUser: Object.fromEntries(users.map((u) => [u.username, u.chipBalance])),
  };
}
