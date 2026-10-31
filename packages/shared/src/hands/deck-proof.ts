// Per-viewer shuffle proofs (browser-safe: WebCrypto only, no Node imports).
//
// Scheme (v2). At hand start the server shuffles the deck and draws an independent 16-byte random salt per
// deck position, then publishes
//
//   leaf_i     = sha256hex(`${i}|${card_i}|${salt_i}`)          i = 0-based deck position (0 = top), salt hex
//   commitment = sha256hex(leaf_0 + leaf_1 + ... + leaf_{n-1})   plain concatenation of the 64-char hex leaves
//
// The full reveal (cards + salts, `DeckRevealV2`) is stored server-side only (Hand.deckReveal). After the hand
// each viewer gets a `DeckProof`: (i, card, salt_i) for the positions holding cards they were entitled to see,
// and only leaf_i for every other position. The viewer recomputes the opened leaves and the commitment; the
// salts make the hidden leaves unguessable, so a proof reveals nothing about cards outside the viewer's set.
// Burn cards are never opened.
//
// Entitled set: the viewer's own hole cards (players), every dealt board card, and hole cards shown at
// showdown or voluntarily. Spectators: board + shown cards.
//
// Deal order (engine, packages/engine/src/hand.ts), which fixes where visible cards must sit:
//   1. Hole cards round-robin from the top: round r (0..H-1), then each dealt-in seat in deal order (starting left
//      of the button, see computePositions().dealOrder). Seat k in deal order, round r -> position r*N + k
//      (N = dealt-in players, H = 2 for NLHE, 4 for PLO).
//   2. Then, for every STREET event in event order (flop/turn/river; per board on double boards; board 0 then
//      board 1 when run twice): one burn card, then the street's cards (3 on the flop, else 1).
// Legacy hands (single sha256(deck|salt) commitment) are never sent to clients: they are "not verifiable".
import { computePositions, holeCardCount, type Variant } from "@poker-platform/engine";

export const DECK_PROOF_VERSION = 2 as const;
export const SALT_BYTES = 16;
const SALT_RE = /^[0-9a-f]{32}$/;
const LEAF_RE = /^[0-9a-f]{64}$/;
const CARD_RE = /^[2-9TJQKA][cdhs]$/;

/** Hand.deckReveal (server-only, never sent to a browser). */
export type DeckRevealV2 = { v: 2; cards: string[]; salts: string[] };
/** Old hands: { deck, salt } with sha256(deck.join("") + "|" + salt). Never sent to clients. */
export type LegacyDeckReveal = { deck: string[]; salt: string };
export type StoredDeckReveal = DeckRevealV2 | LegacyDeckReveal;

export type DeckProofOpening = { i: number; card: string; salt: string };
export type DeckProofLeaf = { i: number; leaf: string };
/**
 * What one viewer receives after a hand. `open` and `leaves` are sorted by `i` and together cover every
 * position 0..size-1 exactly once.
 */
export type DeckProof = { v: 2; size: number; open: DeckProofOpening[]; leaves: DeckProofLeaf[] };

export function leafInput(i: number, card: string, salt: string): string {
  return `${i}|${card}|${salt}`;
}

export function isDeckRevealV2(value: unknown): value is DeckRevealV2 {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<DeckRevealV2>;
  return (
    r.v === 2 &&
    Array.isArray(r.cards) &&
    Array.isArray(r.salts) &&
    r.cards.length === r.salts.length &&
    r.cards.length > 0 &&
    r.cards.every((c) => typeof c === "string" && CARD_RE.test(c)) &&
    r.salts.every((s) => typeof s === "string" && SALT_RE.test(s))
  );
}

/**
 * Builds the proof for one viewer from the server-only reveal. `leafOf(i)` must return leaf_i (precomputed or
 * hashed by the caller). Only positions whose card is in `visibleCards` are opened; legacy/invalid reveals
 * give null.
 */
export function buildDeckProofWith(stored: unknown, visibleCards: Iterable<string>, leafOf: (i: number) => string): DeckProof | null {
  if (!isDeckRevealV2(stored)) return null;
  const want = new Set(visibleCards);
  const open: DeckProofOpening[] = [];
  const leaves: DeckProofLeaf[] = [];
  stored.cards.forEach((card, i) => {
    if (want.has(card)) open.push({ i, card, salt: stored.salts[i]! });
    else leaves.push({ i, leaf: leafOf(i) });
  });
  return { v: DECK_PROOF_VERSION, size: stored.cards.length, open, leaves };
}

