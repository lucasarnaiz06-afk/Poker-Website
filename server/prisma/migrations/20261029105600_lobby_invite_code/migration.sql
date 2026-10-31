-- AlterTable
ALTER TABLE "Lobby" ADD COLUMN     "inviteCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Lobby_inviteCode_key" ON "Lobby"("inviteCode");
