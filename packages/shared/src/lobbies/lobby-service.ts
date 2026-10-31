import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { checkRateLimit, formatRetryAfter, recordRateLimitAttempt, type RateLimitPolicy } from "../auth/rate-limit";
import type { AuthenticatedUser } from "../auth/session";
import type { JoinLobbyInput, LobbyPlayerSummary, LobbyStatus, LobbySummary } from "../types/lobby";
import type { LobbyTableSummary, TableStatus } from "../types/table-view";
import { generateInviteCode } from "./invite-codes";
import { isValidInviteCode } from "./invite-link";
import { hashPassword, verifyPassword } from "./passwords";
import { createGameInputSchema, readStoredTableSettings, type CreateGameInput } from "./settings-schema";
import { mostCommon } from "./quick-seat";
import { getTableFeatures } from "./table-features";

const ACTIVE_PLAYER_STATUSES = ["JOINED", "SEATED"] as const;

/** Wrong table-password attempts per user before a growing lockout. */
const TABLE_PASSWORD_RATE_LIMIT: RateLimitPolicy = {
  windowMs: 15 * 60_000,
  freeAttempts: 10,
  baseLockMs: 30_000,
  maxLockMs: 15 * 60_000,
};

/** Abuse guard: how many WAITING/ACTIVE tables one user may host at a time. */
export const MAX_OPEN_TABLES_PER_HOST = 10;

export type PersistCompletedHandInput = {
  lobbyId: string;
  handNumber: number;
  potSize: number;
  winnerUserIds: string[];
  winningHandName: string | null;
  winningHandDescription: string | null;
  board: Prisma.InputJsonValue;
  awards: Prisma.InputJsonValue;
  showdownHands: Prisma.InputJsonValue;
  completedAt: Date;
  playerStacks: Array<{
    userId: string;
    chipStack: number;
  }>;
};

type LobbyWithPlayers = NonNullable<Awaited<ReturnType<typeof findLobbyWithPlayers>>>;

export class LobbyServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LobbyServiceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function validateCreateGameInput(input: unknown): CreateGameInput {
  const parsed = createGameInputSchema.safeParse(input);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];

    throw new LobbyServiceError("INVALID_INPUT", issue?.message ?? "Game settings are invalid.");
  }

  return parsed.data;
}

function validateJoinInput(input: unknown): JoinLobbyInput {
  if (!isRecord(input)) {
    throw new LobbyServiceError("INVALID_INPUT", "Choose a table first.");
  }

  const lobbyId = readString(input.lobbyId);
  const inviteCode = readString(input.inviteCode);

  if (!lobbyId && !inviteCode) {
    throw new LobbyServiceError("INVALID_LOBBY_ID", "Choose a table first.");
  }

  if (lobbyId.length > 64 || (inviteCode && !isValidInviteCode(inviteCode))) {
    throw new LobbyServiceError("LOBBY_NOT_FOUND", "That table doesn't exist or has closed.");
  }

  return {
    lobbyId,
    password: readString(input.password).slice(0, 128),
    inviteCode: inviteCode || undefined,
  };
}

async function findLobbyWithPlayers(lobbyId: string) {
  return prisma.lobby.findUnique({
    where: { id: lobbyId },
    include: {
      players: {
        where: {
          status: {
            in: [...ACTIVE_PLAYER_STATUSES],
          },
        },
        include: {
          user: true,
        },
        orderBy: {
          seatNumber: "asc",
        },
      },
    },
  });
}

function toPlayerSummary(player: LobbyWithPlayers["players"][number]): LobbyPlayerSummary {
  return {
    id: player.id,
    userId: player.userId,
    name: player.user.name,
    // Never expose other players' emails (this summary is sent to everyone at the table).
    email: null,
    seatNumber: player.seatNumber,
    stack: player.chipStack,
    status: player.status,
    joinedAt: player.joinedAt.toISOString(),
  };
}

type LobbySettingsRow = {
  settings: Prisma.JsonValue;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxPlayers: number;
};

function settingsOf(lobby: LobbySettingsRow) {
  return readStoredTableSettings(lobby.settings, lobby);
}

