-- Rename the existing persisted stack column to the game-domain name.
ALTER TABLE "LobbyPlayer" RENAME COLUMN "stack" TO "chipStack";

-- CreateTable
CREATE TABLE "HandHistory" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "handNumber" INTEGER NOT NULL,
    "potSize" INTEGER NOT NULL,
    "winnerUserIds" TEXT[],
    "winningHandName" TEXT,
    "winningHandDescription" TEXT,
    "board" JSONB NOT NULL,
    "awards" JSONB NOT NULL,
    "showdownHands" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HandHistory_lobbyId_handNumber_key" ON "HandHistory"("lobbyId", "handNumber");

-- CreateIndex
CREATE INDEX "HandHistory_lobbyId_completedAt_idx" ON "HandHistory"("lobbyId", "completedAt");

-- AddForeignKey
ALTER TABLE "HandHistory" ADD CONSTRAINT "HandHistory_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;
