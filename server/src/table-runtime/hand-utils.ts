import { computePositions, toPublicCard, type Card } from "@poker-platform/engine";
import type { PublicCard } from "@poker-platform/shared/types";

export function publicCards(cards: readonly string[]): PublicCard[] {
  return cards.map((card) => toPublicCard(card as Card));
}

const MIDDLE_NAMES: Record<number, string[]> = {
  0: [],
  1: ["UTG"],
  2: ["UTG", "CO"],
  3: ["UTG", "HJ", "CO"],
  4: ["UTG", "MP", "HJ", "CO"],
  5: ["UTG", "UTG+1", "MP", "HJ", "CO"],
  6: ["UTG", "UTG+1", "MP", "LJ", "HJ", "CO"],
  7: ["UTG", "UTG+1", "UTG+2", "MP", "LJ", "HJ", "CO"],
};

/** Position names ("BTN", "SB", "BB", "UTG", ... "CO") by seat for the dealt-in seats. */
export function positionNames(seats: readonly number[], buttonSeat: number): Map<number, string> {
  const names = new Map<number, string>();
  if (seats.length < 2) {
    for (const seat of seats) names.set(seat, "BTN");
    return names;
  }
  const positions = computePositions(seats, buttonSeat);
  if (seats.length === 2) {
    for (const seat of seats) names.set(seat, seat === positions.bigBlindSeat ? "BB" : "BTN");
    return names;
  }
  // dealOrder starts left of the button: SB, BB, middle..., (button last when dealt in)
  const order = positions.dealOrder;
  const buttonDealt = seats.includes(buttonSeat);
  const middle = order.filter(
    (seat) => seat !== positions.smallBlindSeat && seat !== positions.bigBlindSeat && seat !== buttonSeat,
  );
  const middleNames = MIDDLE_NAMES[middle.length] ?? middle.map((_, index) => `MP${index + 1}`);
  names.set(positions.smallBlindSeat, "SB");
  names.set(positions.bigBlindSeat, "BB");
  if (buttonDealt) names.set(buttonSeat, "BTN");
  middle.forEach((seat, index) => names.set(seat, middleNames[index] ?? `MP${index + 1}`));
  return names;
}

/** True for a 7-2 holding (any suits) in a two-card game. */
export function isSevenDeuce(cards: readonly string[]) {
  if (cards.length !== 2) return false;
  const ranks = cards.map((card) => card[0]).sort().join("");
  return ranks === "27";
}

export function cardText(cards: readonly string[]) {
  return cards.join(" ");
}
