// Internal (not re-exported from index): the seat that acts as the button for action order and odd chips.
import { nextSeat } from "./positions";
import type { HandState } from "./types";

/**
 * Heads-up the small blind is the button: it acts first preflop and last postflop, and the odd chip goes
 * to the big blind. With a dead button heads-up (e.g. 3 -> 2 handed after a bust) the SB is the first seat
 * left of the empty button seat, so that seat is used as the effective button. Otherwise the button seat.
 */
export function effectiveButtonSeat(state: HandState): number {
  const button = state.positions.buttonSeat;
  if (state.players.length !== 2 || state.players.some((p) => p.seat === button)) return button;
  return nextSeat(
    state.players.map((p) => p.seat),
    button,
  );
}
