import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { AuthenticatedUser } from "../auth/session";
import type {
  CreateLobbyInput,
  JoinLobbyInput,
  LobbyPlayerSummary,
  LobbySummary,
  LobbyVisibility,
} from "../types/lobby";
import { hashPassword, verifyPassword } from "./passwords";

const ACTIVE_PLAYER_STATUSES = ["JOINED", "SEATED"] as const;

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

type LobbyWithPlayers = NonNullable<
  Awaited<ReturnType<typeof findLobbyWithPlayers>>
>;

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

function readInteger(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isInteger(parsed) ? parsed : fallback;
}

function validateVisibility(value: unknown): LobbyVisibility {
  return value === "PRIVATE" ? "PRIVATE" : "PUBLIC";
}

function validateLobbyInput(input: unknown): CreateLobbyInput {
  if (!isRecord(input)) {
    throw new LobbyServiceError("INVALID_INPUT", "Lobby details are required.");
  }

  const name = readString(input.name);
  const visibility = validateVisibility(input.visibility);
  const password = readString(input.password);
  const smallBlind = readInteger(input.smallBlind, 5);
  const bigBlind = readInteger(input.bigBlind, 10);
  const minBuyIn = readInteger(input.minBuyIn, bigBlind * 20);
  const maxBuyIn = readInteger(input.maxBuyIn, bigBlind * 100);
  const maxPlayers = readInteger(input.maxPlayers, 6);

  if (name.length < 3 || name.length > 80) {
    throw new LobbyServiceError(
      "INVALID_NAME",
      "Lobby name must be between 3 and 80 characters.",
    );
  }

  if (visibility === "PRIVATE" && password.length < 4) {
    throw new LobbyServiceError(
      "INVALID_PASSWORD",
      "Private lobby passwords must be at least 4 characters.",
    );
  }

  if (maxPlayers < 2 || maxPlayers > 9) {
    throw new LobbyServiceError(
      "INVALID_MAX_PLAYERS",
      "Lobbies must allow between 2 and 9 players.",
    );
  }

  if (smallBlind <= 0 || bigBlind <= 0 || bigBlind < smallBlind) {
    throw new LobbyServiceError(
      "INVALID_BLINDS",
      "Blinds must be positive, and big blind must be at least the small blind.",
    );
  }

  if (minBuyIn < bigBlind || maxBuyIn < minBuyIn) {
    throw new LobbyServiceError(
      "INVALID_BUY_IN",
      "Buy-ins must be positive, and max buy-in must be at least min buy-in.",
    );
  }

  return {
    name,
    visibility,
    password: visibility === "PRIVATE" ? password : undefined,
    smallBlind,
    bigBlind,
    minBuyIn,
    maxBuyIn,
    maxPlayers,
  };
}

function validateJoinInput(input: unknown): JoinLobbyInput {
  if (!isRecord(input)) {
    throw new LobbyServiceError("INVALID_INPUT", "Lobby ID is required.");
  }

  const lobbyId = readString(input.lobbyId);

  if (!lobbyId) {
    throw new LobbyServiceError("INVALID_LOBBY_ID", "Lobby ID is required.");
  }

  return {
    lobbyId,
    password: readString(input.password),
  };
}

function findOpenSeat(
  maxPlayers: number,
  occupiedSeatNumbers: Array<number | null>,
) {
  const occupiedSeats = new Set(
    occupiedSeatNumbers.filter((seatNumber): seatNumber is number =>
      Number.isInteger(seatNumber),
    ),
  );

  for (let seatNumber = 1; seatNumber <= maxPlayers; seatNumber += 1) {
    if (!occupiedSeats.has(seatNumber)) {
      return seatNumber;
    }
  }

  throw new LobbyServiceError("LOBBY_FULL", "Lobby is full.");
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

function toPlayerSummary(
  player: LobbyWithPlayers["players"][number],
): LobbyPlayerSummary {
  return {
    id: player.id,
    userId: player.userId,
    name: player.user.name,
    email: player.user.email,
    seatNumber: player.seatNumber,
    stack: player.chipStack,
    status: player.status,
    joinedAt: player.joinedAt.toISOString(),
  };
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
    throw new LobbyServiceError("LOBBY_NOT_FOUND", "Lobby was not found.");
  }

  const isPlayerInLobby = lobby.players.some((player) => player.userId === userId);

  if (!isPlayerInLobby) {
    throw new LobbyServiceError(
      "LOBBY_ACCESS_DENIED",
      "Join the lobby before opening its waiting room.",
    );
  }

  return lobby;
}

