// Pot construction (main + side pots) and chip splitting.
import type { Pot } from "./types";

export type PotEntry = {
  id: string;
  committed: number; // total chips this player put in
  folded: boolean;
  allIn: boolean; // caps the pots this player can win at `committed`
};

/**
 * Builds pots from total contributions. Each all-in amount of a live player caps a layer; folded
 * players' chips are dead money in the layers they reach. A layer above every live player's contribution
 * (only possible with out-of-turn folds) can be won by the live players who are not all-in (an all-in
 * player never wins more than they matched); if there are none it is merged into the previous pot (the
 * hand returns such chips before settling). Consecutive layers with the same eligible players are
 * merged. Entries must be given in seat order; eligible ids keep that order.
 */
export function buildPots(entries: readonly PotEntry[]): Pot[] {
  const max = entries.reduce((m, e) => Math.max(m, e.committed), 0);
  if (max === 0) return [];
  const caps = new Set<number>();
  for (const e of entries) if (!e.folded && e.allIn && e.committed > 0 && e.committed < max) caps.add(e.committed);
  const levels = [...caps].sort((a, b) => a - b);
  levels.push(max);

  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const e of entries) amount += Math.min(e.committed, level) - Math.min(e.committed, prev);
    let eligible = entries.filter((e) => !e.folded && e.committed >= level).map((e) => e.id);
    if (eligible.length === 0) eligible = entries.filter((e) => !e.folded && !e.allIn).map((e) => e.id);
    prev = level;
    if (amount === 0) continue;
    const last = pots[pots.length - 1];
    if (eligible.length === 0) {
      if (last) last.amount += amount;
      else pots.push({ amount, eligiblePlayerIds: entries.filter((e) => !e.folded).map((e) => e.id) });
      continue;
    }
    if (last && sameIds(last.eligiblePlayerIds, eligible)) last.amount += amount;
    else pots.push({ amount, eligiblePlayerIds: eligible });
  }
  return pots;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Splits `amount` between winners. `winnersInOrder` must be ordered clockwise starting left of the
 * button: odd chips go one each to the first winners in that order.
 */
export function splitAmount(amount: number, winnersInOrder: readonly string[]): Array<{ id: string; amount: number }> {
  const n = winnersInOrder.length;
  if (n === 0) return [];
  const base = Math.floor(amount / n);
  let remainder = amount - base * n;
  return winnersInOrder.map((id) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { id, amount: base + extra };
  });
}

/** Splits a pot between boards: board 0 gets the odd chip. */
export function splitBetweenBoards(amount: number, boards: number): number[] {
  if (boards <= 1) return [amount];
  const base = Math.floor(amount / boards);
  let remainder = amount - base * boards;
  return Array.from({ length: boards }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}
