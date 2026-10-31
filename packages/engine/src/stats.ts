// Per-hand player stat flags (PokerTracker definitions), derived from the event log.
//
// - VPIP: voluntarily put chips in preflop (call, bet or raise; posting blinds/straddle/antes and the big
//   blind checking do not count).
// - PFR: raised preflop.
// - 3-bet: re-raised preflop when facing exactly one raise. Opportunity: acted preflop facing exactly one
//   raise (made by someone else) while a raise was legal.
// - Faced 3-bet / folded to 3-bet: the open raiser faced exactly one re-raise, and folded to it.
// - C-bet: the preflop aggressor (last preflop raiser) made the first bet on the flop. Opportunity: the
//   preflop aggressor acted on the flop before anyone bet, with a bet legal.
// - Saw flop: still in the hand when the flop was dealt.
// Bomb pots have no preflop betting: every preflop flag (and c-bet) is false for them.
import type { ActionEvent, HandState, PlayerStats } from "./types";

function emptyStats(): PlayerStats {
  return {
    vpip: false,
    pfr: false,
    threeBet: false,
    threeBetOpportunity: false,
    facedThreeBet: false,
    foldedToThreeBet: false,
    cbet: false,
    cbetOpportunity: false,
    sawFlop: false,
    postflopBets: 0,
    postflopRaises: 0,
    postflopCalls: 0,
    postflopChecks: 0,
    postflopFolds: 0,
  };
}

export function computeStats(state: HandState): { stats: Map<string, PlayerStats>; isWalk: boolean } {
  const stats = new Map<string, PlayerStats>(state.players.map((p) => [p.id, emptyStats()]));
  const actions = state.events.filter((e): e is ActionEvent => e.type === "ACTION");
  const isBombPot = state.config.bombPot !== null;
  const flopDealt = state.events.some((e) => e.type === "STREET" && e.street === "FLOP");

  for (const p of state.players) {
    const s = stats.get(p.id)!;
    s.sawFlop = flopDealt && p.foldedStreet !== "PREFLOP";
  }

  let preflopAggressor: string | null = null;
  if (!isBombPot) {
    let openRaiser: string | null = null;
    for (const a of actions) {
      if (a.street !== "PREFLOP") continue;
      const s = stats.get(a.playerId)!;
      const voluntary = a.action === "call" || a.action === "bet" || a.action === "raise";
      if (voluntary) s.vpip = true;
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
    }
  }

  let flopBetMade = false;
  for (const a of actions) {
    if (a.street === "PREFLOP") continue;
    const s = stats.get(a.playerId)!;
    if (a.street === "FLOP" && preflopAggressor !== null && a.playerId === preflopAggressor && !flopBetMade && a.couldRaise) {
      s.cbetOpportunity = true;
      if (a.action === "bet") s.cbet = true;
    }
    if (a.street === "FLOP" && (a.action === "bet" || a.action === "raise")) flopBetMade = true;
    if (a.action === "bet") s.postflopBets++;
    else if (a.action === "raise") s.postflopRaises++;
    else if (a.action === "call") s.postflopCalls++;
    else if (a.action === "check") s.postflopChecks++;
    else if (a.action === "fold") s.postflopFolds++;
  }

  const preflop = actions.filter((a) => a.street === "PREFLOP");
  const live = state.players.filter((p) => !p.folded);
  const isWalk =
    !isBombPot &&
    !flopDealt &&
    live.length === 1 &&
    live[0]!.seat === state.positions.bigBlindSeat &&
    preflop.every((a) => a.action === "fold");
  return { stats, isWalk };
}