function toLobbySummary(lobby: LobbyWithPlayers): LobbySummary {
  const players = lobby.players.map(toPlayerSummary);

  return {
    id: lobby.id,
    name: lobby.name,
    visibility: lobby.visibility,
    status: lobby.status,
    smallBlind: lobby.smallBlind,
    bigBlind: lobby.bigBlind,
    minBuyIn: lobby.minBuyIn,
    maxBuyIn: lobby.maxBuyIn,
    maxPlayers: lobby.maxPlayers,
    createdByUserId: lobby.createdByUserId,
    createdAt: lobby.createdAt.toISOString(),
    updatedAt: lobby.updatedAt.toISOString(),
    playerCount: players.length,
    players,
    settings: settingsOf(lobby),
    hasPassword: lobby.passwordHash !== null,
  };
}

const TABLE_STATUS_BY_LOBBY_STATUS: Record<LobbyStatus, TableStatus> = {
  WAITING: "WAITING",
  ACTIVE: "RUNNING",
  CLOSED: "CLOSED",
};

type LobbyTableRow = LobbySettingsRow & {
  id: string;
  name: string;
  visibility: LobbySummary["visibility"];
  status: LobbyStatus;
  passwordHash: string | null;
  _count: { players: number };
};

const lobbyTableSelect = {
  id: true,
  name: true,
  visibility: true,
  status: true,
  settings: true,
  smallBlind: true,
  bigBlind: true,
  minBuyIn: true,
  maxBuyIn: true,
  maxPlayers: true,
  passwordHash: true,
  _count: {
    select: {
      players: { where: { status: { in: [...ACTIVE_PLAYER_STATUSES] } } },
    },
  },
} satisfies Prisma.LobbySelect;

function toLobbyTableSummary(lobby: LobbyTableRow): LobbyTableSummary {
  const settings = settingsOf(lobby);

  return {
    tableId: lobby.id,
    name: lobby.name,
    variant: settings.variant,
    smallBlind: lobby.smallBlind,
    bigBlind: lobby.bigBlind,
    minBuyIn: lobby.minBuyIn,
    maxBuyIn: lobby.maxBuyIn,
    maxPlayers: lobby.maxPlayers,
    seated: lobby._count.players,
    visibility: lobby.visibility,
    status: TABLE_STATUS_BY_LOBBY_STATUS[lobby.status],
    features: getTableFeatures(settings),
    avgPot: null,
    handsPerHour: null,
    hasPassword: lobby.passwordHash !== null,
    ante: settings.ante,
  };
}

