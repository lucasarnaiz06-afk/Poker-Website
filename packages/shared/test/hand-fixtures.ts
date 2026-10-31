import { createHash } from "node:crypto";
import { createDeckReveal, deckRevealCommitment } from "../src/hands/deck-proof-node";
import { BOT_STYLES, playBotHand, seededRandom, type BotHandResult } from "../src/hands/bots";
import { persistCompletedHand, type PersistCompletedHandInput, type PersistSidePayment } from "../src/hands/persist";
import { prisma } from "./db";

export async function createTestLobby(createdByUserId: string, name = "Test table") {
  return prisma.lobby.create({
    data: { name, smallBlind: 5, bigBlind: 10, minBuyIn: 400, maxBuyIn: 2000, createdByUserId },
  });
}

/** Legacy (pre-proof) commitment: sha256(deck|salt). Only for testing that old hands are never revealed. */
export function legacyCommitmentFor(deck: string[], salt: string) {
  return createHash("sha256").update(`${deck.join("")}|${salt}`).digest("hex");
}

/** Plays one bot hand between `userIds` (seats 1..n) and returns the persist input. */
export function botHandInput(opts: {
  lobbyId: string;
  handNumber: number;
  userIds: string[];
  seed: number;
  endedAt?: Date;
  stacks?: number[];
  bombPot?: boolean;
  sidePayments?: PersistSidePayment[];
  /** [small blind, big blind]; default [5, 10]. */
  blinds?: [number, number];
}): { input: PersistCompletedHandInput; result: BotHandResult } {
  const rng = seededRandom(opts.seed);
  const players = opts.userIds.map((id, i) => ({ id, seat: i + 1, stack: opts.stacks?.[i] ?? 1000 }));
  const styles = new Map(opts.userIds.map((id, i) => [id, Object.values(BOT_STYLES)[i % 5]!]));
  const result = playBotHand(
    {
      variant: "NLHE",
      players,
      buttonSeat: (opts.handNumber % players.length) + 1,
      smallBlind: opts.blinds?.[0] ?? 5,
      bigBlind: opts.blinds?.[1] ?? 10,
      bombPot: opts.bombPot ? { ante: 2 * (opts.blinds?.[1] ?? 10), doubleBoard: false } : null,
      runItTwice: true,
    },
    styles,
    rng,
  );
  const reveal = createDeckReveal(result.deck);
  const endedAt = opts.endedAt ?? new Date(Date.UTC(2026, 9, 20, 12, 0, opts.handNumber));
  return {
    result,
    input: {
      lobbyId: opts.lobbyId,
      handNumber: opts.handNumber,
      startedAt: new Date(endedAt.getTime() - 30_000),
      endedAt,
      summary: result.summary,
      events: result.events,
      shownPlayerIds: result.voluntaryShows,
      sidePayments: opts.sidePayments,
      deckCommitment: deckRevealCommitment(reveal),
      deckReveal: reveal,
      allInEv: { iterations: 2000 },
    },
  };
}

export async function persistBotHands(opts: { lobbyId: string; userIds: string[]; count: number; seed?: number; start?: Date }) {
  const start = opts.start ?? new Date(Date.UTC(2026, 9, 20, 12, 0, 0));
  const ids: string[] = [];
  for (let i = 0; i < opts.count; i++) {
    const { input } = botHandInput({
      lobbyId: opts.lobbyId,
      handNumber: i + 1,
      userIds: opts.userIds,
      seed: (opts.seed ?? 1) * 10_000 + i,
      endedAt: new Date(start.getTime() + i * 60_000),
    });
    const res = await prisma.$transaction((tx) => persistCompletedHand(tx, input));
    ids.push(res.handId);
  }
  return ids;
}
