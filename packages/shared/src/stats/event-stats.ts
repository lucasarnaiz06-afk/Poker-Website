// Per-hand player stat flags derived from a stored event log. Same definitions as the engine's
// computeStats (PokerTracker style), plus fold-to-c-bet and open-limp, which the engine summary lacks.
// Used at query time for stats that have no HandPlayer column (3-bet %, c-bet, AF, ...).
import type { ActionEvent, Street } from "@poker-platform/engine";

export type EventStats = {
  vpip: boolean;
  pfr: boolean;
  limp: boolean;
  threeBet: boolean;
  threeBetOpportunity: boolean;
  facedThreeBet: boolean;
  foldedToThreeBet: boolean;
  cbet: boolean;
  cbetOpportunity: boolean;
  facedCbet: boolean;
  foldedToCbet: boolean;
  sawFlop: boolean;
  postflopBets: number;
  postflopRaises: number;
  postflopCalls: number;
};

type MinimalEvent = { type: string; street?: Street | string; players?: Array<{ id: string }> };

function empty(): EventStats {
  return {
    vpip: false,
    pfr: false,
    limp: false,
    threeBet: false,
    threeBetOpportunity: false,
    facedThreeBet: false,
    foldedToThreeBet: false,
    cbet: false,
    cbetOpportunity: false,
    facedCbet: false,
    foldedToCbet: false,
    sawFlop: false,
    postflopBets: 0,
    postflopRaises: 0,
    postflopCalls: 0,
  };
}

/**
 * Stats for every player in the hand. `playerIds` defaults to the HAND_START player list.
 * Bomb pots have no preflop betting: every preflop flag and c-bet stays false.
 */
export function computeEventStats(
  events: readonly unknown[],
  options: { isBombPot: boolean; playerIds?: readonly string[] },
): Map<string, EventStats> {
  const list = events as readonly MinimalEvent[];
  const start = list.find((e) => e.type === "HAND_START");
  const ids = options.playerIds ?? start?.players?.map((p) => p.id) ?? [];
  const stats = new Map<string, EventStats>(ids.map((id) => [id, empty()]));
  const get = (id: string) => {
    let s = stats.get(id);
    if (!s) {
      s = empty();
      stats.set(id, s);
    }
    return s;
  };
  const actions = list.filter((e) => e.type === "ACTION") as unknown as ActionEvent[];
  const flopDealt = list.some((e) => e.type === "STREET" && e.street === "FLOP");
  const foldedPreflop = new Set(actions.filter((a) => a.street === "PREFLOP" && a.action === "fold").map((a) => a.playerId));
  if (flopDealt) for (const [id, s] of stats) s.sawFlop = !foldedPreflop.has(id);

  let preflopAggressor: string | null = null;
  if (!options.isBombPot) {
    let openRaiser: string | null = null;
    const actedPreflop = new Set<string>();
    for (const a of actions) {
      if (a.street !== "PREFLOP") continue;
      const s = get(a.playerId);
      const voluntary = a.action === "call" || a.action === "bet" || a.action === "raise";
      if (voluntary) s.vpip = true;
      if (a.action === "call" && a.raisesBefore === 0 && !actedPreflop.has(a.playerId)) s.limp = true;
      if (a.action === "raise" || a.action === "bet") {
        s.pfr = true;
        preflopAggressor = a.playerId;
        if (a.raisesBefore === 0) openRaiser = a.playerId;
      }
      if (a.raisesBefore === 1 && a.playerId !== openRaiser) {
        if (a.couldRaise) s.threeBetOpportunity = true;
        if (a.action === "raise") s.threeBet = true;
      }
      if (a.raisesBefore === 2 && a.playerId === openRaiser) {
        s.facedThreeBet = true;
        if (a.action === "fold") s.foldedToThreeBet = true;
      }
      actedPreflop.add(a.playerId);
    }
  }

  let flopBetMade = false;
  let cbetMade = false;
  const respondedToCbet = new Set<string>();
  for (const a of actions) {
    if (a.street === "PREFLOP") continue;
    const s = get(a.playerId);
    if (a.street === "FLOP") {
      if (preflopAggressor !== null && a.playerId === preflopAggressor && !flopBetMade && a.couldRaise) {
        s.cbetOpportunity = true;
        if (a.action === "bet") {
          s.cbet = true;
          cbetMade = true;
        }
      } else if (cbetMade && a.raisesBefore === 1 && !respondedToCbet.has(a.playerId) && a.playerId !== preflopAggressor) {
        // First response to the c-bet (before any raise).
        respondedToCbet.add(a.playerId);
        s.facedCbet = true;
        if (a.action === "fold") s.foldedToCbet = true;
      }
      if (a.action === "bet" || a.action === "raise") flopBetMade = true;
      if (a.action === "raise") cbetMade = false;
    }
    if (a.action === "bet") s.postflopBets++;
    else if (a.action === "raise") s.postflopRaises++;
    else if (a.action === "call") s.postflopCalls++;
  }
  return stats;
}