/** Public tables that can be joined from the lobby list, newest first. */
export async function listLobbyTables(): Promise<LobbyTableSummary[]> {
  const lobbies = await prisma.lobby.findMany({
    where: { visibility: "PUBLIC", status: "WAITING" },
    select: lobbyTableSelect,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return lobbies.map(toLobbyTableSummary);
}

export type UserLobbyTable = LobbyTableSummary & {
  inviteCode: string | null;
  isHost: boolean;
};

/** Tables (any visibility, not closed) the user currently has a seat in. Includes invite codes. */
export async function listUserLobbyTables(userId: string): Promise<UserLobbyTable[]> {
  const lobbies = await prisma.lobby.findMany({
    where: {
      status: { in: ["WAITING", "ACTIVE"] },
      players: { some: { userId, status: { in: [...ACTIVE_PLAYER_STATUSES] } } },
    },
    select: { ...lobbyTableSelect, inviteCode: true, createdByUserId: true },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  return lobbies.map((lobby) => ({
    ...toLobbyTableSummary(lobby),
    inviteCode: lobby.inviteCode,
    isHost: lobby.createdByUserId === userId,
  }));
}

/** The big blind the user played most over their last 200 hands (null without history). */
export async function getUsualBigBlind(userId: string): Promise<number | null> {
  const rows = await prisma.handPlayer.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { hand: { select: { bigBlind: true } } },
  });

  return mostCommon(rows.map((row) => row.hand.bigBlind));
}

export type InvitePreview = LobbyTableSummary & {
  hostName: string | null;
  isMember: boolean;
};

/** Looks up a table by invite code for the join page. Returns null for unknown codes or closed tables. */
export async function getInvitePreview(inviteCode: string, userId: string): Promise<InvitePreview | null> {
  if (!isValidInviteCode(inviteCode)) {
    return null;
  }

  const lobby = await prisma.lobby.findUnique({
    where: { inviteCode },
    select: {
      ...lobbyTableSelect,
      createdBy: { select: { name: true } },
      players: {
        where: { userId, status: { in: [...ACTIVE_PLAYER_STATUSES] } },
        select: { id: true },
      },
    },
  });

  if (!lobby || lobby.status === "CLOSED") {
    return null;
  }

  return {
    ...toLobbyTableSummary(lobby),
    hostName: lobby.createdBy.name,
    isMember: lobby.players.length > 0,
  };
}

export async function getLobbySummary(lobbyId: string) {
  const lobby = await findLobbyWithPlayers(lobbyId);

  return lobby ? toLobbySummary(lobby) : null;
}

export async function listPublicWaitingLobbies() {
  const lobbies = await prisma.lobby.findMany({
    where: {
      visibility: "PUBLIC",
      status: "WAITING",
    },
    include: {
      players: {
        where: {
          status: {
            in: [...ACTIVE_PLAYER_STATUSES],
          },
        },
        include: {
          user: true,
        },
        orderBy: {
          seatNumber: "asc",
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 30,
  });

  return lobbies.map(toLobbySummary);
}

export async function getWaitingRoomLobbyForUser(lobbyId: string, userId: string) {
  const lobby = await getLobbySummary(lobbyId);

  if (!lobby) {
    throw new LobbyServiceError("LOBBY_NOT_FOUND", "That table doesn't exist or has closed.");
  }

  const isPlayerInLobby = lobby.players.some((player) => player.userId === userId);

  if (!isPlayerInLobby) {
    throw new LobbyServiceError("LOBBY_ACCESS_DENIED", "Join the table first.");
  }

  const invite = await prisma.lobby.findUnique({
    where: { id: lobbyId },
    select: { inviteCode: true },
  });

  return { ...lobby, inviteCode: invite?.inviteCode ?? null };
}

function isUniqueViolation(error: unknown) {
  return isRecord(error) && error.code === "P2002";
}

export async function createLobbyForUser(user: AuthenticatedUser, rawInput: unknown) {
  const input = validateCreateGameInput(rawInput);
  const { settings } = input;
  const openHostedTables = await prisma.lobby.count({
    where: { createdByUserId: user.id, status: { in: ["WAITING", "ACTIVE"] } },
  });

  if (openHostedTables >= MAX_OPEN_TABLES_PER_HOST) {
    throw new LobbyServiceError(
      "TOO_MANY_TABLES",
      `You can host up to ${MAX_OPEN_TABLES_PER_HOST} open tables at once. Close one to create another.`,
    );
  }
  const passwordHash = input.password ? await hashPassword(input.password) : null;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const lobby = await prisma.$transaction(async (tx) => {
        const createdLobby = await tx.lobby.create({
          data: {
            name: input.name,
            visibility: input.visibility,
            // Legacy columns mirror settings for older readers.
            smallBlind: settings.smallBlind,
            bigBlind: settings.bigBlind,
            minBuyIn: settings.minBuyIn,
            maxBuyIn: settings.maxBuyIn,
            maxPlayers: settings.maxPlayers,
            settings: settings as unknown as Prisma.InputJsonObject,
            passwordHash,
            inviteCode: generateInviteCode(),
            createdByUserId: user.id,
          },
        });

        await tx.lobbyPlayer.create({
          data: {
            lobbyId: createdLobby.id,
            userId: user.id,
            // Membership only: seats and chips come from the game server's buy-in (wallet ledger).
            seatNumber: null,
            chipStack: null,
            status: "JOINED",
          },
        });

        return createdLobby;
      });

      return getWaitingRoomLobbyForUser(lobby.id, user.id);
    } catch (error) {
      // Invite code collision (~2^-59 per pair); retry with a fresh code.
      if (isUniqueViolation(error) && attempt < 3) {
        continue;
      }

      throw error;
    }
  }
}

export async function joinLobbyForUser(user: AuthenticatedUser, rawInput: unknown) {
  const input = validateJoinInput(rawInput);

  const lobby = await prisma.lobby.findUnique({
    where: input.inviteCode ? { inviteCode: input.inviteCode } : { id: input.lobbyId },
  });

  if (!lobby || (input.inviteCode && input.lobbyId && lobby.id !== input.lobbyId)) {
    throw new LobbyServiceError("LOBBY_NOT_FOUND", "That table doesn't exist or has closed.");
  }

  const existingMembership = await prisma.lobbyPlayer.findUnique({
    where: { lobbyId_userId: { lobbyId: lobby.id, userId: user.id } },
    select: { status: true },
  });
  const isActiveMember =
    existingMembership !== null && (ACTIVE_PLAYER_STATUSES as readonly string[]).includes(existingMembership.status);

  // Players already at the table just go back to it.
  if (isActiveMember && lobby.status !== "CLOSED") {
    return getWaitingRoomLobbyForUser(lobby.id, user.id);
  }

  if (lobby.status === "CLOSED") {
    throw new LobbyServiceError("LOBBY_CLOSED", "This table has closed.");
  }

  // Private tables with an invite code are reachable only through the invite link.
  // Legacy private tables (no code) stay reachable by ID + password.
  if (lobby.visibility === "PRIVATE" && lobby.inviteCode && input.inviteCode !== lobby.inviteCode) {
    throw new LobbyServiceError("LOBBY_NOT_FOUND", "That table doesn't exist or has closed.");
  }

  if (lobby.visibility === "PRIVATE" && !lobby.inviteCode && !lobby.passwordHash) {
    throw new LobbyServiceError("LOBBY_NOT_FOUND", "That table doesn't exist or has closed.");
  }

  if (lobby.passwordHash) {
    const password = input.password ?? "";
    const rateKey = `lobbyPassword:acct:${user.id}`;
    const limit = await checkRateLimit(rateKey);

    if (!limit.allowed) {
      throw new LobbyServiceError(
        "RATE_LIMITED",
        `Too many wrong passwords. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`,
      );
    }

    if (!(await verifyPassword(password, lobby.passwordHash))) {
      if (password) {
        await recordRateLimitAttempt(rateKey, TABLE_PASSWORD_RATE_LIMIT);
      }

      throw new LobbyServiceError(
        "INVALID_LOBBY_PASSWORD",
        password ? "That password is incorrect." : "This table needs a password.",
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const existingPlayer = await tx.lobbyPlayer.findUnique({
      where: {
        lobbyId_userId: {
          lobbyId: lobby.id,
          userId: user.id,
        },
      },
    });

    if (existingPlayer?.status === "KICKED") {
      throw new LobbyServiceError("PLAYER_REMOVED", "You can't rejoin this table.");
    }

    // Membership is not a seat: seats (and the table's player limit) are enforced by the game server.

    await tx.lobbyPlayer.upsert({
      where: {
        lobbyId_userId: {
          lobbyId: lobby.id,
          userId: user.id,
        },
      },
      create: {
        lobbyId: lobby.id,
        userId: user.id,
        // Membership only: chips exist only after a wallet buy-in through the game server.
        seatNumber: null,
        chipStack: null,
        status: "JOINED",
      },
      update: {
        seatNumber: null,
        chipStack: null,
        status: "JOINED",
        leftAt: null,
      },
    });
  });

  return getWaitingRoomLobbyForUser(lobby.id, user.id);
}

export async function markLobbyActive(lobbyId: string) {
  await prisma.lobby.update({
    where: { id: lobbyId },
    data: {
      status: "ACTIVE",
    },
  });
}

export async function persistCompletedHand(input: PersistCompletedHandInput) {
  await prisma.$transaction(async (tx) => {
    for (const playerStack of input.playerStacks) {
      await tx.lobbyPlayer.updateMany({
        where: {
          lobbyId: input.lobbyId,
          userId: playerStack.userId,
        },
        data: {
          chipStack: playerStack.chipStack,
        },
      });
    }

    await tx.handHistory.upsert({
      where: {
        lobbyId_handNumber: {
          lobbyId: input.lobbyId,
          handNumber: input.handNumber,
        },
      },
      create: {
        lobbyId: input.lobbyId,
        handNumber: input.handNumber,
        potSize: input.potSize,
        winnerUserIds: input.winnerUserIds,
        winningHandName: input.winningHandName,
        winningHandDescription: input.winningHandDescription,
        board: input.board,
        awards: input.awards,
        showdownHands: input.showdownHands,
        completedAt: input.completedAt,
      },
      update: {
        potSize: input.potSize,
        winnerUserIds: input.winnerUserIds,
        winningHandName: input.winningHandName,
        winningHandDescription: input.winningHandDescription,
        board: input.board,
        awards: input.awards,
        showdownHands: input.showdownHands,
        completedAt: input.completedAt,
      },
    });
  });
}
