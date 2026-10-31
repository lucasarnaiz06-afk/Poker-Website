// Debug helper: npx tsx e2e/scripts/ledger.ts <username...> prints each user's ledger.
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../../.env") });
const db = new PrismaClient();
async function main() {
  for (const n of process.argv.slice(2)) {
    const u = await db.user.findUnique({ where: { username: n }, select: { id: true, chipBalance: true } });
    if (!u) continue;
    const rows = await db.ledgerEntry.findMany({ where: { userId: u.id }, orderBy: { createdAt: "asc" } });
    console.log(n, u.chipBalance);
    for (const r of rows) console.log("  ", r.createdAt.toISOString(), r.type, r.delta, r.balanceAfter, r.refKey, JSON.stringify(r.meta));
    const lp = await db.lobbyPlayer.findMany({ where: { userId: u.id } });
    console.log("   lobbyPlayer", JSON.stringify(lp));
  }
}
main().finally(() => db.$disconnect());
