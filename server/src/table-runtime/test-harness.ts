// Shared helpers for runtime tests (not used in production code).
import { DEFAULT_TABLE_SETTINGS, type TableSettings, type TableView } from "@poker-platform/shared/types";
import { ManualClock } from "./clock";
import { MemoryStore, RecordingTransport, seededRng } from "./memory-ports";
import type { TableRecord } from "./ports";
import { TableRuntime } from "./runtime";
import type { TableTimings } from "./table-state";

export type HarnessOptions = {
  settings?: Partial<TableSettings>;
  record?: Partial<TableRecord>;
  seed?: number;
  timings?: Partial<TableTimings>;
  decks?: Array<string[] | null>;
  startBalance?: number;
};

export const TABLE_ID = "t1";

export function makeSettings(overrides: Partial<TableSettings> = {}): TableSettings {
  return {
    ...DEFAULT_TABLE_SETTINGS,
    bombPot: { ...DEFAULT_TABLE_SETTINGS.bombPot, enabled: false },
    ...overrides,
  };
}

export function createHarness(options: HarnessOptions = {}) {
  const store = new MemoryStore();
  const clock = new ManualClock();
  const transport = new RecordingTransport();
  const errors: unknown[] = [];
  const runtime = new TableRuntime({
    clock,
    rng: seededRng(options.seed ?? 1),
    wallet: store,
    hands: store,
    lobby: store,
    gate: store,
    transport,
    timings: options.timings,
    deckProvider: options.decks ? (_tableId, handNumber) => options.decks![handNumber - 1] ?? null : undefined,
    logger: (message, error) => errors.push({ message, error }),
  });
  store.addTable({ id: TABLE_ID, hostUserId: "u1", settings: makeSettings(options.settings), ...options.record });
  const settle = () => runtime.idle();

  const harness = {
    store,
    clock,
    transport,
    runtime,
    errors,
    settle,
    table: () => runtime.tables.get(TABLE_ID)!,
    advance: (ms: number) => clock.advance(ms, settle),
    view: (userId: string): TableView => runtime.viewFor(TABLE_ID, userId)!,
    conn: (userId: string) => `c-${userId}`,
    async join(userId: string, balance = options.startBalance ?? 100_000) {
      if (!store.balances.has(userId)) store.addUser(userId, balance);
      return runtime.join(`c-${userId}`, userId, TABLE_ID, {});
    },
    async seat(userIds: string[], buyIn = 1_000) {
      for (const [index, userId] of userIds.entries()) {
        await harness.join(userId);
        await runtime.sit(userId, TABLE_ID, index + 1, buyIn);
      }
    },
    /** Advances until a hand is live (next-hand delay). */
    async untilHand() {
      for (let i = 0; i < 20 && !harness.table().isLive(); i += 1) await harness.advance(1_000);
      return harness.table().hand!;
    },
    toAct(): string | null {
      const hand = harness.table().hand;
      if (!hand || hand.completedAt !== null || hand.engine.status !== "BETTING") return null;
      return hand.engine.toActPlayerId;
    },
    async act(userId: string, type: "fold" | "check" | "call" | "bet" | "raise" | "allin", amount?: number) {
      const hand = harness.table().hand!;
      await runtime.action(userId, TABLE_ID, hand.id, type, amount);
    },
    /** Checks or calls until the hand ends (answering RIT votes with `rit`). */
    async passiveToEnd(rit = false) {
      for (let guard = 0; guard < 200; guard += 1) {
        const table = harness.table();
        const hand = table.hand;
        if (!hand || hand.completedAt !== null) {
          await harness.settle();
          return;
        }
        if (hand.engine.status === "RUNOUT_DECISION") {
          const vote = table.votes.find((v) => v.kind === "RUN_IT_TWICE" && v.status === "OPEN")!;
          for (const id of vote.eligibleUserIds) {
            if (vote.status === "OPEN") await runtime.vote(id, TABLE_ID, vote.id, rit);
          }
          continue;
        }
        const actor = harness.toAct()!;
        const legal = hand.engine.legalActions(actor)!;
        await harness.act(actor, legal.canCheck ? "check" : "call");
      }
      throw new Error("hand did not finish");
    },
  };
  return harness;
}

export type Harness = ReturnType<typeof createHarness>;

/** Builds a deck: the given hole cards dealt in deal order (one card per player per round), then the board. */
export function deckFor(holeBySeatOrder: string[][], board: string[]): string[] {
  const rounds = holeBySeatOrder[0]!.length;
  const deck: string[] = [];
  for (let r = 0; r < rounds; r += 1) for (const hole of holeBySeatOrder) deck.push(hole[r]!);
  // burn + flop, burn + turn, burn + river (burns use filler from the rest of the deck)
  const used = new Set([...deck, ...board]);
  const filler = allCards().filter((c) => !used.has(c));
  deck.push(filler.shift()!, board[0]!, board[1]!, board[2]!, filler.shift()!, board[3]!, filler.shift()!, board[4]!);
  return [...deck, ...filler];
}

function allCards() {
  const cards: string[] = [];
  for (const r of "23456789TJQKA") for (const s of "cdhs") cards.push(`${r}${s}`);
  return cards;
}
