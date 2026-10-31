// Shuffle check for the hand page (/hands/[id]): verifies the viewer's per-card proof (see ./deck-proof.ts)
// against the commitment published at hand start, and that every card the viewer can see sat at the deck
// position the deal order puts it. Uses WebCrypto (browser and Node 18+), independently of the server.
import { expectedDealLayout, parseDeckProof, verifyDeckProof, type ProofCheck } from "./deck-proof";
import type { HandView } from "./types";

export { sha256Hex } from "./deck-proof";

export type CommitmentCheck = ProofCheck;

type VerifiableView = Pick<HandView, "deckCommitment" | "deckProof" | "boards" | "players" | "buttonSeat" | "variant" | "events">;

/** position -> card for every card the viewer sees in `view`, or null if the public data is inconsistent. */
export function expectedOpenings(view: Omit<VerifiableView, "deckCommitment" | "deckProof">, proofOpen: ReadonlyMap<number, string>): Map<number, string> | null {
  const layout = expectedDealLayout({ variant: view.variant, seats: view.players.map((p) => p.seat), buttonSeat: view.buttonSeat, events: view.events });
  if (!layout) return null;
  // The displayed boards must be exactly what the STREET events dealt.
  // (A hand that ended preflop has boards [[]] and no STREET events.)
  const boardCount = Math.max(layout.boards.length, view.boards.length);
  for (let i = 0; i < boardCount; i++) if ((layout.boards[i] ?? []).join() !== (view.boards[i] ?? []).join()) return null;
  const expected = new Map<number, string>();
  for (const card of view.boards.flat()) {
    const position = layout.boardPositions.get(card);
    if (position === undefined) return null;
    expected.set(position, card);
  }
  for (const player of view.players) {
    if (!player.holeCards) continue;
    const positions = layout.holeBySeat.get(player.seat);
    if (!positions || positions.length !== player.holeCards.length) return null;
    // Stored hole cards may not keep deal order: accept any order, but the sets must match exactly.
    const remaining = new Set(player.holeCards);
    const unmatched: number[] = [];
    for (const position of positions) {
      const card = proofOpen.get(position);
      if (card !== undefined && remaining.delete(card)) expected.set(position, card);
      else unmatched.push(position);
    }
    const left = [...remaining];
    unmatched.forEach((position, index) => expected.set(position, left[index]!));
  }
  return expected;
}

export async function verifyHandCommitment(view: VerifiableView): Promise<CommitmentCheck> {
  const proof = view.deckProof ? parseDeckProof(view.deckProof) : null;
  const opened = new Map(proof?.open.map((o) => [o.i, o.card]) ?? []);
  return verifyDeckProof(view.deckCommitment, view.deckProof ?? null, proof ? expectedOpenings(view, opened) : null);
}
