// Betting rules as pure functions over HandState.
//
// Key rules:
// - currentBet is the street level everybody must match. Preflop it is at least the nominal big blind
//   (or straddle) even when that blind is short all-in.
// - minRaise is the size of the last full bet/raise (starts at the big blind, or the straddle).
// - A bet/raise smaller than minRaise is only possible all-in ("incomplete"); it does not change minRaise.
// - Reopening: a player who already acted this street may raise again only when the total raised since
//   their last action is at least one full raise (currentBet - actedLevel >= minRaise). So an incomplete
//   all-in lets them only call or fold, while several incomplete all-ins that add up to a full raise reopen.
// - Nobody may bet/raise when no other live player could respond (everyone else folded or all-in), and
//   then the call level is capped at the largest live bet facing them.
import type { HandState, LegalActions, PlayerState } from "./types";

export function potTotal(state: HandState): number {
  let total = 0;
  for (const p of state.players) total += p.committed;
  return total;
}

export function liveCount(state: HandState): number {
  let n = 0;
  for (const p of state.players) if (!p.folded) n++;
  return n;
}

/** Live players who still have chips (can act on later streets). */
export function canActCount(state: HandState): number {
  let n = 0;
  for (const p of state.players) if (!p.folded && !p.allIn) n++;
  return n;
}

export function othersCanAct(state: HandState, player: PlayerState): boolean {
  return state.players.some((q) => q !== player && !q.folded && !q.allIn);
}

/** Street total this player must reach to call. */
export function callLevel(state: HandState, player: PlayerState, others = othersCanAct(state, player)): number {
  if (others) return state.currentBet;
  let maxLive = 0;
  for (const q of state.players) if (q !== player && !q.folded) maxLive = Math.max(maxLive, q.streetBet);
  return Math.min(state.currentBet, maxLive);
}

export function needsAction(state: HandState, player: PlayerState): boolean {
  if (player.folded || player.allIn) return false;
  const others = othersCanAct(state, player);
  if (player.streetBet < callLevel(state, player, others)) return true;
  return !player.hasActed && others;
}

/** Next player needing action, scanning clockwise from the seat after `fromSeat`. */
export function findNextActor(state: HandState, fromSeat: number): PlayerState | null {
  const players = state.players;
  const n = players.length;
  let start = players.findIndex((p) => p.seat > fromSeat);
  if (start < 0) start = 0;
  for (let k = 0; k < n; k++) {
    const p = players[(start + k) % n]!;
    if (needsAction(state, p)) return p;
  }
  return null;
}

/** Legal actions for `player`, assuming it is their turn. */
export function computeLegalActions(state: HandState, player: PlayerState): LegalActions {
  const others = othersCanAct(state, player);
  const level = callLevel(state, player, others);
  const toCall = Math.max(0, level - player.streetBet);
  const callAmount = Math.min(toCall, player.stack);
  const reopened = !player.hasActed || state.currentBet - player.actedLevel >= state.minRaise;
  const canBetOrRaise = others && player.stack > toCall && reopened;
  const isBet = state.currentBet === 0;
  if (!canBetOrRaise) {
    return { canFold: true, canCheck: toCall === 0, callAmount, canBetOrRaise: false, isBet, minTo: 0, maxTo: 0, potTo: 0 };
  }
  const allInTo = player.streetBet + player.stack;
  const minTo = Math.min(state.currentBet + state.minRaise, allInTo);
  // Pot-sized raise: call first, then raise by the whole pot (including the call).
  const potRaiseTo = state.currentBet + potTotal(state) + (state.currentBet - player.streetBet);
  const maxTo = state.config.variant === "PLO" ? Math.min(allInTo, Math.max(potRaiseTo, minTo)) : allInTo;
  const potTo = Math.min(maxTo, Math.max(minTo, potRaiseTo));
  return { canFold: true, canCheck: toCall === 0, callAmount, canBetOrRaise: true, isBet, minTo, maxTo, potTo };
}
