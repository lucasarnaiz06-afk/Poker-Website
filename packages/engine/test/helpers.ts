import { computePositions, createDeck, PokerHand, type StartHandConfig } from "../src";

export function players(stacks: number[], firstSeat = 1): StartHandConfig["players"] {
  return stacks.map((stack, i) => ({ id: `p${i + firstSeat}`, seat: i + firstSeat, stack }));
}

/**
 * Builds a deck prefix: hole cards (by player id) dealt one at a time starting left of the button,
 * then each entry of `streets` preceded by a burn card taken from unused cards.
 */
export function stackedDeck(
  config: Pick<StartHandConfig, "players" | "buttonSeat">,
  holes: Record<string, string[]>,
  streets: string[][] = [],
): string[] {
  const used = new Set<string>([...Object.values(holes).flat(), ...streets.flat()]);
  const filler = createDeck().filter((c) => !used.has(c));
  let fi = 0;
  const { dealOrder } = computePositions(
    config.players.map((p) => p.seat),
    config.buttonSeat,
  );
  const ordered = dealOrder.map((seat) => config.players.find((p) => p.seat === seat)!);
  const holeCount = Object.values(holes)[0]?.length ?? 2;
  const deck: string[] = [];
  for (let r = 0; r < holeCount; r++) {
    for (const p of ordered) {
      const card = holes[p.id]?.[r] ?? filler[fi++]!;
      deck.push(card);
    }
  }
  for (const street of streets) {
    deck.push(filler[fi++]!);
    deck.push(...street);
  }
  return deck;
}

/** Board streets helper: "AhKhQh 2c 3d" -> [["Ah","Kh","Qh"],["2c"],["3d"]]. */
export function streets(text: string): string[][] {
  return text
    .trim()
    .split(/\s+/)
    .map((group) => group.match(/.{2}/g)!);
}

export function startWith(
  config: StartHandConfig,
  holes: Record<string, string[]> = {},
  board: string[][] = [],
): PokerHand {
  return PokerHand.start(config, { deck: stackedDeck(config, holes, board) });
}

export function baseConfig(overrides: Partial<StartHandConfig> = {}): StartHandConfig {
  return {
    variant: "NLHE",
    players: players([1000, 1000, 1000]),
    buttonSeat: 1,
    smallBlind: 5,
    bigBlind: 10,
    ...overrides,
  };
}

export function sumStacks(hand: PokerHand): number {
  return hand.snapshot().players.reduce((s, p) => s + p.stack, 0);
}
