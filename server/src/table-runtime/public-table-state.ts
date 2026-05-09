import type { PublicTableState } from "@poker-platform/shared/types";
import type { PokerStateSnapshot } from "../poker-engine";

export type { PublicTableState } from "@poker-platform/shared/types";

export function sanitizeTableStateForPlayer(
  lobbyId: string,
  state: PokerStateSnapshot,
  viewerPlayerId: string,
): PublicTableState {
  const showdownPlayerIds = new Set(
    state.phase === "SHOWDOWN"
      ? state.showdownHands.map((hand) => hand.playerId)
      : [],
  );

  return {
    lobbyId,
    viewerPlayerId,
    phase: state.phase,
    buttonSeat: state.buttonSeat,
    currentTurnSeat: state.currentTurnSeat,
    currentTurnPlayerId: state.currentTurnPlayerId,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    board: state.board,
    burnedCardCount: state.burnedCards.length,
    pot: state.pot,
    showdownHands: state.showdownHands,
    players: state.players.map((player) => {
      const isViewer = player.id === viewerPlayerId;
      const shouldRevealHoleCards =
        isViewer || showdownPlayerIds.has(player.id);

      return {
        ...player,
        holeCards: shouldRevealHoleCards ? player.holeCards : [],
        hasHiddenHoleCards: !shouldRevealHoleCards && player.holeCards.length > 0,
        isViewer,
      };
    }),
  };
}