export async function createLobbyForUser(
  user: AuthenticatedUser,
  rawInput: unknown,
) {
  const input = validateLobbyInput(rawInput);
  const passwordHash =
    input.visibility === "PRIVATE" && input.password
      ? await hashPassword(input.password)
      : null;

  const lobby = await prisma.$transaction(async (tx) => {
    const createdLobby = await tx.lobby.create({
      data: {
        name: input.name,
        visibility: input.visibility,
        smallBlind: input.smallBlind,
        bigBlind: input.bigBlind,
        minBuyIn: input.minBuyIn,
        maxBuyIn: input.maxBuyIn,
        maxPlayers: input.maxPlayers,
        passwordHash,
        createdByUserId: user.id,
      },
    });

    await tx.lobbyPlayer.create({
      data: {
        lobbyId: createdLobby.id,
        userId: user.id,
        seatNumber: 1,
        chipStack: input.minBuyIn,
        status: "JOINED",
      },
    });

    return createdLobby;
  });

  return getWaitingRoomLobbyForUser(lobby.id, user.id);
}

export async function joinLobbyForUser(
  user: AuthenticatedUser,
  rawInput: unknown,
) {
  const input = validateJoinInput(rawInput);

  const lobby = await prisma.lobby.findUnique({
    where: { id: input.lobbyId },
  });

  if (!lobby) {
    throw new LobbyServiceError("LOBBY_NOT_FOUND", "Lobby was not found.");
  }

  if (lobby.status !== "WAITING") {
    throw new LobbyServiceError(
      "LOBBY_CLOSED",
      "Only waiting lobbies can be joined.",
    );
  }

  if (lobby.visibility === "PRIVATE") {
    const password = input.password ?? "";

    if (!lobby.passwordHash || !(await verifyPassword(password, lobby.passwordHash))) {
      throw new LobbyServiceError(
        "INVALID_LOBBY_PASSWORD",
        "Private lobby password is incorrect.",
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const activePlayers = await tx.lobbyPlayer.findMany({
      where: {
        lobbyId: lobby.id,
        status: {
          in: [...ACTIVE_PLAYER_STATUSES],
        },
      },
      select: {
        userId: true,
        seatNumber: true,
      },
    });

    const existingPlayer = await tx.lobbyPlayer.findUnique({
      where: {
        lobbyId_userId: {
          lobbyId: lobby.id,
          userId: user.id,
        },
      },
    });

    if (existingPlayer?.status === "KICKED") {
      throw new LobbyServiceError(
        "PLAYER_REMOVED",
        "This account cannot rejoin the lobby.",
      );
    }

    const isAlreadyActive = activePlayers.some(
      (player) => player.userId === user.id,
    );
    const seatNumber =
      existingPlayer?.seatNumber ??
      findOpenSeat(
        lobby.maxPlayers,
        activePlayers.map((player) => player.seatNumber),
      );

    if (!isAlreadyActive && activePlayers.length >= lobby.maxPlayers) {
      throw new LobbyServiceError("LOBBY_FULL", "Lobby is full.");
    }

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
        seatNumber,
        chipStack: lobby.minBuyIn,
        status: "JOINED",
      },
      update: {
        seatNumber,
        chipStack: existingPlayer?.chipStack ?? lobby.minBuyIn,
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
