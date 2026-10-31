// Seat order helpers. "Left of" a seat means the next occupied seat clockwise (increasing seat
// numbers, wrapping around).
import { EngineError } from "./errors";
import type { Positions } from "./types";

/** First seat in `sortedSeats` strictly after `from`, wrapping around. */
export function nextSeat(sortedSeats: readonly number[], from: number): number {
  if (sortedSeats.length === 0) throw new EngineError("INVALID_CONFIG", "No seats");
  for (const s of sortedSeats) if (s > from) return s;
  return sortedSeats[0]!;
}

/** All seats in clockwise order starting with the first seat after `from`. */
export function seatsFrom(sortedSeats: readonly number[], from: number): number[] {
  const after = sortedSeats.filter((s) => s > from);
  const before = sortedSeats.filter((s) => s <= from);
  return [...after, ...before];
}

/**
 * Blind positions for the dealt-in seats given the button. Heads-up the button posts the small blind
 * (and acts first preflop, last postflop) when it is dealt in.
 */
export function computePositions(seats: readonly number[], buttonSeat: number): Positions {
  const sorted = [...seats].sort((a, b) => a - b);
  if (sorted.length < 2) throw new EngineError("INVALID_CONFIG", "At least two players are required");
  if (new Set(sorted).size !== sorted.length) throw new EngineError("INVALID_CONFIG", "Duplicate seats");
  let smallBlindSeat: number;
  if (sorted.length === 2 && sorted.includes(buttonSeat)) smallBlindSeat = buttonSeat;
  else smallBlindSeat = nextSeat(sorted, buttonSeat);
  const bigBlindSeat = nextSeat(sorted, smallBlindSeat);
  const straddleSeat = sorted.length >= 3 ? nextSeat(sorted, bigBlindSeat) : null;
  return { buttonSeat, smallBlindSeat, bigBlindSeat, straddleSeat, dealOrder: seatsFrom(sorted, buttonSeat) };
}
