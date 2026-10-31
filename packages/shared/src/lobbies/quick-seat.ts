import type { LobbyTableSummary } from "../types/table-view";

export type QuickSeatOptions = {
  /** Big blind the player plays most (null without history). */
  usualBigBlind: number | null;
  /** Wallet balance: tables whose minimum buy-in is out of reach are skipped. */
  balance: number;
  /** Tables to skip (e.g. ones the player is already seated at). */
  excludeTableIds?: ReadonlySet<string>;
};

/**
 * "Play now": the public table to drop a player into. Only joinable tables count (public, open, no password,
 * a free seat, minimum buy-in affordable). Stakes first: the player's usual big blind (or the closest one),
 * else the lowest; then the best-filled table at those stakes (ties: the smaller table, so it fills up).
 */
export function pickQuickSeatTable(tables: readonly LobbyTableSummary[], options: QuickSeatOptions): LobbyTableSummary | null {
  const candidates = tables.filter(
    (table) =>
      table.visibility === "PUBLIC" &&
      table.status !== "CLOSED" &&
      !table.hasPassword &&
      table.seated < table.maxPlayers &&
      table.minBuyIn <= options.balance &&
      !options.excludeTableIds?.has(table.tableId),
  );

  if (candidates.length === 0) {
    return null;
  }

  const target = options.usualBigBlind;
  const distance = (bb: number) => (target && target > 0 ? Math.abs(Math.log(bb / target)) : bb);
  const best = Math.min(...candidates.map((table) => distance(table.bigBlind)));
  const atStakes = candidates.filter((table) => distance(table.bigBlind) === best);

  return [...atStakes].sort(
    (a, b) => b.seated - a.seated || a.maxPlayers - b.maxPlayers || a.tableId.localeCompare(b.tableId),
  )[0]!;
}

/** Most frequent value (ties: the lower one); null for an empty list. */
export function mostCommon(values: readonly number[]): number | null {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
