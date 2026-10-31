// Showdown helpers: hand evaluation per board and showing order.
import { cardToIndex, indexToCard, type Card } from "./cards";
import { bestFiveIndices, evaluateIndices, handDescription, handName } from "./evaluator";
import { evaluateOmahaIndices } from "./omaha";
import { effectiveButtonSeat } from "./button";
import { seatsFrom } from "./positions";
import type { BoardHand, HandState, PlayerState, Variant } from "./types";

export function evaluateBoardHand(variant: Variant, hole: readonly Card[], board: readonly Card[], boardIndex: number): BoardHand {
  const h = hole.map(cardToIndex);
  const b = board.map(cardToIndex);
  let value: number;
  let five: number[];
  if (variant === "PLO") {
    const best: number[] = [];
    value = evaluateOmahaIndices(h, b, best);
    five = bestFiveIndices(best, value);
  } else {
    const all = [...h, ...b];
    value = evaluateIndices(all);
    five = bestFiveIndices(all, value);
  }
  return { boardIndex, value, name: handName(value), description: handDescription(value), bestFive: five.map(indexToCard) };
}

/**
 * Showing order: the last aggressor of the final betting round shows first when still in the hand,
 * otherwise the first live player left of the button; then clockwise.
 */
export function showdownOrder(state: HandState): PlayerState[] {
  const live = state.players.filter((p) => !p.folded);
  const seats = live.map((p) => p.seat);
  const aggressor = live.find((p) => p.id === state.finalAggressorId);
  const order = aggressor
    ? [aggressor.seat, ...seatsFrom(seats, aggressor.seat).filter((s) => s !== aggressor.seat)]
    : seatsFrom(seats, effectiveButtonSeat(state));
  return order.map((seat) => live.find((p) => p.seat === seat)!);
}

/** Player ids ordered clockwise starting left of the button (odd-chip order). */
export function oddChipOrder(state: HandState, ids: readonly string[]): string[] {
  const bySeat = new Map(state.players.map((p) => [p.seat, p.id]));
  const seats = state.players.filter((p) => ids.includes(p.id)).map((p) => p.seat);
  return seatsFrom(seats, effectiveButtonSeat(state)).map((s) => bySeat.get(s)!);
}
