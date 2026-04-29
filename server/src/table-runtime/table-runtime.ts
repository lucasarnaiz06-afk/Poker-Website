import type { LobbySummary } from "@poker-platform/shared/types";
import {
  PokerEngine,
  PokerEngineError,
  type Card,
  type PokerStateSnapshot,
} from "../poker-engine";
import {
  sanitizeTableStateForPlayer,
  type PublicTableState,
} from "./public-table-state";

export type PlayerActionType = "fold" | "check" | "call" | "raise";

export type PlayerActionInput = {
  action?: PlayerActionType;
  type?: PlayerActionType;
  totalBet?: number;
  raiseTo?: number;
  amount?: number;
};

export type TableRuntimeRecipient = {
  socketId: string;
  userId: string;
  emitGameState: (payload: PublicTableState) => void | Promise<void>;
};

export type TableRuntimeOptions = {
  loadLobby: (lobbyId: string) => Promise<LobbySummary | null>;
  getRecipients: (lobbyId: string) => Promise<TableRuntimeRecipient[]>;
  deckProvider?: (lobby: LobbySummary) => readonly Card[];
};

type ActiveTable = {
  lobbyId: string;
  engine: PokerEngine;
  startedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

const ACTION_TYPES = new Set<PlayerActionType>([
  "fold",
  "check",
  "call",
  "raise",
]);

export class TableRuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TableRuntimeError";
  }
}

function readActionType(input: PlayerActionInput) {
  const action = input.action ?? input.type;

  if (!action || !ACTION_TYPES.has(action)) {
    throw new TableRuntimeError(
      "INVALID_ACTION",
      "Player action must be fold, check, call, or raise.",
    );
  }

  return action;
}

function readRaiseTotal(input: PlayerActionInput) {
  const totalBet = input.totalBet ?? input.raiseTo ?? input.amount;

  if (typeof totalBet !== "number" || !Number.isInteger(totalBet)) {
    throw new TableRuntimeError(
      "INVALID_RAISE",
      "Raise action requires a totalBet, raiseTo, or amount integer.",
    );
  }

  return totalBet;
}

function getCreatorButtonSeat(lobby: LobbySummary) {
  return lobby.players.find((player) => player.userId === lobby.createdByUserId)
    ?.seatNumber;
}

function buildEngineFromLobby(lobby: LobbySummary, deck?: readonly Card[]) {
  const engine = new PokerEngine({
    smallBlind: lobby.smallBlind,
    bigBlind: lobby.bigBlind,
    maxSeats: lobby.maxPlayers,
  });

  for (const player of lobby.players) {
    const seatNumber = player.seatNumber;

    if (typeof seatNumber !== "number" || !Number.isInteger(seatNumber)) {
      throw new TableRuntimeError(
        "PLAYER_MISSING_SEAT",
        "Every active lobby player must have a seat before the game can start.",
      );
    }

    engine.addPlayer({
      id: player.userId,
      seat: seatNumber,
      stack: player.stack ?? lobby.minBuyIn,
    });
  }

  engine.startHand({
    buttonSeat: getCreatorButtonSeat(lobby) ?? undefined,
    deck,
  });

  return engine;
}

function getRuntimeErrorMessage(error: unknown) {
  if (error instanceof TableRuntimeError || error instanceof PokerEngineError) {
    return error.message;
  }

  return "Table runtime action failed.";
}

export class TableRuntime {
  private readonly tables = new Map<string, ActiveTable>();

  constructor(private readonly options: TableRuntimeOptions) {}

  hasActiveTable(lobbyId: string) {
    return this.tables.has(lobbyId);
  }

  getTableState(lobbyId: string) {
    return this.requireTable(lobbyId).engine.getState();
  }

  async startGame(lobbyId: string, requestedByUserId: string) {
    if (this.tables.has(lobbyId)) {
      throw new TableRuntimeError(
        "GAME_ALREADY_ACTIVE",
        "This lobby already has an active table.",
      );
    }

    const lobby = await this.options.loadLobby(lobbyId);

    if (!lobby) {
      throw new TableRuntimeError("LOBBY_NOT_FOUND", "Lobby was not found.");
    }

    if (lobby.status !== "WAITING") {
      throw new TableRuntimeError(
        "LOBBY_NOT_WAITING",
        "Only waiting lobbies can start a game.",
      );
    }

    if (lobby.createdByUserId !== requestedByUserId) {
      throw new TableRuntimeError(
        "ONLY_CREATOR_CAN_START",
        "Only the lobby creator can start the game.",
      );
    }

    const table: ActiveTable = {
      lobbyId,
      engine: buildEngineFromLobby(lobby, this.options.deckProvider?.(lobby)),
      startedByUserId: requestedByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tables.set(lobbyId, table);

    console.log("[table-runtime] game started", {
      lobbyId,
      startedByUserId: requestedByUserId,
    });

    await this.broadcastTableState(lobbyId);

    return table.engine.getState();
  }

  async applyPlayerAction(
    lobbyId: string,
    playerId: string,
    input: PlayerActionInput,
  ) {
    const table = this.requireTable(lobbyId);
    const action = readActionType(input);
    let state: PokerStateSnapshot;

    if (action === "fold") {
      state = table.engine.fold(playerId);
    } else if (action === "check") {
      state = table.engine.check(playerId);
    } else if (action === "call") {
      state = table.engine.call(playerId);
    } else {
      state = table.engine.raise(playerId, readRaiseTotal(input));
    }

    table.updatedAt = new Date();

    console.log("[table-runtime] player action accepted", {
      lobbyId,
      playerId,
      action,
      phase: state.phase,
    });

    await this.broadcastTableState(lobbyId);

    return state;
  }

  async broadcastTableState(lobbyId: string) {
    const state = this.getTableState(lobbyId);
    const recipients = await this.options.getRecipients(lobbyId);

    for (const recipient of recipients) {
      await recipient.emitGameState(
        sanitizeTableStateForPlayer(lobbyId, state, recipient.userId),
      );
    }

    console.log("[table-runtime] emitted game_state_update", {
      lobbyId,
      recipients: recipients.length,
    });

    return recipients.length;
  }

  toErrorPayload(error: unknown) {
    return {
      message: getRuntimeErrorMessage(error),
      code:
        error instanceof TableRuntimeError || error instanceof PokerEngineError
          ? error.code
          : "TABLE_RUNTIME_ERROR",
    };
  }

  private requireTable(lobbyId: string) {
    const table = this.tables.get(lobbyId);

    if (!table) {
      throw new TableRuntimeError(
        "GAME_NOT_STARTED",
        "This lobby does not have an active table yet.",
      );
    }

    return table;
  }
}
