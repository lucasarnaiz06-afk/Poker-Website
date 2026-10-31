// Hand summary -> database rows. The table runtime calls persistCompletedHand(tx, input) inside the same
// transaction that persists the hand-boundary stacks; the dev seed script uses it too.
//
// Rows written:
//   Hand              one per hand (events = engine events + platform SIDE_PAYMENT / SHOW events)
//   HandPlayer        one per dealt-in player (net/endingStack include side payments settled with the hand)
//   PlayerDailyStat   upserted per player for the UTC day of endedAt (also for side-payment-only users)
//   PlayerOpponentDaily  money flow between every pair of dealt-in players, upserted for the same day
// Never touches wallets or LobbyPlayer stacks.
import type { HandEvent, HandSummary } from "@poker-platform/engine";
import { Prisma } from "@prisma/client";
import { handPlayerStatColumns, netCentiBB, opponentFlows, type HandPlayerStatColumns, type OpponentFlow } from "../stats/hand-player-stats";
import { allInEvNets, type AllInEvOptions } from "./all-in-ev";
import { positionNames } from "./positions";
import type { DeckReveal, ShowEvent, SidePaymentEvent, SidePaymentReason, StoredHandEvent } from "./types";

export type PersistSidePayment = {
  reason: SidePaymentReason;
  fromUserId: string;
  toUserId: string;
  /** Positive integer chips. */
  amount: number;
};

/**
 * Input of persistCompletedHand. Engine player ids MUST be user ids.
 *
 * - `summary` / `events`: `hand.summary` and `hand.events` from @poker-platform/engine, unmodified (all events,
 *   including the private HOLE_CARDS and every SHOWDOWN hand: redaction happens on read).
 * - `sidePayments`: side-game transfers settled together with this hand (nit penalty, 7-2 bounty). Applied to
 *   HandPlayer.endingStack / net and appended as SIDE_PAYMENT events. A payer/receiver who was not dealt in only
 *   gets a PlayerDailyStat.net change.
 * - `shownPlayerIds`: players who showed although not forced to (the engine's `mustShow` players are always
 *   shown). Everyone else at showdown mucked: their cards are never sent to other users.
 * - `deckReveal`: server-only full reveal (v2: cards + per-position salts, see ./deck-proof.ts); clients only
 *   ever get per-viewer proofs built from it.
 * - `allInEv`: false skips the all-in EV equity calculation (default: on, ~20k Monte Carlo runouts preflop).
 */
export type PersistCompletedHandInput = {
  /** Hand.id; defaults to summary.handId, else a generated cuid. */
  handId?: string | null;
  lobbyId: string;
  handNumber: number;
  startedAt: Date;
  endedAt: Date;
  summary: HandSummary;
  events: readonly HandEvent[];
  sidePayments?: readonly PersistSidePayment[];
  shownPlayerIds?: readonly string[];
  deckCommitment: string;
  deckReveal: DeckReveal | null;
  /** Position names by user id; defaults to positionNames(seats, buttonSeat). */
  positions?: Readonly<Record<string, string>>;
  allInEv?: boolean | AllInEvOptions;
};

export type PersistCompletedHandResult = { handId: string; created: boolean };

export type HandPlayerRow = HandPlayerStatColumns & {
  userId: string;
  seat: number;
  position: string;
  startingStack: number;
  endingStack: number;
  net: number;
  won: number;
  holeCards: string[];
  shown: boolean;
  sawFlop: boolean;
  wentToShowdown: boolean;
  wonAtShowdown: boolean;
  vpip: boolean;
  pfr: boolean;
  threeBet: boolean;
  allInEvNet: number | null;
};

export type DailyStatDelta = {
  userId: string;
  day: string;
  hands: number;
  net: number;
  vpipHands: number;
  pfrHands: number;
  showdowns: number;
  showdownsWon: number;
  biggestPotWon: number;
  netCentiBB: number;
  bombPotHands: number;
};

export type OpponentDailyDelta = OpponentFlow & { day: string; hands: number };

