/**
 * Backfills the event-derived HandPlayer stat columns (3-bet / c-bet / fold-to / AF counters, starting-hand class)
 * for hands persisted before they existed. Safe to rerun and resumable: rows already at the current
 * HAND_PLAYER_STATS_VERSION are skipped; `--after <handId>` restarts from a printed cursor.
 * (PlayerDailyStat.netCentiBB / bombPotHands and PlayerOpponentDaily were backfilled by the
 * 20261029180000_stats_aggregates migration.)
 *
 *   npx tsx scripts/backfill-hand-stats.ts [--batch 500] [--after <handId>]
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../packages/shared/src/db/prisma";
import { backfillHandPlayerStats } from "../packages/shared/src/stats/backfill";

const envFile = resolve(import.meta.dirname ?? ".", "../.env");
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const started = Date.now();
  const result = await backfillHandPlayerStats({
    batchSize: Number(opt("batch") ?? 500),
    after: opt("after") ?? null,
    onBatch: (p) => process.stdout.write(`\r${p.hands} hands / ${p.rows} rows updated (cursor ${p.cursor})`),
  });
  console.log(`\nDone: ${result.hands} hands, ${result.rows} rows in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
