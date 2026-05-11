import type {
  LobbySummary,
  PublicCard,
  PublicGameLogEntry,
  PublicHandCompletePayload,
  PublicHandCompleteWinner,
  PublicHandHistoryEntry,
  PublicPotAward,
} from "@poker-platform/shared/types";
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
  emitHandComplete?: (payload: PublicHandCompletePayload) => void | Promise<void>;
};

export type PersistCompletedHandInput = {
  lobbyId: string;
  handNumber: number;
  potSize: number;
  winnerUserIds: string[];
  winningHandName: string | null;
  winningHandDescription: string | null;
  board: PublicCard[];
  awards: PublicPotAward[];
  showdownHands: PokerStateSnapshot["showdownHands"];
  completedAt: Date;
  playerStacks: Array<{
    userId: string;
    chipStack: number;
  }>;
};

export type TableRuntimeOptions = {
  loadLobby: (lobbyId: string) => Promise<LobbySummary | null>;
  getRecipients: (lobbyId: string) => Promise<TableRuntimeRecipient[]>;
  deckProvider?: (lobby: LobbySummary) => readonly Card[];
  activateLobby?: (lobbyId: string) => Promise<void>;
  persistCompletedHand?: (input: PersistCompletedHandInput) => Promise<void>;
  onLobbyUpdated?: (lobbyId: string) => Promise<void>;
  handRestartDelayMs?: number;
};

