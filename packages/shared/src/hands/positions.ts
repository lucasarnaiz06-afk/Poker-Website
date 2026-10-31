// Position names for dealt-in seats. Same naming as server/src/table-runtime/hand-utils.ts positionNames.
import { computePositions } from "@poker-platform/engine";

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

/** Display order of positions (early to late, then blinds) for tables and filters. */
export const POSITION_ORDER = ["UTG", "UTG+1", "UTG+2", "MP", "LJ", "HJ", "CO", "BTN", "SB", "BB"] as const;

/** Groups used in stats tables so 6-max and 9-max results line up. */
export function positionGroup(position: string): "EP" | "MP" | "CO" | "BTN" | "SB" | "BB" {
  switch (position) {
    case "BTN":
    case "SB":
    case "BB":
    case "CO":
      return position;
    case "UTG":
    case "UTG+1":
    case "UTG+2":
      return "EP";
    default:
      return "MP";
  }
}

export const POSITION_GROUPS = ["EP", "MP", "CO", "BTN", "SB", "BB"] as const;
export type PositionGroup = (typeof POSITION_GROUPS)[number];

export const POSITION_GROUP_LABEL: Record<PositionGroup, string> = {
  EP: "Early (UTG)",
  MP: "Middle (MP/HJ)",
  CO: "Cutoff",
  BTN: "Button",
  SB: "Small blind",
  BB: "Big blind",
};
