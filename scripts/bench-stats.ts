/**
 * Times the stats / leaderboard / hand-history reads for one user (dev / scratch databases only).
 *
 *   DATABASE_URL=... npx tsx scripts/bench-stats.ts --user <username> [--runs 7] [--verify] [--explain]
 *
 * Prints the median wall time per call (after one warm-up run). --verify also checks that the SQL stats report
 * equals the (slow) event-log reference report for that user.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../packages/shared/src/db/prisma";
import { listMyHands, listMyTables } from "../packages/shared/src/hands/queries";
import { getLeaderboard } from "../packages/shared/src/stats/leaderboard";
import { Prisma } from "@prisma/client";
import { getMoneyFlow, getMyStats, getPublicStatsSummary, loadStatsRows, rangeStart, statsReportSql } from "../packages/shared/src/stats/queries";
import { computeStatsReport } from "../packages/shared/src/stats/report";

const envFile = resolve(import.meta.dirname ?? ".", "../.env");
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const RUNS = Number(opt("runs") ?? 7);

async function time(label: string, fn: () => Promise<unknown>) {
  await fn();
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    await fn();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  console.log(`${label.padEnd(36)} median ${ms[Math.floor(ms.length / 2)]!.toFixed(1).padStart(7)} ms   min ${ms[0]!.toFixed(1).padStart(7)} ms`);
}

async function main() {
  const username = opt("user") ?? "scale_hero";
  const user = await prisma.user.findUniqueOrThrow({ where: { username }, select: { id: true } });
  const hands = await prisma.handPlayer.count({ where: { userId: user.id } });
  console.log(`User ${username}: ${hands} hands`);
  const firstTable = (await listMyTables(user.id))[0]?.id;
  if (args.includes("--verify")) {
    const sql = (await getMyStats(user.id, "all")).report;
    const ref = computeStatsReport(await loadStatsRows(user.id, null, 10_000_000), user.id);
    const diffs: string[] = [];
    const walk = (a: unknown, b: unknown, path: string) => {
      if (typeof a === "number" && typeof b === "number") {
        if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b))) diffs.push(`${path}: ${a} vs ${b}`);
      } else if (a && b && typeof a === "object" && typeof b === "object") {
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk((a as never)[k], (b as never)[k], `${path}.${k}`);
      } else if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    };
    walk(sql, ref, "report");
    console.log(diffs.length === 0 ? `verify: SQL report == event-log report (${ref.headline.hands} hands)` : `verify: ${diffs.length} differences\n${diffs.slice(0, 20).join("\n")}`);
  }
  if (args.includes("--explain")) {
    const plan = await prisma.$queryRaw<Array<{ "QUERY PLAN": string }>>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${statsReportSql(user.id, null)}`);
    console.log(plan.map((r) => r["QUERY PLAN"]).join("\n"));
  }
  await time("getMyStats all", () => getMyStats(user.id, "all"));
  await time("getMyStats 30d", () => getMyStats(user.id, "30d"));
  await time("getMoneyFlow all", () => getMoneyFlow(user.id, rangeStart("all"), 5));
  await time("getPublicStatsSummary", () => getPublicStatsSummary(user.id));
  for (const metric of ["profit", "bb100", "biggestPot"] as const) {
    for (const period of ["week", "all"] as const) {
      await time(`leaderboard ${metric} ${period}`, () => getLeaderboard({ metric, period, viewerId: user.id, hideSeed: false }));
    }
  }
  await time("listMyHands (page 1)", () => listMyHands(user.id, {}));
  await time("listMyHands table filter", () => listMyHands(user.id, { table: firstTable }));
  await time("listMyHands position+showdown", () => listMyHands(user.id, { position: "CO", showdown: "yes" }));
  await time("listMyHands bomb pots", () => listMyHands(user.id, { bombPot: "yes" }));
  await time("listMyHands hand # search", () => listMyHands(user.id, { q: "#1234" }));
  await time("listMyTables", () => listMyTables(user.id));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
