-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'MOD', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('SIGNUP_BONUS', 'DAILY_BONUS', 'REFILL', 'BUY_IN', 'CASH_OUT', 'REBUY', 'ADJUSTMENT', 'REFUND');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "ipHash" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatar" TEXT,
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "chipBalance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "preferences" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER',
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpLastCounter" INTEGER,
ADD COLUMN     "totpSecret" TEXT,
ADD COLUMN     "username" TEXT,
ADD COLUMN     "usernameChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthRateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "ipHash" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponsibleGamingLimits" (
    "userId" TEXT NOT NULL,
    "dailyLossLimit" INTEGER,
    "pendingDailyLossLimit" INTEGER,
    "pendingDailyLossLimitAt" TIMESTAMP(3),
    "sessionReminderMinutes" INTEGER,
    "coolOffUntil" TIMESTAMP(3),
    "selfExcludedUntil" TIMESTAMP(3),
    "selfExcludedPermanent" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResponsibleGamingLimits_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "lobbyId" TEXT,
    "refKey" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyBonusClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "streak" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyBonusClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hand" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "handNumber" INTEGER NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'NLHE',
    "smallBlind" INTEGER NOT NULL,
    "bigBlind" INTEGER NOT NULL,
    "ante" INTEGER NOT NULL DEFAULT 0,
    "buttonSeat" INTEGER NOT NULL,
    "isBombPot" BOOLEAN NOT NULL DEFAULT false,
    "runItTwice" BOOLEAN NOT NULL DEFAULT false,
    "boards" JSONB NOT NULL,
    "pots" JSONB NOT NULL,
    "events" JSONB NOT NULL,
    "deckCommitment" TEXT NOT NULL,
    "deckReveal" JSONB,
    "totalPot" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Hand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandPlayer" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "position" TEXT NOT NULL,
    "startingStack" INTEGER NOT NULL,
    "endingStack" INTEGER NOT NULL,
    "net" INTEGER NOT NULL,
    "won" INTEGER NOT NULL DEFAULT 0,
    "holeCards" JSONB NOT NULL,
    "shown" BOOLEAN NOT NULL DEFAULT false,
    "sawFlop" BOOLEAN NOT NULL DEFAULT false,
    "wentToShowdown" BOOLEAN NOT NULL DEFAULT false,
    "wonAtShowdown" BOOLEAN NOT NULL DEFAULT false,
    "vpip" BOOLEAN NOT NULL DEFAULT false,
    "pfr" BOOLEAN NOT NULL DEFAULT false,
    "threeBet" BOOLEAN NOT NULL DEFAULT false,
    "allInEvNet" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerDailyStat" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "hands" INTEGER NOT NULL DEFAULT 0,
    "net" INTEGER NOT NULL DEFAULT 0,
    "vpipHands" INTEGER NOT NULL DEFAULT 0,
    "pfrHands" INTEGER NOT NULL DEFAULT 0,
    "showdowns" INTEGER NOT NULL DEFAULT 0,
    "showdownsWon" INTEGER NOT NULL DEFAULT 0,
    "biggestPotWon" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlayerDailyStat_pkey" PRIMARY KEY ("userId","day")
);

-- CreateTable
CREATE TABLE "PlayerNote" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecoveryCode_userId_idx" ON "RecoveryCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCode_userId_codeHash_key" ON "RecoveryCode"("userId", "codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "AuthRateLimit_updatedAt_idx" ON "AuthRateLimit"("updatedAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_refKey_key" ON "LedgerEntry"("refKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_lobbyId_idx" ON "LedgerEntry"("lobbyId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyBonusClaim_userId_day_key" ON "DailyBonusClaim"("userId", "day");

-- CreateIndex
CREATE INDEX "Hand_endedAt_idx" ON "Hand"("endedAt");

-- CreateIndex
CREATE INDEX "Hand_lobbyId_endedAt_idx" ON "Hand"("lobbyId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Hand_lobbyId_handNumber_key" ON "Hand"("lobbyId", "handNumber");

-- CreateIndex
CREATE INDEX "HandPlayer_userId_createdAt_idx" ON "HandPlayer"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HandPlayer_handId_userId_key" ON "HandPlayer"("handId", "userId");

-- CreateIndex
CREATE INDEX "PlayerDailyStat_day_net_idx" ON "PlayerDailyStat"("day", "net");

-- CreateIndex
CREATE INDEX "PlayerNote_subjectId_idx" ON "PlayerNote"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerNote_ownerId_subjectId_key" ON "PlayerNote"("ownerId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- AddForeignKey
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibleGamingLimits" ADD CONSTRAINT "ResponsibleGamingLimits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyBonusClaim" ADD CONSTRAINT "DailyBonusClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hand" ADD CONSTRAINT "Hand_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandPlayer" ADD CONSTRAINT "HandPlayer_handId_fkey" FOREIGN KEY ("handId") REFERENCES "Hand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandPlayer" ADD CONSTRAINT "HandPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerDailyStat" ADD CONSTRAINT "PlayerDailyStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerNote" ADD CONSTRAINT "PlayerNote_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerNote" ADD CONSTRAINT "PlayerNote_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Wallet balance can never go negative (enforced in SQL, not only in application code).
ALTER TABLE "User" ADD CONSTRAINT "User_chipBalance_nonnegative" CHECK ("chipBalance" >= 0);

-- Usernames are stored lowercase, 3-20 chars of [a-z0-9_].
ALTER TABLE "User" ADD CONSTRAINT "User_username_format" CHECK ("username" IS NULL OR "username" ~ '^[a-z0-9_]{3,20}$');

-- Ledger rows are append-only facts: balanceAfter is never negative and delta is never zero.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_balanceAfter_nonnegative" CHECK ("balanceAfter" >= 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_delta_nonzero" CHECK ("delta" <> 0);
