// Server-side (node:crypto) half of the per-viewer shuffle proofs; the format is documented in ./deck-proof.ts.
// Import via "@poker-platform/shared/hands/deck-proof-node" (never from browser code).
import { createHash, randomBytes } from "node:crypto";
import { buildDeckProofWith, isDeckRevealV2, leafInput, SALT_BYTES, type DeckProof, type DeckRevealV2 } from "./deck-proof";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Draws an independent 16-byte salt for every deck position. `randomHex(bytes)` must return 2*bytes hex chars. */
export function createDeckReveal(deck: readonly string[], randomHex: (bytes: number) => string = (n) => randomBytes(n).toString("hex")): DeckRevealV2 {
  const pool = randomHex(SALT_BYTES * deck.length).toLowerCase();
  if (pool.length !== 2 * SALT_BYTES * deck.length) throw new Error("randomHex returned the wrong length");
  const width = 2 * SALT_BYTES;
  return { v: 2, cards: deck.slice(), salts: deck.map((_, i) => pool.slice(i * width, (i + 1) * width)) };
}

export function deckLeaves(reveal: DeckRevealV2): string[] {
  return reveal.cards.map((card, i) => sha256Hex(leafInput(i, card, reveal.salts[i]!)));
}

/** sha256hex(leaf_0 + ... + leaf_{n-1}): published at hand start. */
export function deckRevealCommitment(reveal: DeckRevealV2): string {
  return sha256Hex(deckLeaves(reveal).join(""));
}

/**
 * The proof for a viewer who may see `visibleCards` (own hole cards, board, shown cards). Every other position
 * is sent as its leaf hash only. null for legacy reveals ({ deck, salt }) and anything malformed.
 */
export function buildDeckProof(stored: unknown, visibleCards: Iterable<string>): DeckProof | null {
  if (!isDeckRevealV2(stored)) return null;
  return buildDeckProofWith(stored, visibleCards, (i) => sha256Hex(leafInput(i, stored.cards[i]!, stored.salts[i]!)));
}
