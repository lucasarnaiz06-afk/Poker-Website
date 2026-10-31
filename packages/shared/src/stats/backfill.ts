// Fills the event-derived HandPlayer stat columns for rows written before they existed (statsVersion below
// HAND_PLAYER_STATS_VERSION). Resumable: finished rows are marked with the current version, so a rerun (or
// `after` = the last printed cursor) continues where it stopped. Run with scripts/backfill-hand-stats.ts.
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { HAND_PLAYER_STATS_VERSION, handPlayerStatColumns, type HandPlayerStatColumns } from "./hand-player-stats";

export type BackfillProgress = { hands: number; rows: number; cursor: string | null };

export async function backfillHandPlayerStats(
  options: { batchSize?: number; after?: string | null; onBatch?: (progress: BackfillProgress) => void } = {},
): Promise<BackfillProgress> {
  const batchSize = Math.min(Math.max(options.batchSize ?? 500, 1), 5000);
  const progress: BackfillProgress = { hands: 0, rows: 0, cursor: options.after ?? null };
  for (;;) {
    const after = progress.cursor ? Prisma.sql`AND hp."handId" > ${progress.cursor}` : Prisma.empty;
    const pending = await prisma.$queryRaw<Array<{ handId: string }>>`
      SELECT DISTINCT hp."handId" FROM "HandPlayer" hp
      WHERE hp."statsVersion" < ${HAND_PLAYER_STATS_VERSION} ${after}
      ORDER BY hp."handId" ASC
      LIMIT ${batchSize}`;
    if (pending.length === 0) return progress;
    const hands = await prisma.hand.findMany({
      where: { id: { in: pending.map((p) => p.handId) } },
      select: { id: true, events: true, isBombPot: true, variant: true, players: { select: { id: true, userId: true, holeCards: true } } },
    });
    const updates: Array<HandPlayerStatColumns & { id: string }> = [];
    for (const hand of hands) {
      const events = Array.isArray(hand.events) ? (hand.events as unknown[]) : [];
      const players = hand.players.map((p) => ({
        id: p.id,
        userId: p.userId,
        holeCards: Array.isArray(p.holeCards) ? (p.holeCards as unknown[]).filter((c): c is string => typeof c === "string") : [],
      }));
      const columns = handPlayerStatColumns(events, { isBombPot: hand.isBombPot, variant: hand.variant }, players);
      for (const p of players) updates.push({ id: p.id, ...columns.get(p.userId)! });
    }
    const col = <K extends keyof (typeof updates)[number]>(key: K) => updates.map((u) => u[key]);
    await prisma.$executeRaw`
      UPDATE "HandPlayer" hp SET
        "statsVersion" = v."statsVersion", "preflopActed" = v."preflopActed", "limp" = v."limp", "threeBetOpp" = v."threeBetOpp",
        "facedThreeBet" = v."facedThreeBet", "foldedToThreeBet" = v."foldedToThreeBet", "cbetOpp" = v."cbetOpp", "cbet" = v."cbet",
        "facedCbet" = v."facedCbet", "foldedToCbet" = v."foldedToCbet", "postflopAggr" = v."postflopAggr",
        "postflopCalls" = v."postflopCalls", "handClass" = v."handClass"
      FROM unnest(${col("id")}::text[], ${col("statsVersion")}::int[], ${col("preflopActed")}::boolean[], ${col("limp")}::boolean[],
                  ${col("threeBetOpp")}::boolean[], ${col("facedThreeBet")}::boolean[], ${col("foldedToThreeBet")}::boolean[],
                  ${col("cbetOpp")}::boolean[], ${col("cbet")}::boolean[], ${col("facedCbet")}::boolean[], ${col("foldedToCbet")}::boolean[],
                  ${col("postflopAggr")}::int[], ${col("postflopCalls")}::int[], ${col("handClass")}::text[])
        AS v("id", "statsVersion", "preflopActed", "limp", "threeBetOpp", "facedThreeBet", "foldedToThreeBet", "cbetOpp", "cbet",
             "facedCbet", "foldedToCbet", "postflopAggr", "postflopCalls", "handClass")
      WHERE hp."id" = v."id"`;
    progress.hands += hands.length;
    progress.rows += updates.length;
    progress.cursor = pending[pending.length - 1]!.handId;
    options.onBatch?.({ ...progress });
  }
}

/**
 * Rebuilds PlayerDailyStat and PlayerOpponentDaily of `userIds` from their remaining HandPlayer rows (after hands
 * were deleted, e.g. the dev seed's --reset). Side payments to players who were not dealt in are not recoverable
 * from HandPlayer and are dropped.
 */
export async function rebuildDailyAggregates(tx: Prisma.TransactionClient, userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;
  const ids = [...userIds];
  await tx.playerDailyStat.deleteMany({ where: { userId: { in: ids } } });
  await tx.playerOpponentDaily.deleteMany({ where: { OR: [{ userId: { in: ids } }, { opponentId: { in: ids } }] } });
  await tx.$executeRaw`
    INSERT INTO "PlayerDailyStat" ("userId", "day", "hands", "net", "vpipHands", "pfrHands", "showdowns", "showdownsWon",
                                   "biggestPotWon", "netCentiBB", "bombPotHands")
    SELECT hp."userId", to_char(hp."createdAt", 'YYYY-MM-DD'), COUNT(*), SUM(hp."net"),
           COUNT(*) FILTER (WHERE hp."vpip"), COUNT(*) FILTER (WHERE hp."pfr"),
           COUNT(*) FILTER (WHERE hp."wentToShowdown"), COUNT(*) FILTER (WHERE hp."wonAtShowdown"), MAX(hp."won"),
           SUM(floor(hp."net" * 100.0 / GREATEST(h."bigBlind", 1) + 0.5))::int, COUNT(*) FILTER (WHERE h."isBombPot")
    FROM "HandPlayer" hp JOIN "Hand" h ON h."id" = hp."handId"
    WHERE hp."userId" = ANY(${ids}::text[])
    GROUP BY 1, 2`;
  await tx.$executeRaw`
    INSERT INTO "PlayerOpponentDaily" ("userId", "opponentId", "day", "hands", "flow", "flowBB")
    SELECT f."userId", f."opponentId", f.day, COUNT(*)::int, SUM(f.flow), SUM(f.flow / f.bb)
    FROM (
      SELECT m."userId", o."userId" AS "opponentId", to_char(m."createdAt", 'YYYY-MM-DD') AS day,
             GREATEST(h."bigBlind", 1)::float8 AS bb,
             CASE
               WHEN m."net" > 0 AND o."net" < 0 AND t.losses > 0 THEN m."net"::float8 * (-o."net") / t.losses
               WHEN m."net" < 0 AND o."net" > 0 AND t.wins > 0 THEN m."net"::float8 * o."net" / t.wins
               ELSE 0
             END AS flow
      FROM "HandPlayer" m
      JOIN "HandPlayer" o ON o."handId" = m."handId" AND o."userId" <> m."userId"
      JOIN (
        SELECT x."handId", SUM(GREATEST(x."net", 0))::float8 AS wins, SUM(GREATEST(-x."net", 0))::float8 AS losses
        FROM "HandPlayer" x
        WHERE x."handId" IN (SELECT y."handId" FROM "HandPlayer" y WHERE y."userId" = ANY(${ids}::text[]))
        GROUP BY x."handId"
      ) t ON t."handId" = m."handId"
      JOIN "Hand" h ON h."id" = m."handId"
      WHERE m."userId" = ANY(${ids}::text[]) OR o."userId" = ANY(${ids}::text[])
    ) f
    GROUP BY 1, 2, 3`;
}
