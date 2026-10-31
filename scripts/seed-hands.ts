/**
 * Dev seed: plays a few hundred realistic hands with the engine and simple bot policies between the existing
 * dev users and a few seed users ("seed_*"), and writes Hand / HandPlayer / PlayerDailyStat exactly as the
 * table runtime does (persistCompletedHand). Never touches wallets or the ledger.
 *
 *   npx tsx scripts/seed-hands.ts                 # ~600 hands over the last 30 days
 *   npx tsx scripts/seed-hands.ts --hands 1500 --seed 42
 *   npx tsx scripts/seed-hands.ts --reset         # delete previously seeded hands first
 *   npx tsx scripts/seed-hands.ts --reset --hands 0   # only delete them (e.g. after a --hands 20000 scale test)
 *
 * Refuses to run with NODE_ENV=production or a non-local DATABASE_URL (pass --force to override the latter).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { HandSummary, Variant } from "@poker-platform/engine";
import { prisma } from "../packages/shared/src/db/prisma";
import { createDeckReveal, deckRevealCommitment } from "../packages/shared/src/hands/deck-proof-node";
import { BOT_STYLES, playBotHand, seededRandom, type BotStyle } from "../packages/shared/src/hands/bots";
import { persistCompletedHand, type PersistSidePayment } from "../packages/shared/src/hands/persist";
import { rebuildDailyAggregates } from "../packages/shared/src/stats/backfill";

const envFile = resolve(import.meta.dirname ?? ".", "../.env");
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
function flag(name: string) {
  return args.includes(`--${name}`);
}
function option(name: string, fallback: number) {
  const i = args.indexOf(`--${name}`);
  const value = i >= 0 ? Number(args[i + 1]) : Number.NaN;
  return Number.isFinite(value) ? value : fallback;
}

const TARGET_HANDS = option("hands", 600);
const SEED = option("seed", Date.now() % 1_000_000);
const rng = seededRandom(SEED);

const SEED_USERS: Array<{ username: string; displayName: string; style: keyof typeof BOT_STYLES; avatar: string }> = [
  { username: "seed_ace", displayName: "Seed Ace", style: "tag", avatar: "g03" },
  { username: "seed_rock", displayName: "Seed Rocky", style: "rock", avatar: "g08" },
  { username: "seed_lagger", displayName: "Seed Lucy", style: "lag", avatar: "g12" },
  { username: "seed_station", displayName: "Seed Callum", style: "station", avatar: "g15" },
  { username: "seed_maniac", displayName: "Seed Max", style: "maniac", avatar: "g06" },
  { username: "seed_grinder", displayName: "Seed Grace", style: "tag", avatar: "g10" },
];

type TableDef = {
  name: string;
  variant: Variant;
  sb: number;
  bb: number;
  maxPlayers: number;
  bombEvery: number | null;
  bountyBB: number | null;
  nitPenaltyBB: number | null;
  runItTwice: boolean;
  weight: number;
};

const TABLES: TableDef[] = [
  { name: "Seed · Main Street 5/10", variant: "NLHE", sb: 5, bb: 10, maxPlayers: 6, bombEvery: null, bountyBB: null, nitPenaltyBB: null, runItTwice: true, weight: 0.45 },
  { name: "Seed · Home Game 10/20", variant: "NLHE", sb: 10, bb: 20, maxPlayers: 9, bombEvery: 10, bountyBB: 5, nitPenaltyBB: 3, runItTwice: true, weight: 0.4 },
  { name: "Seed · Omaha Night 25/50", variant: "PLO", sb: 25, bb: 50, maxPlayers: 6, bombEvery: null, bountyBB: null, nitPenaltyBB: null, runItTwice: false, weight: 0.15 },
];

function assertSafeDatabase() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed hands with NODE_ENV=production.");
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && !flag("force")) {
    throw new Error(`Refusing to seed a non-local database (${host || "unknown host"}). Pass --force to override.`);
  }
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)]!;
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

async function ensureSeedUsers() {
  const users = [];
  for (const u of SEED_USERS) {
    const user = await prisma.user.upsert({
      where: { username: u.username },
      create: {
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar,
        bio: "Seed bot used for local development.",
        createdAt: new Date(Date.now() - (40 + Math.floor(rng.next() * 60)) * 86_400_000),
      },
      update: { displayName: u.displayName },
      select: { id: true, username: true },
    });
    users.push({ id: user.id, username: user.username!, style: BOT_STYLES[u.style]! });
  }
  return users;
}

async function resetSeedHands() {
  const lobbies = await prisma.lobby.findMany({ where: { name: { in: TABLES.map((t) => t.name) } }, select: { id: true } });
  const lobbyIds = lobbies.map((l) => l.id);
  const affected = await prisma.handPlayer.findMany({ where: { hand: { lobbyId: { in: lobbyIds } } }, distinct: ["userId"], select: { userId: true } });
  await prisma.hand.deleteMany({ where: { lobbyId: { in: lobbyIds } } });
  const userIds = affected.map((a) => a.userId);
  // Rebuild daily stats and money flow for those users from the hands that remain.
  await prisma.$transaction((tx) => rebuildDailyAggregates(tx, userIds), { timeout: 120_000 });
  console.log(`Removed seeded hands from ${lobbyIds.length} table(s); rebuilt daily stats for ${userIds.length} user(s).`);
}

async function ensureTables(ownerId: string) {
  const out = [];
  for (const t of TABLES) {
    const existing = await prisma.lobby.findFirst({ where: { name: t.name }, select: { id: true } });
    const lobby =
      existing ??
      (await prisma.lobby.create({
        data: {
          name: t.name,
          visibility: "PRIVATE",
          status: "CLOSED",
          smallBlind: t.sb,
          bigBlind: t.bb,
          minBuyIn: t.bb * 40,
          maxBuyIn: t.bb * 200,
          maxPlayers: t.maxPlayers,
          createdByUserId: ownerId,
        },
        select: { id: true },
      }));
    const last = await prisma.hand.aggregate({ where: { lobbyId: lobby.id }, _max: { handNumber: true } });
    out.push({ ...t, id: lobby.id, nextHand: (last._max.handNumber ?? 0) + 1 });
  }
  return out;
}

type Seat = { id: string; seat: number; stack: number; style: BotStyle };

function isSevenDeuce(cards: readonly string[]) {
  return cards.length === 2 && cards.map((c) => c[0]).sort().join("") === "27";
}

function bountyPayments(summary: HandSummary, bounty: number, stacks: Map<string, number>): { payments: PersistSidePayment[]; shown: string[] } {
  const winner = summary.players.find((p) => p.won > 0 && isSevenDeuce(p.holeCards));
  if (!winner) return { payments: [], shown: [] };
  const payments: PersistSidePayment[] = [];
  for (const p of summary.players) {
    if (p.id === winner.id) continue;
    const amount = Math.min(bounty, stacks.get(p.id) ?? 0);
    if (amount <= 0) continue;
    payments.push({ reason: "BOUNTY_7_2", fromUserId: p.id, toUserId: winner.id, amount });
    stacks.set(p.id, (stacks.get(p.id) ?? 0) - amount);
    stacks.set(winner.id, (stacks.get(winner.id) ?? 0) + amount);
  }
  return { payments, shown: winner.mustShow ? [] : [winner.id] };
}

async function main() {
  assertSafeDatabase();
  if (flag("reset")) await resetSeedHands();
  const seedUsers = await ensureSeedUsers();
  const devUsers = await prisma.user.findMany({
    where: { username: { not: null }, NOT: { username: { startsWith: "seed_" } }, status: "ACTIVE", deletedAt: null },
    select: { id: true, username: true },
    take: 6,
  });
  const devStyles = [BOT_STYLES.tag!, BOT_STYLES.lag!, BOT_STYLES.station!, BOT_STYLES.rock!];
  const pool = [
    ...devUsers.map((u, i) => ({ id: u.id, username: u.username!, style: devStyles[i % devStyles.length]!, dev: true })),
    ...seedUsers.map((u) => ({ ...u, dev: false })),
  ];
  const tables = await ensureTables(seedUsers[0]!.id);
  console.log(`Seeding ~${TARGET_HANDS} hands (seed ${SEED}) for ${devUsers.length} dev user(s): ${devUsers.map((u) => u.username).join(", ") || "none"}`);

  let written = 0;
  const now = Date.now();
  // Sessions spread over the last 30 days, oldest first.
  const sessionCount = Math.max(4, Math.round(TARGET_HANDS / 40));
  const starts = Array.from({ length: sessionCount }, () => now - Math.floor(rng.next() * 30 * 86_400_000)).sort((a, b) => a - b);

  for (let s = 0; s < sessionCount && written < TARGET_HANDS; s++) {
    const r = rng.next();
    const table = r < tables[0]!.weight ? tables[0]! : r < tables[0]!.weight + tables[1]!.weight ? tables[1]! : tables[2]!;
    const dev = pool.filter((p) => p.dev);
    const others = shuffle(pool.filter((p) => !p.dev));
    const count = Math.min(table.maxPlayers, 2 + Math.floor(rng.next() * (table.maxPlayers - 1)));
    const chosen = [...dev.filter(() => rng.next() < 0.85), ...others].slice(0, Math.max(2, count));
    const seats: Seat[] = chosen.map((p, i) => ({ id: p.id, seat: i + 1, stack: table.bb * 100, style: p.style }));
    let button = 1 + Math.floor(rng.next() * seats.length);
    let t = Math.min(starts[s]!, now - 3_600_000);
    const handsThisSession = Math.min(TARGET_HANDS - written, 20 + Math.floor(rng.next() * 40));
    let nits: Set<string> | null = null;

    for (let h = 0; h < handsThisSession; h++) {
      for (const seat of seats) if (seat.stack < table.bb * 30) seat.stack = table.bb * 100; // auto top-up (simulation only)
      button = seats[(seats.findIndex((x) => x.seat === button) + 1) % seats.length]!.seat;
      const bomb = table.bombEvery !== null && table.nextHand % table.bombEvery === 0;
      if (table.nitPenaltyBB && !nits && rng.next() < 0.03) nits = new Set(seats.map((x) => x.id));
      const result = playBotHand(
        {
          handId: null,
          variant: table.variant,
          players: seats.map((x) => ({ id: x.id, seat: x.seat, stack: x.stack })),
          buttonSeat: button,
          smallBlind: table.sb,
          bigBlind: table.bb,
          bombPot: bomb ? { ante: table.bb * 2, doubleBoard: rng.next() < 0.4 } : null,
          runItTwice: table.runItTwice,
        },
        new Map(seats.map((x) => [x.id, x.style])),
        rng,
      );
      const summary = result.summary;
      const stacks = new Map(summary.players.map((p) => [p.id, p.endingStack]));
      const sidePayments: PersistSidePayment[] = [];
      const shown = new Set(result.voluntaryShows);
      if (table.bountyBB) {
        const bounty = bountyPayments(summary, table.bountyBB * table.bb, stacks);
        sidePayments.push(...bounty.payments);
        bounty.shown.forEach((id) => shown.add(id));
      }
      if (nits) {
        for (const p of summary.players) if (p.won > 0) nits.delete(p.id);
        if (nits.size === 1) {
          const payer = [...nits][0]!;
          for (const p of summary.players) {
            if (p.id === payer) continue;
            const amount = Math.min(table.nitPenaltyBB! * table.bb, stacks.get(payer) ?? 0);
            if (amount <= 0) break;
            sidePayments.push({ reason: "NIT_GAME", fromUserId: payer, toUserId: p.id, amount });
            stacks.set(payer, stacks.get(payer)! - amount);
            stacks.set(p.id, stacks.get(p.id)! + amount);
          }
          nits = null;
        } else if (nits.size === 0) nits = null;
      }

      const startedAt = new Date(t);
      t += 35_000 + Math.floor(rng.next() * 60_000);
      const endedAt = new Date(t);
      const reveal = createDeckReveal(result.deck);
      await prisma.$transaction((tx) =>
        persistCompletedHand(tx, {
          lobbyId: table.id,
          handNumber: table.nextHand,
          startedAt,
          endedAt,
          summary,
          events: result.events,
          sidePayments,
          shownPlayerIds: [...shown],
          deckCommitment: deckRevealCommitment(reveal),
          deckReveal: reveal,
        }),
      );
      table.nextHand++;
      written++;
      for (const seat of seats) seat.stack = stacks.get(seat.id) ?? seat.stack;
    }
    process.stdout.write(`\r${written} hands written`);
  }
  console.log(`\nDone: ${written} hands across ${tables.length} seed tables.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