type ActiveTable = {
  lobbyId: string;
  lobby: LobbySummary;
  engine: PokerEngine;
  handNumber: number;
  logSequence: number;
  actionLog: PublicGameLogEntry[];
  handHistory: PublicHandHistoryEntry[];
  lastHandCompletePayload?: PublicHandCompletePayload;
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

const TERMINAL_PHASES = new Set<PokerStateSnapshot["phase"]>([
  "SHOWDOWN",
  "COMPLETE",
]);

const DEFAULT_HAND_RESTART_DELAY_MS = 4500;

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

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isTerminalState(state: PokerStateSnapshot) {
  return TERMINAL_PHASES.has(state.phase);
}

function canStartNextHand(state: PokerStateSnapshot) {
  return state.players.filter((player) => player.stack > 0).length >= 2;
}

function getPlayerName(lobby: LobbySummary, playerId: string) {
  const lobbyPlayer = lobby.players.find((player) => player.userId === playerId);

  return lobbyPlayer?.name ?? lobbyPlayer?.email ?? null;
}

function getPlayerDisplayName(lobby: LobbySummary, playerId: string) {
  return getPlayerName(lobby, playerId) ?? "Player";
}

function formatChips(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function buildWinnerSummaries(
  lobby: LobbySummary,
  awards: readonly PublicPotAward[],
) {
  const winnersById = new Map<string, PublicHandCompleteWinner>();

  for (const award of awards) {
    if (award.winnerIds.length === 0) {
      continue;
    }

    const share = Math.floor(award.amount / award.winnerIds.length);
    let remainder = award.amount % award.winnerIds.length;

    for (const playerId of award.winnerIds) {
      const existingWinner = winnersById.get(playerId);
      const extraChip = remainder > 0 ? 1 : 0;
      const amount = share + extraChip;

      remainder -= extraChip;

      winnersById.set(playerId, {
        playerId,
        name: getPlayerName(lobby, playerId),
        amount: (existingWinner?.amount ?? 0) + amount,
        handName: existingWinner?.handName ?? award.handName,
        handDescription:
          existingWinner?.handDescription ?? award.handDescription,
      });
    }
  }

  return [...winnersById.values()];
}

function buildHandCompletePayload(
  table: ActiveTable,
  state: PokerStateSnapshot,
  completedAt: Date,
  nextHandInMs: number | null,
): PublicHandCompletePayload {
  const awards = state.pot.awards;
  const firstNamedAward =
    awards.find((award) => award.handName || award.handDescription) ?? awards[0];

  return {
    lobbyId: table.lobbyId,
    handNumber: table.handNumber,
    potSize: awards.reduce((total, award) => total + award.amount, 0),
    completedAt: completedAt.toISOString(),
    winningHandName: firstNamedAward?.handName ?? null,
    winningHandDescription: firstNamedAward?.handDescription ?? null,
    winners: buildWinnerSummaries(table.lobby, awards),
    awards,
    nextHandInMs,
  };
}

function buildHandHistoryEntry(
  payload: PublicHandCompletePayload,
): PublicHandHistoryEntry {
  return {
    handNumber: payload.handNumber,
    completedAt: payload.completedAt,
    potSize: payload.potSize,
    winningHandName: payload.winningHandName,
    winningHandDescription: payload.winningHandDescription,
    winners: payload.winners,
  };
}

function describePhaseDeal(boardLength: number) {
  if (boardLength === 3) {
    return "Dealing the flop.";
  }

  if (boardLength === 4) {
    return "Dealing the turn.";
  }

  if (boardLength === 5) {
    return "Dealing the river.";
  }

  return null;
}

function describePlayerAction({
  action,
  inputTotalBet,
  lobby,
  playerId,
  previousState,
  nextState,
}: {
  action: PlayerActionType;
  inputTotalBet?: number;
  lobby: LobbySummary;
  playerId: string;
  previousState: PokerStateSnapshot;
  nextState: PokerStateSnapshot;
}) {
  const name = getPlayerDisplayName(lobby, playerId);
  const previousPlayer = previousState.players.find(
    (player) => player.id === playerId,
  );
  const nextPlayer = nextState.players.find((player) => player.id === playerId);
  const amountToCall = previousPlayer
    ? Math.max(0, previousState.currentBet - previousPlayer.currentBet)
    : 0;

  if (action === "fold") {
    return `${name} folded.`;
  }

  if (action === "check") {
    return `${name} checked.`;
  }

  if (action === "call") {
    const callAmount = previousPlayer
      ? Math.min(amountToCall, previousPlayer.stack)
      : amountToCall;

    return `${name} called ${formatChips(callAmount)}.`;
  }

  const totalBet = inputTotalBet ?? nextPlayer?.currentBet ?? previousState.currentBet;

  if (nextPlayer?.allIn) {
    return `${name} moved all-in for ${formatChips(totalBet)}.`;
  }

  return `${name} raised to ${formatChips(totalBet)}.`;
}

function describeHandComplete(payload: PublicHandCompletePayload) {
  const winnerNames = payload.winners.map((winner) => winner.name ?? "Player");
  const handDescription =
    payload.winningHandDescription ?? payload.winningHandName ?? null;
  const winnerText =
    winnerNames.length === 0
      ? "Hand complete"
      : winnerNames.length === 1
        ? `${winnerNames[0]} wins`
        : `${winnerNames.join(", ")} split`;

  return handDescription
    ? `${winnerText} ${formatChips(payload.potSize)} with ${handDescription}.`
    : `${winnerText} ${formatChips(payload.potSize)}.`;
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
      lobby,
      engine: buildEngineFromLobby(lobby, this.options.deckProvider?.(lobby)),
      handNumber: 1,
      logSequence: 0,
      actionLog: [],
      handHistory: [],
      startedByUserId: requestedByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.appendActionLog(table, "Hand 1 started. Dealing pre-flop.", "deal");

    await this.options.activateLobby?.(lobbyId);
    this.tables.set(lobbyId, table);

    console.log("[table-runtime] game started", {
      lobbyId,
      startedByUserId: requestedByUserId,
    });

    await this.broadcastTableState(lobbyId);
    await this.options.onLobbyUpdated?.(lobbyId);

    return table.engine.getState();
  }

  async applyPlayerAction(
    lobbyId: string,
    playerId: string,
    input: PlayerActionInput,
  ) {
    const table = this.requireTable(lobbyId);
    const action = readActionType(input);
    const raiseTotal = action === "raise" ? readRaiseTotal(input) : undefined;
    const previousState = table.engine.getState();
    let state: PokerStateSnapshot;

    if (action === "fold") {
      state = table.engine.fold(playerId);
    } else if (action === "check") {
      state = table.engine.check(playerId);
    } else if (action === "call") {
      state = table.engine.call(playerId);
    } else {
      state = table.engine.raise(playerId, raiseTotal ?? readRaiseTotal(input));
    }

    table.updatedAt = new Date();
    this.appendActionLog(
      table,
      describePlayerAction({
        action,
        inputTotalBet: raiseTotal,
        lobby: table.lobby,
        playerId,
        previousState,
        nextState: state,
      }),
      "action",
    );
    this.appendPhaseChangeLogs(table, previousState, state);

    console.log("[table-runtime] player action accepted", {
      lobbyId,
      playerId,
      action,
      phase: state.phase,
    });

    if (isTerminalState(state)) {
      await this.completeHand(table, state);
      return state;
    }

    await this.broadcastTableState(lobbyId);

    return state;
  }

  async emitTableStateToRecipient(
    lobbyId: string,
    recipient: TableRuntimeRecipient,
  ) {
    const table = this.requireTable(lobbyId);
    const state = table.engine.getState();

    await recipient.emitGameState(
      sanitizeTableStateForPlayer(lobbyId, state, recipient.userId, {
        actionLog: table.actionLog,
        handHistory: table.handHistory,
      }),
    );

    if (table.lastHandCompletePayload) {
      await recipient.emitHandComplete?.(table.lastHandCompletePayload);
    }
  }

  async broadcastTableState(lobbyId: string) {
    const table = this.requireTable(lobbyId);
    const state = table.engine.getState();
    const recipients = await this.options.getRecipients(lobbyId);

    for (const recipient of recipients) {
      await recipient.emitGameState(
        sanitizeTableStateForPlayer(lobbyId, state, recipient.userId, {
          actionLog: table.actionLog,
          handHistory: table.handHistory,
        }),
      );
    }

    console.log("[table-runtime] emitted game_state_update", {
      lobbyId,
      recipients: recipients.length,
    });

    return recipients.length;
  }

  private async completeHand(table: ActiveTable, state: PokerStateSnapshot) {
    const completedAt = new Date();
    const restartDelayMs = canStartNextHand(state)
      ? (this.options.handRestartDelayMs ?? DEFAULT_HAND_RESTART_DELAY_MS)
      : null;
    const payload = buildHandCompletePayload(
      table,
      state,
      completedAt,
      restartDelayMs,
    );

    table.lastHandCompletePayload = payload;
    table.handHistory = [buildHandHistoryEntry(payload), ...table.handHistory].slice(
      0,
      3,
    );
    this.appendActionLog(table, describeHandComplete(payload), "award", completedAt);

    await this.options.persistCompletedHand?.({
      lobbyId: table.lobbyId,
      handNumber: table.handNumber,
      potSize: payload.potSize,
      winnerUserIds: payload.winners.map((winner) => winner.playerId),
      winningHandName: payload.winningHandName,
      winningHandDescription: payload.winningHandDescription,
      board: state.board,
      awards: state.pot.awards,
      showdownHands: state.showdownHands,
      completedAt,
      playerStacks: state.players.map((player) => ({
        userId: player.id,
        chipStack: player.stack,
      })),
    });

    await this.broadcastTableState(table.lobbyId);
    await this.emitHandComplete(table.lobbyId, payload);
    await this.options.onLobbyUpdated?.(table.lobbyId);

    if (restartDelayMs === null) {
      return;
    }

    if (restartDelayMs > 0) {
      await delay(restartDelayMs);
    }

    table.handNumber += 1;
    table.lastHandCompletePayload = undefined;
    table.engine.startHand({
      deck: this.options.deckProvider?.(table.lobby),
    });
    table.logSequence = 0;
    table.actionLog = [];
    this.appendActionLog(
      table,
      `Hand ${table.handNumber} started. Dealing pre-flop.`,
      "deal",
    );
    table.updatedAt = new Date();

    await this.broadcastTableState(table.lobbyId);

    console.log("[table-runtime] next hand started", {
      lobbyId: table.lobbyId,
      handNumber: table.handNumber,
    });
  }

  private async emitHandComplete(
    lobbyId: string,
    payload: PublicHandCompletePayload,
  ) {
    const recipients = await this.options.getRecipients(lobbyId);

    for (const recipient of recipients) {
      await recipient.emitHandComplete?.(payload);
    }

    console.log("[table-runtime] emitted hand_complete", {
      lobbyId,
      handNumber: payload.handNumber,
      recipients: recipients.length,
    });
  }

  private appendActionLog(
    table: ActiveTable,
    message: string,
    tone: PublicGameLogEntry["tone"],
    at = new Date(),
  ) {
    table.logSequence += 1;
    table.actionLog = [
      ...table.actionLog,
      {
        id: `${table.handNumber}-${table.logSequence}`,
        handNumber: table.handNumber,
        at: at.toISOString(),
        message,
        tone,
      },
    ].slice(-40);
  }

  private appendPhaseChangeLogs(
    table: ActiveTable,
    previousState: PokerStateSnapshot,
    nextState: PokerStateSnapshot,
  ) {
    for (
      let boardLength = previousState.board.length + 1;
      boardLength <= nextState.board.length;
      boardLength += 1
    ) {
      const message = describePhaseDeal(boardLength);

      if (message) {
        this.appendActionLog(table, message, "deal");
      }
    }

    if (previousState.phase !== "SHOWDOWN" && nextState.phase === "SHOWDOWN") {
      this.appendActionLog(table, "Showdown. Revealing live hands.", "showdown");
    }
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
