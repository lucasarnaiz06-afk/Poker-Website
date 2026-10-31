// Omaha evaluation: the best hand using exactly two hole cards and exactly three board cards.
import { cardToIndex, indexToCard, type Card } from "./cards";
import { EngineError } from "./errors";
import { bestFiveIndices, describeValue, evaluate5, type HandResult } from "./evaluator";

/**
 * Best Omaha value for hole/board card indices (hole 4..6 cards, board 3..5 cards).
 * When `best` is passed it receives the five winning indices (2 hole + 3 board).
 */
export function evaluateOmahaIndices(hole: ArrayLike<number>, board: ArrayLike<number>, best?: number[]): number {
  const h = hole.length;
  const n = board.length;
  let bestValue = -1;
  for (let i = 0; i < h - 1; i++) {
    const hi = hole[i]!;
    for (let j = i + 1; j < h; j++) {
      const hj = hole[j]!;
      for (let a = 0; a < n - 2; a++) {
        const ba = board[a]!;
        for (let b = a + 1; b < n - 1; b++) {
          const bb = board[b]!;
          for (let c = b + 1; c < n; c++) {
            const v = evaluate5(hi, hj, ba, bb, board[c]!);
            if (v > bestValue) {
              bestValue = v;
              if (best) {
                best.length = 0;
                best.push(hi, hj, ba, bb, board[c]!);
              }
            }
          }
        }
      }
    }
  }
  return bestValue;
}

/** Best Omaha hand (exactly 2 of the hole cards + exactly 3 of the board cards). */
export function evaluateOmaha(hole: readonly Card[], board: readonly Card[]): HandResult {
  if (hole.length < 4 || hole.length > 6) {
    throw new EngineError("INVALID_HAND_SIZE", `Omaha needs 4-6 hole cards, got ${hole.length}`);
  }
  if (board.length < 3 || board.length > 5) {
    throw new EngineError("INVALID_HAND_SIZE", `Omaha needs 3-5 board cards, got ${board.length}`);
  }
  const h = hole.map(cardToIndex);
  const b = board.map(cardToIndex);
  if (new Set([...h, ...b]).size !== h.length + b.length) throw new EngineError("DUPLICATE_CARD", "Duplicate card");
  const best: number[] = [];
  const value = evaluateOmahaIndices(h, b, best);
  // Display order: the five cards in the order the hand reads.
  return describeValue(value, bestFiveIndices(best, value).map(indexToCard));
}
