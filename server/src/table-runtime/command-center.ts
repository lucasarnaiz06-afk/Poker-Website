// Admin "command center" views (password-protected HTTP routes). Admins see hole cards on purpose.
import type {
  CommandCenterGameDetail,
  CommandCenterGameSummary,
  CommandCenterPlayer,
  PublicGameLogEntry,
  PublicTablePhase,
} from "@poker-platform/shared/types";
import { fail } from "./errors";
import { publicCards } from "./hand-utils";
import type { TableRuntime } from "./runtime";
import type { Table } from "./table";

const PHASES: Record<string, PublicTablePhase> = {
  PREFLOP: "PRE_FLOP",
  FLOP: "FLOP",
  TURN: "TURN",
  RIVER: "RIVER",
  SHOWDOWN: "SHOWDOWN",
  COMPLETE: "COMPLETE",
};

function phaseOf(table: Table): PublicTablePhase {
  if (!table.hand) return "NOT_STARTED";
  if (table.hand.completedAt) return "COMPLETE";
  return PHASES[table.hand.engine.phase] ?? "NOT_STARTED";
}

function players(table: Table): CommandCenterPlayer[] {
  const snapshot = table.hand?.engine.snapshot() ?? null;
  return [...table.seats.values()]
    .sort((a, b) => a.seat - b.seat)
    .map((seat) => {
      const p = snapshot?.players.find((q) => q.id === seat.userId) ?? null;
      const live = p !== null && !table.hand!.completedAt;
      return {
        id: seat.userId,
        name: seat.profile.displayName,
        seat: seat.seat,
        stack: live ? p.stack : seat.stack,
        holeCards: p ? publicCards(p.holeCards) : [],
        folded: p?.folded ?? false,
        allIn: live ? p.allIn : false,
        currentBet: live ? p.streetBet : 0,
        committed: p?.committed ?? 0,
        hasActed: p?.lastAction !== null && p?.lastAction !== undefined,
        inHand: live && !p.folded,
      };
    });
}

function summary(table: Table): CommandCenterGameSummary {
  const snapshot = table.hand?.engine.snapshot() ?? null;
  const actorId = table.hand && !table.hand.completedAt ? snapshot?.toActPlayerId ?? null : null;
  const list = players(table);
  return {
    lobbyId: table.id,
    lobbyName: table.record.name,
    phase: phaseOf(table),
    handNumber: table.hand?.number ?? table.handNumber,
    playerCount: table.seats.size,
    maxPlayers: table.settings.maxPlayers,
    currentTurnPlayerId: actorId,
    currentTurnPlayerName: actorId ? (table.seatOf(actorId)?.profile.displayName ?? null) : null,
    potTotal: snapshot?.totalPot ?? 0,
    board: snapshot ? publicCards(snapshot.boards[0] ?? []) : [],
    updatedAt: new Date().toISOString(),
    players: list.map(({ id, name, seat, stack, folded, allIn, currentBet, inHand }) => ({
      id,
      name,
      seat,
      stack,
      folded,
      allIn,
      currentBet,
      inHand,
    })),
  };
}

function detail(table: Table): CommandCenterGameDetail {
  const base = summary(table);
  const snapshot = table.hand?.engine.snapshot() ?? null;
  const log: PublicGameLogEntry[] = table.log.slice(-100).map((entry) => ({
    id: entry.id,
    handNumber: entry.handNumber ?? 0,
    at: entry.at,
    message: entry.text,
    tone: entry.kind === "deal" || entry.kind === "action" || entry.kind === "showdown" || entry.kind === "award" ? entry.kind : "system",
  }));
  return {
    lobbyId: base.lobbyId,
    lobbyName: base.lobbyName,
    handNumber: base.handNumber,
    phase: base.phase,
    buttonSeat: snapshot?.buttonSeat ?? table.buttonSeat,
    currentTurnSeat: base.currentTurnPlayerId ? (table.seatOf(base.currentTurnPlayerId)?.seat ?? null) : null,
    currentTurnPlayerId: base.currentTurnPlayerId,
    currentTurnPlayerName: base.currentTurnPlayerName,
    currentBet: snapshot?.currentBet ?? 0,
    minRaise: snapshot?.minRaise ?? table.settings.bigBlind,
    smallBlind: table.settings.smallBlind,
    bigBlind: table.settings.bigBlind,
    board: base.board,
    burnedCards: [],
    deckCount: 0,
    updatedAt: base.updatedAt,
    createdAt: base.updatedAt,
    startedByUserId: table.record.hostUserId,
    startedByName: table.profiles.get(table.record.hostUserId)?.displayName ?? null,
    pot: {
      total: base.potTotal,
      sidePots: (snapshot?.pots ?? []).map((pot) => ({
        amount: pot.amount,
        contributorPlayerIds: pot.eligiblePlayerIds,
        eligiblePlayerIds: pot.eligiblePlayerIds,
      })),
      awards: [],
    },
    showdownHands: [],
    actionLog: log,
    handHistory: [],
    lastHandCompletePayload: null,
    players: players(table),
  };
}

export function listCommandCenterGames(runtime: TableRuntime) {
  return [...runtime.tables.values()].map(summary);
}

export function getCommandCenterGame(runtime: TableRuntime, tableId: string) {
  const table = runtime.tables.get(tableId);
  if (!table) fail("GAME_NOT_STARTED", "This table is not running.");
  return detail(table);
}
