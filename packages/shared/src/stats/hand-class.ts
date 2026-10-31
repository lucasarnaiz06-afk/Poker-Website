// Starting-hand classes ("AKs", "T9o", "77") and the 13x13 grid. Browser-safe.
export const GRID_RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

/** "AKs" / "AKo" / "TT" for two Hold'em hole cards, null otherwise (PLO, missing cards). */
export function handClass(cards: readonly string[] | null | undefined): string | null {
  if (!cards || cards.length !== 2) return null;
  const [a, b] = cards as [string, string];
  const ia = GRID_RANKS.indexOf(a[0] as (typeof GRID_RANKS)[number]);
  const ib = GRID_RANKS.indexOf(b[0] as (typeof GRID_RANKS)[number]);
  if (ia < 0 || ib < 0 || a.length !== 2 || b.length !== 2) return null;
  if (ia === ib) return `${a[0]}${b[0]}`;
  const [hi, lo] = ia < ib ? [a, b] : [b, a];
  return `${hi[0]}${lo[0]}${a[1] === b[1] ? "s" : "o"}`;
}

/** Label of grid cell (row, col): pairs on the diagonal, suited above it, offsuit below. */
export function gridLabel(row: number, col: number): string {
  const r = GRID_RANKS[row]!;
  const c = GRID_RANKS[col]!;
  if (row === col) return `${r}${c}`;
  return row < col ? `${r}${c}s` : `${c}${r}o`;
}

/** Number of card combinations in a class (6 pairs, 4 suited, 12 offsuit). */
export function classCombos(label: string): number {
  return label.length === 2 ? 6 : label.endsWith("s") ? 4 : 12;
}

/** All 169 labels, row-major (13 rows of 13). */
export function gridLabels(): string[] {
  const out: string[] = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) out.push(gridLabel(r, c));
  return out;
}