export type PersistRows = {
  hand: {
    id: string | undefined;
    lobbyId: string;
    handNumber: number;
    variant: string;
    smallBlind: number;
    bigBlind: number;
    ante: number;
    buttonSeat: number;
    isBombPot: boolean;
    runItTwice: boolean;
    boards: string[][];
    pots: HandSummary["pots"];
    events: StoredHandEvent[];
    deckCommitment: string;
    deckReveal: DeckReveal | null;
    totalPot: number;
    startedAt: Date;
    endedAt: Date;
  };
  players: HandPlayerRow[];
  daily: DailyStatDelta[];
  opponents: OpponentDailyDelta[];
};

export class PersistHandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistHandError";
  }
}

/** UTC calendar day "YYYY-MM-DD". */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isPositiveInt(value: number) {
  return Number.isInteger(value) && value > 0;
}

/** Pure mapping (no DB): validates the input and returns the rows persistCompletedHand writes. */
export function buildPersistRows(input: PersistCompletedHandInput): PersistRows {
  const { summary } = input;
  if (!summary || summary.players.length < 2) throw new PersistHandError("A completed hand needs at least two players.");
  if (!Number.isInteger(input.handNumber) || input.handNumber < 0) throw new PersistHandError("Invalid hand number.");
  const byId = new Map(summary.players.map((p) => [p.id, p]));
  const positions =
    input.positions ??
    Object.fromEntries(
      (() => {
        const names = positionNames(
          summary.players.map((p) => p.seat),
          summary.buttonSeat,
        );
        return summary.players.map((p) => [p.id, names.get(p.seat) ?? "?"]);
      })(),
    );

  // Side payments: validate and apply to stacks.
  const delta = new Map<string, number>();
  for (const payment of input.sidePayments ?? []) {
    if (!isPositiveInt(payment.amount)) throw new PersistHandError("Side payment amounts must be positive integers.");
    if (payment.fromUserId === payment.toUserId) throw new PersistHandError("A side payment needs two different users.");
    delta.set(payment.fromUserId, (delta.get(payment.fromUserId) ?? 0) - payment.amount);
    delta.set(payment.toUserId, (delta.get(payment.toUserId) ?? 0) + payment.amount);
  }

  const shownSet = new Set(input.shownPlayerIds ?? []);
  for (const id of shownSet) if (!byId.has(id)) throw new PersistHandError(`Unknown shown player ${id}.`);

  const netById = new Map<string, number>();
  for (const p of summary.players) {
    const endingStack = p.endingStack + (delta.get(p.id) ?? 0);
    if (endingStack < 0) throw new PersistHandError("Side payments exceed a player's stack.");
    netById.set(p.id, endingStack - p.startingStack);
  }

  const evOptions = input.allInEv === false ? null : input.allInEv === true || input.allInEv === undefined ? {} : input.allInEv;
  const evNets = evOptions ? allInEvNets(summary, netById, evOptions) : null;
  const statColumns = handPlayerStatColumns(
    input.events,
    { isBombPot: summary.isBombPot, variant: summary.variant },
    summary.players.map((p) => ({ userId: p.id, holeCards: p.holeCards })),
  );

  const players: HandPlayerRow[] = summary.players.map((p) => {
    const net = netById.get(p.id)!;
    return {
      ...statColumns.get(p.id)!,
      userId: p.id,
      seat: p.seat,
      position: positions[p.id] ?? "?",
      startingStack: p.startingStack,
      endingStack: p.startingStack + net,
      net,
      won: p.won,
      holeCards: p.holeCards.slice(),
      shown: p.mustShow || shownSet.has(p.id),
      sawFlop: p.stats.sawFlop,
      wentToShowdown: p.wentToShowdown,
      wonAtShowdown: p.wonAtShowdown,
      vpip: p.stats.vpip,
      pfr: p.stats.pfr,
      threeBet: p.stats.threeBet,
      allInEvNet: evNets ? (evNets.get(p.id) ?? null) : null,
    };
  });

  // Events: engine log + platform events.
  const events: StoredHandEvent[] = input.events.map((e) => e);
  let seq = events.reduce((max, e) => Math.max(max, e.seq), 0);
  for (const id of shownSet) {
    const p = byId.get(id)!;
    if (p.mustShow) continue;
    const show: ShowEvent = { type: "SHOW", seq: ++seq, playerId: p.id, seat: p.seat, cards: p.holeCards.slice() };
    events.push(show);
  }
  for (const payment of input.sidePayments ?? []) {
    const event: SidePaymentEvent = {
      type: "SIDE_PAYMENT",
      seq: ++seq,
      reason: payment.reason,
      fromUserId: payment.fromUserId,
      fromSeat: byId.get(payment.fromUserId)?.seat ?? null,
      toUserId: payment.toUserId,
      toSeat: byId.get(payment.toUserId)?.seat ?? null,
      amount: payment.amount,
    };
    events.push(event);
  }

  const day = utcDay(input.endedAt);
  const daily: DailyStatDelta[] = players.map((p) => ({
    userId: p.userId,
    day,
    hands: 1,
    net: p.net,
    vpipHands: p.vpip ? 1 : 0,
    pfrHands: p.pfr ? 1 : 0,
    showdowns: p.wentToShowdown ? 1 : 0,
    showdownsWon: p.wonAtShowdown ? 1 : 0,
    biggestPotWon: p.won,
    netCentiBB: netCentiBB(p.net, summary.bigBlind),
    bombPotHands: summary.isBombPot ? 1 : 0,
  }));
  for (const [userId, amount] of delta) {
    if (byId.has(userId) || amount === 0) continue;
    daily.push(netOnlyDelta(userId, day, amount));
  }
  const opponents = opponentFlows(players, summary.bigBlind).map((f) => ({ ...f, day, hands: 1 }));

  return {
    hand: {
      id: input.handId ?? summary.handId ?? undefined,
      lobbyId: input.lobbyId,
      handNumber: input.handNumber,
      variant: summary.variant,
      smallBlind: summary.smallBlind,
      bigBlind: summary.bigBlind,
      ante: summary.ante,
      buttonSeat: summary.buttonSeat,
      isBombPot: summary.isBombPot,
      runItTwice: summary.runs === 2,
      boards: summary.boards.map((b) => b.slice()),
      pots: summary.pots,
      events,
      deckCommitment: input.deckCommitment,
      deckReveal: input.deckReveal,
      totalPot: summary.totalPot,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    },
    players,
    daily,
    opponents,
  };
}

