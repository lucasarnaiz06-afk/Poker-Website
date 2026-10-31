// Leaderboards from PlayerDailyStat only (profit, bb/100, hands, biggest pot, showdown wins); the biggest-pot hand
// link is looked up per ranked player via HandPlayer(userId, won).
// Ties share a rank (RANK()); the viewer's own row is returned even outside the top N.
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { BB100_MIN_HANDS } from "./definitions";

export const LEADERBOARD_METRICS = ["profit", "bb100", "hands", "biggestPot", "showdownWins"] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];
export const LEADERBOARD_PERIODS = ["today", "week", "month", "all"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export const LEADERBOARD_METRIC_LABEL: Record<LeaderboardMetric, string> = {
  profit: "Profit",
  bb100: "bb/100",
  hands: "Hands played",
  biggestPot: "Biggest pot",
  showdownWins: "Showdown wins",
};

export const LEADERBOARD_PERIOD_LABEL: Record<LeaderboardPeriod, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  all: "All time",
};

export function parseLeaderboardMetric(value: unknown): LeaderboardMetric {
  const raw = Array.isArray(value) ? value[0] : value;
  return (LEADERBOARD_METRICS as readonly string[]).includes(raw as string) ? (raw as LeaderboardMetric) : "profit";
}

export function parseLeaderboardPeriod(value: unknown): LeaderboardPeriod {
  const raw = Array.isArray(value) ? value[0] : value;
  return (LEADERBOARD_PERIODS as readonly string[]).includes(raw as string) ? (raw as LeaderboardPeriod) : "week";
}

/** First UTC day of the period ("YYYY-MM-DD"), null for all time. Weeks start on Monday. */
export function periodStartDay(period: LeaderboardPeriod, now = new Date()): string | null {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "all") return null;
  if (period === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (period === "month") d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

export type LeaderboardRow = {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  /** Metric value: chips (profit, biggest pot), hands, showdown wins, or bb/100 (float). */
  value: number;
  hands: number;
  isViewer: boolean;
  /** Biggest pot: the hand it was won in. */
  handId: string | null;
};

export type Leaderboard = {
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  rows: LeaderboardRow[];
  /** The viewer's row when ranked (also when inside rows). */
  viewer: LeaderboardRow | null;
  /** Number of ranked players. */
  total: number;
  minHands: number;
};

/** Seed users (username "seed_*") are hidden in production unless LEADERBOARD_INCLUDE_SEED_USERS=true. */
export function hideSeedUsers(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" && env.LEADERBOARD_INCLUDE_SEED_USERS !== "true";
}

type RawRow = { userId: string; value: number; hands: number; rank: number; total: number; username: string; displayName: string | null; avatar: string | null };

export async function getLeaderboard(input: {
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  viewerId?: string | null;
  limit?: number;
  now?: Date;
  hideSeed?: boolean;
}): Promise<Leaderboard> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const start = periodStartDay(input.period, input.now);
  const viewerId = input.viewerId ?? "";
  const seedFilter = (input.hideSeed ?? hideSeedUsers()) ? Prisma.sql`AND u."username" NOT LIKE 'seed\\_%'` : Prisma.empty;
  const minHands = input.metric === "bb100" ? BB100_MIN_HANDS : 1;

  // Everything comes from PlayerDailyStat (one row per player and UTC day): bb/100 = SUM(netCentiBB) / hands.
  const expr =
    input.metric === "profit"
      ? Prisma.sql`SUM(s."net")::float8`
      : input.metric === "bb100"
        ? Prisma.sql`SUM(s."netCentiBB")::float8 / NULLIF(SUM(s."hands"), 0)`
        : input.metric === "hands"
          ? Prisma.sql`SUM(s."hands")::float8`
          : input.metric === "biggestPot"
            ? Prisma.sql`MAX(s."biggestPotWon")::float8`
            : Prisma.sql`SUM(s."showdownsWon")::float8`;
  const since = start ? Prisma.sql`WHERE s."day" >= ${start}` : Prisma.empty;
  const having =
    input.metric === "profit"
      ? Prisma.sql`HAVING SUM(s."hands") > 0`
      : input.metric === "bb100"
        ? Prisma.sql`HAVING SUM(s."hands") >= ${BB100_MIN_HANDS}`
        : Prisma.sql`HAVING ${expr} > 0`;
  const agg = Prisma.sql`
    SELECT s."userId", ${expr} AS value, SUM(s."hands")::int AS hands
    FROM "PlayerDailyStat" s
    ${since}
    GROUP BY s."userId"
    ${having}`;

  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH agg AS (${agg}),
    ranked AS (
      SELECT a."userId", a.value, a.hands,
             RANK() OVER (ORDER BY a.value DESC)::int AS rank,
             COUNT(*) OVER ()::int AS total,
             u."username", u."displayName", u."avatar"
      FROM agg a
      JOIN "User" u ON u."id" = a."userId"
      WHERE u."status" = 'ACTIVE' AND u."deletedAt" IS NULL AND u."username" IS NOT NULL ${seedFilter}
    )
    SELECT * FROM ranked
    WHERE rank <= ${limit} OR "userId" = ${viewerId}
    ORDER BY rank ASC, hands DESC, "username" ASC`;

  let handIds = new Map<string, string>();
  if (input.metric === "biggestPot" && rows.length > 0) {
    const since = start ? new Date(`${start}T00:00:00.000Z`) : new Date(0);
    const found = await prisma.handPlayer.findMany({
      where: { OR: rows.map((r) => ({ userId: r.userId, won: Math.round(r.value), createdAt: { gte: since } })) },
      orderBy: { createdAt: "desc" },
      select: { userId: true, handId: true },
    });
    handIds = new Map();
    for (const f of found) if (!handIds.has(f.userId)) handIds.set(f.userId, f.handId);
  }

  const mapped: LeaderboardRow[] = rows.map((r) => ({
    rank: r.rank,
    userId: r.userId,
    username: r.username,
    displayName: r.displayName ?? r.username,
    avatar: r.avatar,
    value: input.metric === "bb100" ? r.value : Math.round(r.value),
    hands: r.hands,
    isViewer: r.userId === viewerId,
    handId: handIds.get(r.userId) ?? null,
  }));
  const viewer = mapped.find((r) => r.isViewer) ?? null;
  return {
    metric: input.metric,
    period: input.period,
    rows: mapped.filter((r) => r.rank <= limit),
    viewer,
    total: rows[0]?.total ?? 0,
    minHands,
  };
}
