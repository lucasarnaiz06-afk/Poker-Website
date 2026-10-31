// All-in EV: what each player would have won on average from the moment the action closed all-in,
// using the cards and board at that moment (PokerTracker "All-in adj. EV").
import { calculateEquity, type Card, type HandSummary, type RandomInt } from "@poker-platform/engine";

export type AllInEvOptions = {
  /** Exact enumeration budget (default 600,000 evaluations: flop/turn exact, preflop Monte Carlo). */
  maxExactEvaluations?: number;
  iterations?: number;
  randomInt?: RandomInt;
};

/**
 * Expected chips won per player (from pots only) at the all-in moment, or null when the hand was not decided
 * by an all-in runout (or uses a double board, where a single all-in board is ambiguous).
 */
export function allInExpectedWinnings(summary: HandSummary, options: AllInEvOptions = {}): Map<string, number> | null {
  if (!summary.allIn || summary.doubleBoard) return null;
  const byId = new Map(summary.players.map((p) => [p.id, p]));
  const expected = new Map<string, number>();
  for (const pot of summary.pots) {
    const eligible = pot.eligiblePlayerIds.filter((id) => {
      const p = byId.get(id);
      return p && !p.folded && p.holeCards.length > 0;
    });
    if (eligible.length === 0) continue;
    if (eligible.length === 1) {
      expected.set(eligible[0]!, (expected.get(eligible[0]!) ?? 0) + pot.amount);
      continue;
    }
    const result = calculateEquity({
      hands: eligible.map((id) => byId.get(id)!.holeCards as Card[]),
      board: summary.allIn.board as Card[],
      variant: summary.variant,
      maxExactEvaluations: options.maxExactEvaluations ?? 600_000,
      iterations: options.iterations ?? 20_000,
      randomInt: options.randomInt,
    });
    eligible.forEach((id, i) => {
      expected.set(id, (expected.get(id) ?? 0) + pot.amount * result.results[i]!.equity);
    });
  }
  return expected;
}

/**
 * All-in EV net per player: actual net with the pot winnings replaced by their expectation (rounded to whole
 * chips). Players in the hand but not in the all-in keep their actual net. null when not an all-in hand.
 */
export function allInEvNets(
  summary: HandSummary,
  netById: ReadonlyMap<string, number>,
  options: AllInEvOptions = {},
): Map<string, number> | null {
  const expected = allInExpectedWinnings(summary, options);
  if (!expected) return null;
  const out = new Map<string, number>();
  for (const p of summary.players) {
    const net = netById.get(p.id) ?? p.net;
    const ev = expected.get(p.id);
    out.set(p.id, ev === undefined ? net : Math.round(net - p.won + ev));
  }
  return out;
}