/** Daily delta for a side payment: chips only (bb/100 only counts hands the player was dealt into). */
function netOnlyDelta(userId: string, day: string, net: number, centiBB = 0): DailyStatDelta {
  return { userId, day, hands: 0, net, vpipHands: 0, pfrHands: 0, showdowns: 0, showdownsWon: 0, biggestPotWon: 0, netCentiBB: centiBB, bombPotHands: 0 };
}

async function upsertDailyStats(tx: Prisma.TransactionClient, rows: readonly DailyStatDelta[]) {
  if (rows.length === 0) return;
  const col = <K extends keyof DailyStatDelta>(key: K) => rows.map((r) => r[key]);
  await tx.$executeRaw`
    INSERT INTO "PlayerDailyStat" ("userId", "day", "hands", "net", "vpipHands", "pfrHands", "showdowns", "showdownsWon", "biggestPotWon", "netCentiBB", "bombPotHands")
    SELECT * FROM unnest(${col("userId")}::text[], ${col("day")}::text[], ${col("hands")}::int[], ${col("net")}::int[],
      ${col("vpipHands")}::int[], ${col("pfrHands")}::int[], ${col("showdowns")}::int[], ${col("showdownsWon")}::int[],
      ${col("biggestPotWon")}::int[], ${col("netCentiBB")}::int[], ${col("bombPotHands")}::int[])
    ON CONFLICT ("userId", "day") DO UPDATE SET
      "hands" = "PlayerDailyStat"."hands" + EXCLUDED."hands",
      "net" = "PlayerDailyStat"."net" + EXCLUDED."net",
      "vpipHands" = "PlayerDailyStat"."vpipHands" + EXCLUDED."vpipHands",
      "pfrHands" = "PlayerDailyStat"."pfrHands" + EXCLUDED."pfrHands",
      "showdowns" = "PlayerDailyStat"."showdowns" + EXCLUDED."showdowns",
      "showdownsWon" = "PlayerDailyStat"."showdownsWon" + EXCLUDED."showdownsWon",
      "biggestPotWon" = GREATEST("PlayerDailyStat"."biggestPotWon", EXCLUDED."biggestPotWon"),
      "netCentiBB" = "PlayerDailyStat"."netCentiBB" + EXCLUDED."netCentiBB",
      "bombPotHands" = "PlayerDailyStat"."bombPotHands" + EXCLUDED."bombPotHands"`;
}

