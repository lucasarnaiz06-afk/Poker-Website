// Runs only with RUNTIME_DB_TESTS=1 against the dev database (docker compose up -d postgres).
// Creates its own users/lobby and deletes them afterwards.
import "../config/load-env";
import { prisma } from "@poker-platform/shared/db";
import { afterAll, describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import { RecordingTransport, seededRng } from "./memory-ports";
import { PrismaHandStore, PrismaLobbyStore, PrismaPlayGate, PrismaWallet } from "./prisma-ports";
import { TableRuntime } from "./runtime";
import { makeSettings } from "./test-harness";

const enabled = process.env.RUNTIME_DB_TESTS === "1";
const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const userIds: string[] = [];
let lobbyId = "";

async function cleanup() {
  if (!lobbyId) return;
  await prisma.handPlayer.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.hand.deleteMany({ where: { lobbyId } });
  await prisma.lobbyPlayer.deleteMany({ where: { lobbyId } });
  await prisma.lobby.deleteMany({ where: { id: lobbyId } });
  await prisma.ledgerEntry.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.playerDailyStat.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

describe.runIf(enabled)("prisma adapters (dev database)", () => {
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("buy-in, hands, side payments, cash out and crash recovery keep chips conserved", async () => {
    for (const name of ["a", "b", "c"]) {
      const user = await prisma.user.create({
        data: { email: `rt-${name}-${suffix}@example.test`, username: `rt${name}${suffix}`.slice(0, 20), displayName: `RT ${name}`, chipBalance: 10_000 },
      });
      userIds.push(user.id);
    }
    const lobby = await prisma.lobby.create({
      data: {
        name: `Runtime test ${suffix}`,
        smallBlind: 5,
        bigBlind: 10,
        minBuyIn: 400,
        maxBuyIn: 2000,
        maxPlayers: 6,
        settings: makeSettings({ maxPlayers: 6 }) as never,
        createdByUserId: userIds[0]!,
        // Legacy membership row with a fake stack: must never become chips.
        players: { create: { userId: userIds[0]!, seatNumber: 1, chipStack: 400, status: "JOINED" } },
      },
    });
    lobbyId = lobby.id;
    const total = async () => {
      const users = await prisma.user.aggregate({ where: { id: { in: userIds } }, _sum: { chipBalance: true } });
      const seats = await prisma.lobbyPlayer.aggregate({ where: { lobbyId, status: "SEATED" }, _sum: { chipStack: true } });
      return (users._sum.chipBalance ?? 0) + (seats._sum.chipStack ?? 0);
    };

    const clock = new ManualClock();
    // Scoped: recover() must not refund seats of tables the running dev server owns.
    const store = new PrismaLobbyStore({ onlyTableIds: [lobbyId] });
    const make = () =>
      new TableRuntime({
        clock,
        rng: seededRng(11),
        wallet: new PrismaWallet(),
        hands: new PrismaHandStore(),
        lobby: store,
        gate: new PrismaPlayGate(),
        transport: new RecordingTransport(),
      });
    let runtime = make();
    const settle = () => runtime.idle();
    for (const [i, id] of userIds.entries()) {
      await runtime.join(`c${i}`, id, lobbyId, {});
      await runtime.sit(id, lobbyId, i + 1, 1000);
    }
    expect(await total()).toBe(30_000);
    const seats = await prisma.lobbyPlayer.findMany({ where: { lobbyId, status: "SEATED" } });
    expect(seats.map((s) => s.chipStack)).toEqual([1000, 1000, 1000]);

    for (let handNo = 0; handNo < 3; handNo += 1) {
      await clock.advance(8_000, settle);
      const table = runtime.tables.get(lobbyId)!;
      for (let guard = 0; guard < 50 && table.isLive(); guard += 1) {
        const hand = table.hand!;
        const actor = hand.engine.toActPlayerId!;
        const legal = hand.engine.legalActions(actor)!;
        await runtime.action(actor, lobbyId, hand.id, legal.canCheck ? "check" : "call");
      }
      await settle();
      expect(await total()).toBe(30_000);
    }
    const hands = await prisma.hand.findMany({ where: { lobbyId }, include: { players: true } });
    expect(hands).toHaveLength(3);
    expect(hands.every((h) => h.players.length === 3)).toBe(true);
    expect(await prisma.playerDailyStat.count({ where: { userId: { in: userIds } } })).toBe(3);

    // Stand: cash out to the wallet.
    await runtime.stand(userIds[2]!, lobbyId);
    expect(await total()).toBe(30_000);
    // Another cash-out path for the same seat (different refKey, e.g. a second process's boot recovery or
    // a shutdown racing it) must not pay the stack out twice.
    await new PrismaWallet().cashOut({ userId: userIds[2]!, tableId: lobbyId, amount: 1000, refKey: `dup:${suffix}`, reason: "RECOVERY" });
    expect(await total()).toBe(30_000);

    // Mid-hand "crash": a new runtime recovers the persisted stacks.
    await clock.advance(8_000, settle);
    const table = runtime.tables.get(lobbyId)!;
    expect(table.isLive()).toBe(true);
    await runtime.action(table.hand!.engine.toActPlayerId!, lobbyId, table.hand!.id, "call");
    runtime = make();
    const recovered = await runtime.recover();
    expect(recovered.refunded).toBe(2);
    expect(await total()).toBe(30_000);
    const balances = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { chipBalance: true } });
    expect(balances.reduce((s, u) => s + u.chipBalance, 0)).toBe(30_000);
    expect(await prisma.lobbyPlayer.count({ where: { lobbyId, status: "SEATED" } })).toBe(0);
    const legacy = await prisma.lobbyPlayer.findFirst({ where: { lobbyId, userId: userIds[0]! } });
    expect(legacy?.chipStack).toBeNull();
    // Recovery is idempotent.
    expect((await runtime.recover()).total).toBe(0);
  });
});
