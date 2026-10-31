// Hold'em range parsing: "AKs, TT+, A5s-A2s, KQo, QJ, 98s+, AhKh".
import { RANKS, SUITS, type Card } from "./cards";
import { EngineError } from "./errors";

export type Combo = [Card, Card];

const RANK_CHARS = RANKS.join("");

function rankIdx(ch: string, token: string): number {
  const i = RANK_CHARS.indexOf(ch.toUpperCase());
  if (i < 0) throw new EngineError("INVALID_RANGE", `Invalid rank in "${token}"`);
  return i;
}

function pairCombos(r: number): Combo[] {
  const out: Combo[] = [];
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      out.push([`${RANKS[r]!}${SUITS[b]!}` as Card, `${RANKS[r]!}${SUITS[a]!}` as Card]);
    }
  }
  return out;
}

function nonPairCombos(hi: number, lo: number, kind: "s" | "o" | ""): Combo[] {
  const out: Combo[] = [];
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      const suited = a === b;
      if ((kind === "s" && !suited) || (kind === "o" && suited)) continue;
      out.push([`${RANKS[hi]!}${SUITS[a]!}` as Card, `${RANKS[lo]!}${SUITS[b]!}` as Card]);
    }
  }
  return out;
}

type HandClass = { hi: number; lo: number; kind: "s" | "o" | "" };

function parseClass(text: string, token: string): HandClass {
  const m = /^([2-9TJQKA])([2-9TJQKA])([so]?)$/i.exec(text);
  if (!m) throw new EngineError("INVALID_RANGE", `Invalid hand "${token}"`);
  let hi = rankIdx(m[1]!, token);
  let lo = rankIdx(m[2]!, token);
  if (lo > hi) [hi, lo] = [lo, hi];
  const kind = (m[3] ?? "").toLowerCase() as "s" | "o" | "";
  if (hi === lo && kind !== "") throw new EngineError("INVALID_RANGE", `Pairs cannot be suited/offsuit: "${token}"`);
  return { hi, lo, kind };
}

function classCombos(c: HandClass): Combo[] {
  return c.hi === c.lo ? pairCombos(c.hi) : nonPairCombos(c.hi, c.lo, c.kind);
}

function parseToken(token: string): Combo[] {
  // Specific combo, e.g. "AhKh".
  const specific = /^([2-9TJQKA])([cdhs])([2-9TJQKA])([cdhs])$/i.exec(token);
  if (specific) {
    const a = `${specific[1]!.toUpperCase()}${specific[2]!.toLowerCase()}` as Card;
    const b = `${specific[3]!.toUpperCase()}${specific[4]!.toLowerCase()}` as Card;
    if (a === b) throw new EngineError("INVALID_RANGE", `Duplicate card in "${token}"`);
    return [[a, b]];
  }
  if (token.endsWith("+")) {
    const c = parseClass(token.slice(0, -1), token);
    const out: Combo[] = [];
    if (c.hi === c.lo) for (let r = c.hi; r <= 12; r++) out.push(...pairCombos(r));
    else for (let lo = c.lo; lo < c.hi; lo++) out.push(...nonPairCombos(c.hi, lo, c.kind));
    return out;
  }
  if (token.includes("-")) {
    const [left, right, ...rest] = token.split("-");
    if (left === undefined || right === undefined || rest.length > 0) throw new EngineError("INVALID_RANGE", `Invalid range "${token}"`);
    const a = parseClass(left, token);
    const b = parseClass(right, token);
    const out: Combo[] = [];
    if (a.hi === a.lo && b.hi === b.lo) {
      for (let r = Math.min(a.hi, b.hi); r <= Math.max(a.hi, b.hi); r++) out.push(...pairCombos(r));
      return out;
    }
    if (a.hi !== b.hi || a.kind !== b.kind || a.hi === a.lo || b.hi === b.lo) {
      throw new EngineError("INVALID_RANGE", `Range ends must share the top card and suitedness: "${token}"`);
    }
    for (let lo = Math.min(a.lo, b.lo); lo <= Math.max(a.lo, b.lo); lo++) out.push(...nonPairCombos(a.hi, lo, a.kind));
    return out;
  }
  return classCombos(parseClass(token, token));
}

/** Parses a comma/space separated Hold'em range into distinct two-card combos. */
export function parseRange(text: string): Combo[] {
  const tokens = text
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const seen = new Set<string>();
  const out: Combo[] = [];
  for (const token of tokens) {
    for (const combo of parseToken(token)) {
      const key = [combo[0], combo[1]].sort().join("");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(combo);
    }
  }
  return out;
}

/** Number of combos in a range string (e.g. "AKs" = 4, "AKo" = 12, "TT" = 6). */
export function rangeComboCount(text: string): number {
  return parseRange(text).length;
}