async function upsertOpponentDaily(tx: Prisma.TransactionClient, rows: readonly OpponentDailyDelta[]) {
  if (rows.length === 0) return;
  const col = <K extends keyof OpponentDailyDelta>(key: K) => rows.map((r) => r[key]);
  await tx.$executeRaw`
    INSERT INTO "PlayerOpponentDaily" ("userId", "opponentId", "day", "hands", "flow", "flowBB")
    SELECT * FROM unnest(${col("userId")}::text[], ${col("opponentId")}::text[], ${col("day")}::text[], ${col("hands")}::int[],
      ${col("flow")}::float8[], ${col("flowBB")}::float8[])
    ON CONFLICT ("userId", "day", "opponentId") DO UPDATE SET
      "hands" = "PlayerOpponentDaily"."hands" + EXCLUDED."hands",
      "flow" = "PlayerOpponentDaily"."flow" + EXCLUDED."flow",
      "flowBB" = "PlayerOpponentDaily"."flowBB" + EXCLUDED."flowBB"`;
}

/**
 * Writes Hand + HandPlayer rows and the PlayerDailyStat upserts for one completed hand. Run it inside the
 * runtime's hand-boundary transaction. Idempotent per (lobbyId, handNumber): a second call is a no-op that
 * returns { created: false } (daily stats are not counted twice).
 */
export async function persistCompletedHand(
  tx: Prisma.TransactionClient,
  input: PersistCompletedHandInput,
): Promise<PersistCompletedHandResult> {
  const existing = await tx.hand.findUnique({
    where: { lobbyId_handNumber: { lobbyId: input.lobbyId, handNumber: input.handNumber } },
    select: { id: true },
  });
  if (existing) return { handId: existing.id, created: false };

  const rows = buildPersistRows(input);
  const hand = await tx.hand.create({
    data: {
      ...rows.hand,
      pots: rows.hand.pots as unknown as Prisma.InputJsonValue,
      events: rows.hand.events as unknown as Prisma.InputJsonValue,
      boards: rows.hand.boards as unknown as Prisma.InputJsonValue,
      deckReveal: rows.hand.deckReveal === null ? Prisma.DbNull : (rows.hand.deckReveal as unknown as Prisma.InputJsonValue),
    },
    select: { id: true },
  });
  await tx.handPlayer.createMany({
    data: rows.players.map((p) => ({
      ...p,
      handId: hand.id,
      holeCards: p.holeCards as unknown as Prisma.InputJsonValue,
      createdAt: input.endedAt,
    })),
  });
  await upsertDailyStats(tx, rows.daily);
  await upsertOpponentDaily(tx, rows.opponents);
  return { handId: hand.id, created: true };
}

export type RecordSidePaymentsInput = {
  handId: string;
  payments: readonly PersistSidePayment[];
  /** Players showing their cards with this amendment (e.g. the 7-2 claim after winning uncontested). */
  shownPlayerIds?: readonly string[];
};

/**
 * Amends a persisted hand with side payments settled after it was saved (7-2 bounty claimed with "Show", a nit
 * paying on leaving): adjusts HandPlayer.net / endingStack, appends SIDE_PAYMENT / SHOW events, and adds the
 * net to PlayerDailyStat on the hand's day. Users who were not dealt in only get the daily net change.
 */