/** Strictly validates a proof (object or its JSON string, e.g. TableView.hand.revealedDeck). null if malformed. */
export function parseDeckProof(value: unknown): DeckProof | null {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const size = p.size;
  if (p.v !== DECK_PROOF_VERSION || typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > 52) return null;
  if (!Array.isArray(p.open) || !Array.isArray(p.leaves)) return null;
  const seen = new Set<number>();
  const cards = new Set<string>();
  const validIndex = (i: unknown): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < size && !seen.has(i);
  const open: DeckProofOpening[] = [];
  for (const o of p.open as unknown[]) {
    const e = (o ?? {}) as Record<string, unknown>;
    if (!validIndex(e.i) || typeof e.card !== "string" || !CARD_RE.test(e.card) || cards.has(e.card)) return null;
    if (typeof e.salt !== "string" || !SALT_RE.test(e.salt)) return null;
    seen.add(e.i);
    cards.add(e.card);
    open.push({ i: e.i, card: e.card, salt: e.salt });
  }
  const leaves: DeckProofLeaf[] = [];
  for (const l of p.leaves as unknown[]) {
    const e = (l ?? {}) as Record<string, unknown>;
    if (!validIndex(e.i) || typeof e.leaf !== "string" || !LEAF_RE.test(e.leaf)) return null;
    seen.add(e.i);
    leaves.push({ i: e.i, leaf: e.leaf });
  }
  if (seen.size !== size) return null;
  open.sort((a, b) => a.i - b.i);
  leaves.sort((a, b) => a.i - b.i);
  return { v: DECK_PROOF_VERSION, size, open, leaves };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Recomputes the commitment from a (parsed) proof with WebCrypto. */
export async function proofCommitment(proof: DeckProof): Promise<string> {
  const leaves = new Array<string>(proof.size);
  for (const l of proof.leaves) leaves[l.i] = l.leaf;
  await Promise.all(proof.open.map(async (o) => (leaves[o.i] = await sha256Hex(leafInput(o.i, o.card, o.salt)))));
  return sha256Hex(leaves.join(""));
}

export type DealLayout = {
  /** Deck positions of each seat's hole cards, in deal rounds. */
  holeBySeat: Map<number, number[]>;
  /** Expected deck position of every dealt board card. */
  boardPositions: Map<string, number>;
  /** Boards rebuilt from STREET events (to cross-check the displayed boards). */
  boards: string[][];
  burns: number[];
};

type StreetLike = { type: "STREET"; boardIndex: number; cards: string[]; board: string[] };

function isStreetEvent(e: unknown): e is StreetLike {
  if (!e || typeof e !== "object") return false;
  const s = e as Partial<StreetLike>;
  return (s as { type?: unknown }).type === "STREET" && typeof s.boardIndex === "number" && Array.isArray(s.cards) && Array.isArray(s.board);
}

/** Where every visible card must sit in the deck, from public hand data only (see the deal order above). */
export function expectedDealLayout(input: { variant: Variant; seats: readonly number[]; buttonSeat: number; events: readonly unknown[] }): DealLayout | null {
  let dealOrder: number[];
  try {
    dealOrder = computePositions(input.seats, input.buttonSeat).dealOrder;
  } catch {
    return null;
  }
  const n = dealOrder.length;
  const h = holeCardCount(input.variant);
  const holeBySeat = new Map<number, number[]>();
  dealOrder.forEach((seat, k) => holeBySeat.set(seat, Array.from({ length: h }, (_, r) => r * n + k)));
  let cursor = n * h;
  const boardPositions = new Map<string, number>();
  const boards: string[][] = [];
  const burns: number[] = [];
  for (const event of input.events) {
    if (!isStreetEvent(event)) continue;
    burns.push(cursor++);
    for (const card of event.cards) boardPositions.set(card, cursor++);
    boards[event.boardIndex] = event.board.slice();
  }
  return { holeBySeat, boardPositions, boards, burns };
}

export type ProofCheck = {
  ok: boolean;
  /** false for legacy hands / missing proofs: nothing to check. */
  verifiable: boolean;
  expected: string;
  computed: string | null;
  hashOk: boolean;
  /** Every card the viewer can see is opened at its deal position, and nothing else is opened. */
  positionsOk: boolean;
  deckSize: number;
  openedCount: number;
  reason: string;
};

/**
 * Verifies a proof against the commitment and an expected position -> card map (the viewer's visible cards).
 * Fails if the hash does not match, a visible card is not opened at its expected position, or the proof opens
 * a position that is not expected.
 */
export async function verifyDeckProof(commitment: string, proofInput: unknown, expectedOpen: ReadonlyMap<number, string> | null): Promise<ProofCheck> {
  const expected = commitment.toLowerCase();
  const base = { expected, computed: null, hashOk: false, positionsOk: false, deckSize: 0, openedCount: 0 };
  if (proofInput === null || proofInput === undefined) {
    return { ...base, ok: false, verifiable: false, reason: "This hand has no shuffle proof (hands from before per-card proofs can't be verified)." };
  }
  const proof = parseDeckProof(proofInput);
  if (!proof) return { ...base, ok: false, verifiable: true, reason: "The shuffle proof is malformed." };
  const computed = await proofCommitment(proof);
  const hashOk = computed === expected;
  let positionsOk = expectedOpen !== null && proof.open.length === expectedOpen.size;
  if (positionsOk) for (const o of proof.open) if (expectedOpen!.get(o.i) !== o.card) positionsOk = false;
  const reason = !hashOk
    ? "The revealed cards do not match the commitment published before the hand."
    : !positionsOk
      ? "The hash matches, but the revealed cards are not where the deal order puts the cards you saw."
      : `Your ${proof.open.length} visible cards were at their dealt positions in the deck committed to before the first card was dealt. The other ${proof.size - proof.open.length} positions stay hidden.`;
  return { ok: hashOk && positionsOk, verifiable: true, expected, computed, hashOk, positionsOk, deckSize: proof.size, openedCount: proof.open.length, reason };
}
