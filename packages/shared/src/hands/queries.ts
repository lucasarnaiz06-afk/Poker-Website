// Server-side hand-history reads. Every hand leaving this module is redacted for its viewer.
import type { Variant } from "@poker-platform/engine";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { buildDeckProof } from "./deck-proof-node";
import { redactHandForViewer } from "./redact";
import { allInClosingStreet } from "./replay";
import type { HandView, HandViewPlayer, StoredPots } from "./types";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const handFiltersSchema = z.object({
  table: z.string().min(1).max(64).optional(),
  from: day.optional(),
  to: day.optional(),
  position: z.enum(["UTG", "UTG+1", "UTG+2", "MP", "LJ", "HJ", "CO", "BTN", "SB", "BB"]).optional(),
  result: z.enum(["won", "lost"]).optional(),
  showdown: z.enum(["yes", "no"]).optional(),
  bombPot: z.enum(["yes", "no"]).optional(),
  /** Hand number ("123" or "#123"). */
  q: z.string().max(20).optional(),
});

export type HandFilters = z.infer<typeof handFiltersSchema>;

/** Parses URL search params leniently: invalid values are dropped instead of failing the page. */
export function parseHandFilters(params: Record<string, string | string[] | undefined>): HandFilters {
  const out: Record<string, string> = {};
  for (const key of Object.keys(handFiltersSchema.shape)) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string" || value.trim() === "") continue;
    const parsed = (handFiltersSchema.shape as Record<string, z.ZodTypeAny>)[key]!.safeParse(value.trim());
    if (parsed.success) out[key] = parsed.data as string;
  }
  return out as HandFilters;
}

export type HandListRow = {
  handId: string;
  handNumber: number;
  lobbyId: string;
  tableName: string;
  endedAt: string;
  variant: Variant;
  smallBlind: number;
  bigBlind: number;
  isBombPot: boolean;
  position: string;
  holeCards: string[];
  board: string[];
  boards: string[][];
  net: number;
  wentToShowdown: boolean;
  totalPot: number;
};

export type HandListPage = { rows: HandListRow[]; nextCursor: string | null };

function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const createdAt = new Date(iso ?? "");
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function handPlayerWhere(userId: string, filters: HandFilters): Prisma.HandPlayerWhereInput {
  const where: Prisma.HandPlayerWhereInput = { userId };
  const and: Prisma.HandPlayerWhereInput[] = [];
  if (filters.from || filters.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.from) createdAt.gte = new Date(`${filters.from}T00:00:00.000Z`);
    if (filters.to) createdAt.lt = new Date(new Date(`${filters.to}T00:00:00.000Z`).getTime() + 86_400_000);
    and.push({ createdAt });
  }
  if (filters.position) and.push({ position: filters.position });
  if (filters.result === "won") and.push({ net: { gt: 0 } });
  if (filters.result === "lost") and.push({ net: { lt: 0 } });
  if (filters.showdown) and.push({ wentToShowdown: filters.showdown === "yes" });
  const hand: Prisma.HandWhereInput = {};
  if (filters.table) hand.lobbyId = filters.table;
  if (filters.bombPot) hand.isBombPot = filters.bombPot === "yes";
  const number = filters.q ? Number.parseInt(filters.q.replace(/^#/, ""), 10) : Number.NaN;
  if (filters.q !== undefined) hand.handNumber = Number.isFinite(number) ? number : -1;
  if (Object.keys(hand).length > 0) and.push({ hand });
  if (and.length > 0) where.AND = and;
  return where;
}

function asBoards(value: unknown): string[][] {
  return Array.isArray(value) ? value.filter(Array.isArray).map((b) => (b as unknown[]).filter((c): c is string => typeof c === "string")) : [];
}

function asCards(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((c): c is string => typeof c === "string") : [];
}

/** The viewer's own hands, newest first, keyset-paginated. Only the viewer's own cards are included. */
export async function listMyHands(
  userId: string,
  filters: HandFilters,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<HandListPage> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const where = handPlayerWhere(userId, filters);
  const cursor = decodeCursor(options.cursor);
  if (cursor) {
    where.OR = [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }];
  }
  const rows = await prisma.handPlayer.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      createdAt: true,
      position: true,
      holeCards: true,
      net: true,
      wentToShowdown: true,
      hand: {
        select: {
          id: true,
          handNumber: true,
          lobbyId: true,
          variant: true,
          smallBlind: true,
          bigBlind: true,
          isBombPot: true,
          boards: true,
          totalPot: true,
          endedAt: true,
          lobby: { select: { name: true } },
        },
      },
    },
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((r) => {
      const boards = asBoards(r.hand.boards);
      return {
        handId: r.hand.id,
        handNumber: r.hand.handNumber,
        lobbyId: r.hand.lobbyId,
        tableName: r.hand.lobby.name,
        endedAt: (r.hand.endedAt ?? r.createdAt).toISOString(),
        variant: (r.hand.variant === "PLO" ? "PLO" : "NLHE") as Variant,
        smallBlind: r.hand.smallBlind,
        bigBlind: r.hand.bigBlind,
        isBombPot: r.hand.isBombPot,
        position: r.position,
        holeCards: asCards(r.holeCards),
        board: boards[0] ?? [],
        boards,
        net: r.net,
        wentToShowdown: r.wentToShowdown,
        totalPot: r.hand.totalPot,
      };
    }),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/** Tables the user has played hands at (for the table filter). */