export async function recordSidePayments(tx: Prisma.TransactionClient, input: RecordSidePaymentsInput): Promise<void> {
  const hand = await tx.hand.findUnique({
    where: { id: input.handId },
    select: {
      id: true,
      events: true,
      endedAt: true,
      startedAt: true,
      bigBlind: true,
      players: { select: { id: true, userId: true, seat: true, holeCards: true, shown: true, net: true } },
    },
  });
  if (!hand) throw new PersistHandError("Hand not found.");
  const day = utcDay(hand.endedAt ?? hand.startedAt);
  const events = (Array.isArray(hand.events) ? hand.events : []) as unknown as StoredHandEvent[];
  let seq = events.reduce((max, e) => Math.max(max, e.seq), 0);
  const bySeat = new Map(hand.players.map((p) => [p.userId, p]));
  const delta = new Map<string, number>();

  for (const id of input.shownPlayerIds ?? []) {
    const p = bySeat.get(id);
    if (!p) throw new PersistHandError(`Unknown shown player ${id}.`);
    if (p.shown) continue;
    events.push({ type: "SHOW", seq: ++seq, playerId: id, seat: p.seat, cards: (p.holeCards as string[]).slice() });
    await tx.handPlayer.update({ where: { id: p.id }, data: { shown: true } });
  }
  for (const payment of input.payments) {
    if (!isPositiveInt(payment.amount)) throw new PersistHandError("Side payment amounts must be positive integers.");
    if (payment.fromUserId === payment.toUserId) throw new PersistHandError("A side payment needs two different users.");
    events.push({
      type: "SIDE_PAYMENT",
      seq: ++seq,
      reason: payment.reason,
      fromUserId: payment.fromUserId,
      fromSeat: bySeat.get(payment.fromUserId)?.seat ?? null,
      toUserId: payment.toUserId,
      toSeat: bySeat.get(payment.toUserId)?.seat ?? null,
      amount: payment.amount,
    });
    delta.set(payment.fromUserId, (delta.get(payment.fromUserId) ?? 0) - payment.amount);
    delta.set(payment.toUserId, (delta.get(payment.toUserId) ?? 0) + payment.amount);
  }

  await tx.hand.update({ where: { id: hand.id }, data: { events: events as unknown as Prisma.InputJsonValue } });
  const daily: DailyStatDelta[] = [];
  for (const [userId, amount] of delta) {
    if (amount === 0) continue;
    const p = bySeat.get(userId);
    const centiBB = p ? netCentiBB(p.net + amount, hand.bigBlind) - netCentiBB(p.net, hand.bigBlind) : 0;
    if (p) {
      await tx.handPlayer.update({
        where: { id: p.id },
        data: {
          net: { increment: amount },
          endingStack: { increment: amount },
          // NULL stays NULL (not an all-in hand).
          allInEvNet: { increment: amount },
        },
      });
    }
    daily.push(netOnlyDelta(userId, day, amount, centiBB));
  }
  await upsertDailyStats(tx, daily);

  // Money flow: replace this hand's pair flows (old nets) with the amended ones.
  const oldNets = hand.players.map((p) => ({ userId: p.userId, net: p.net }));
  const newNets = oldNets.map((p) => ({ userId: p.userId, net: p.net + (delta.get(p.userId) ?? 0) }));
  if (newNets.some((p, i) => p.net !== oldNets[i]!.net)) {
    const before = new Map(opponentFlows(oldNets, hand.bigBlind).map((f) => [`${f.userId}|${f.opponentId}`, f]));
    await upsertOpponentDaily(
      tx,
      opponentFlows(newNets, hand.bigBlind).map((f) => {
        const old = before.get(`${f.userId}|${f.opponentId}`)!;
        return { ...f, flow: f.flow - old.flow, flowBB: f.flowBB - old.flowBB, day, hands: 0 };
      }),
    );
  }
}
