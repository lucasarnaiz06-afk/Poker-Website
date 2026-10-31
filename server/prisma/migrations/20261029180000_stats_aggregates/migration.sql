-- Stats at scale: per-hand stat columns on HandPlayer, bb/100 + bomb pot counters on PlayerDailyStat,
-- per-day money flow between players, and indexes for the hot history / stats / leaderboard reads.
-- Event-derived HandPlayer columns (statsVersion = 0 here) are filled by scripts/backfill-hand-stats.ts.

-- DropIndex
DROP INDEX "HandPlayer_userId_createdAt_idx";

-- AlterTable
ALTER TABLE "HandPlayer" ADD COLUMN     "cbet" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cbetOpp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "facedCbet" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "facedThreeBet" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "foldedToCbet" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "foldedToThreeBet" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "handClass" TEXT,
ADD COLUMN     "limp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "postflopAggr" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "postflopCalls" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "preflopActed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "statsVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "threeBetOpp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PlayerDailyStat" ADD COLUMN     "bombPotHands" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "netCentiBB" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PlayerOpponentDaily" (
    "userId" TEXT NOT NULL,
    "opponentId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "hands" INTEGER NOT NULL DEFAULT 0,
    "flow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "flowBB" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "PlayerOpponentDaily_pkey" PRIMARY KEY ("userId","day","opponentId")
);

-- CreateIndex
CREATE INDEX "PlayerOpponentDaily_opponentId_idx" ON "PlayerOpponentDaily"("opponentId");

-- CreateIndex
CREATE INDEX "Hand_handNumber_idx" ON "Hand"("handNumber");

-- CreateIndex
CREATE INDEX "HandPlayer_userId_createdAt_id_idx" ON "HandPlayer"("userId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "HandPlayer_userId_won_idx" ON "HandPlayer"("userId", "won");

-- AddForeignKey
ALTER TABLE "PlayerOpponentDaily" ADD CONSTRAINT "PlayerOpponentDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerOpponentDaily" ADD CONSTRAINT "PlayerOpponentDaily_opponentId_fkey" FOREIGN KEY ("opponentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: PlayerDailyStat.netCentiBB / bombPotHands from existing hands. round(x) = floor(x + 0.5), the same
-- as Math.round in packages/shared/src/hands/persist.ts. HandPlayer.createdAt = Hand.endedAt (UTC).
UPDATE "PlayerDailyStat" s
SET "netCentiBB" = agg.centi, "bombPotHands" = agg.bombs
FROM (
  SELECT hp."userId", to_char(hp."createdAt", 'YYYY-MM-DD') AS day,
         SUM(floor(hp."net" * 100.0 / GREATEST(h."bigBlind", 1) + 0.5))::int AS centi,
         COUNT(*) FILTER (WHERE h."isBombPot")::int AS bombs
  FROM "HandPlayer" hp
  JOIN "Hand" h ON h."id" = hp."handId"
  GROUP BY 1, 2
) agg
WHERE s."userId" = agg."userId" AND s."day" = agg.day;

-- Backfill: money flow between every pair of players dealt into the same hand.
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
    SELECT "handId", SUM(GREATEST("net", 0))::float8 AS wins, SUM(GREATEST(-"net", 0))::float8 AS losses
    FROM "HandPlayer" GROUP BY "handId"
  ) t ON t."handId" = m."handId"
  JOIN "Hand" h ON h."id" = m."handId"
) f
GROUP BY 1, 2, 3;