export async function listMyTables(userId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT l."id", l."name"
    FROM "Lobby" l
    WHERE EXISTS (
      SELECT 1 FROM "Hand" h JOIN "HandPlayer" hp ON hp."handId" = h."id"
      WHERE h."lobbyId" = l."id" AND hp."userId" = ${userId}
    )
    ORDER BY l."name" ASC
    LIMIT 200`;
  return rows;
}

const handViewInclude = {
  lobby: { select: { name: true } },
  players: {
    orderBy: { seat: "asc" as const },
    include: { user: { select: { username: true, displayName: true, avatar: true } } },
  },
} satisfies Prisma.HandInclude;

type HandWithPlayers = Prisma.HandGetPayload<{ include: typeof handViewInclude }>;

function toHandView(hand: HandWithPlayers, viewerId: string): HandView {
  const redacted = redactHandForViewer(hand.players, hand.events, viewerId);
  const isPlayer = hand.players.some((p) => p.userId === viewerId);
  const players: HandViewPlayer[] = redacted.players.map((p) => ({
    userId: p.userId,
    username: p.user.username,
    displayName: p.user.displayName ?? p.user.username ?? "Player",
    avatar: p.user.avatar,
    seat: p.seat,
    position: p.position,
    startingStack: p.startingStack,
    endingStack: p.endingStack,
    net: p.net,
    won: p.won,
    holeCards: p.holeCards,
    shown: p.shown,
    isViewer: p.userId === viewerId,
    sawFlop: p.sawFlop,
    wentToShowdown: p.wentToShowdown,
    wonAtShowdown: p.wonAtShowdown,
    allInEvNet: p.allInEvNet,
  }));
  const allInStreet = allInClosingStreet(redacted.events);
  return {
    id: hand.id,
    lobbyId: hand.lobbyId,
    tableName: hand.lobby.name,
    handNumber: hand.handNumber,
    variant: hand.variant === "PLO" ? "PLO" : "NLHE",
    smallBlind: hand.smallBlind,
    bigBlind: hand.bigBlind,
    ante: hand.ante,
    buttonSeat: hand.buttonSeat,
    isBombPot: hand.isBombPot,
    runItTwice: hand.runItTwice,
    boards: asBoards(hand.boards),
    pots: (Array.isArray(hand.pots) ? hand.pots : []) as unknown as StoredPots,
    totalPot: hand.totalPot,
    startedAt: hand.startedAt.toISOString(),
    endedAt: hand.endedAt?.toISOString() ?? null,
    deckCommitment: hand.deckCommitment,
    // Per-viewer proof: opens only the cards this viewer sees (board + visible hole cards), leaf hashes for the
    // rest. Legacy full-deck reveals are never sent (buildDeckProof -> null).
    deckProof: hand.endedAt ? buildDeckProof(hand.deckReveal, [...asBoards(hand.boards).flat(), ...players.flatMap((p) => p.holeCards ?? [])]) : null,
    viewerId,
    relation: isPlayer ? "PLAYER" : "SPECTATOR",
    players,
    events: redacted.events,
    allInStreet,
  };
}

/**
 * A completed hand redacted for `viewerId` (any signed-in user may open a shared hand link; non-players see
 * shown cards only). null when it does not exist or has not ended.
 */
export async function getHandView(handId: string, viewerId: string): Promise<HandView | null> {
  if (typeof handId !== "string" || handId.length === 0 || handId.length > 64) return null;
  const hand = await prisma.hand.findUnique({ where: { id: handId }, include: handViewInclude });
  if (!hand || !hand.endedAt) return null;
  return toHandView(hand, viewerId);
}

/** The viewer's hands matching `filters` (oldest first, at most `max`), redacted, for bulk export. */
export async function listMyHandViews(userId: string, filters: HandFilters, max = 2000): Promise<HandView[]> {
  const ids = await prisma.handPlayer.findMany({
    where: handPlayerWhere(userId, filters),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(max, 1), 5000),
    select: { handId: true },
  });
  const out: HandView[] = [];
  const chunk = 200;
  for (let i = 0; i < ids.length; i += chunk) {
    const hands = await prisma.hand.findMany({
      where: { id: { in: ids.slice(i, i + chunk).map((r) => r.handId) }, endedAt: { not: null } },
      include: handViewInclude,
    });
    for (const hand of hands) out.push(toHandView(hand, userId));
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
