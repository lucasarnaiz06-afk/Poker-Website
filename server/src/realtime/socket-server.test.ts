import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Ack, ClientToServerEvents, ServerToClientEvents, TableView } from "@poker-platform/shared/types";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { ManualClock } from "../table-runtime/clock";
import { MemoryStore, seededRng } from "../table-runtime/memory-ports";
import { makeSettings, TABLE_ID } from "../table-runtime/test-harness";
import { createRealtime } from "./socket-server";

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
const ORIGIN = "http://allowed.test";

const servers: HttpServer[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function setup() {
  const httpServer = createServer();
  servers.push(httpServer);
  const store = new MemoryStore();
  store.addTable({ id: TABLE_ID, hostUserId: "u1", settings: makeSettings() });
  for (const id of ["u1", "u2", "u3", "spec"]) store.addUser(id, 50_000);
  const clock = new ManualClock();
  const { io, runtime } = createRealtime({
    httpServer,
    runtimeDeps: { clock, rng: seededRng(7), wallet: store, hands: store, lobby: store, gate: store, lobbyThrottleMs: 10 },
    async authenticate(request) {
      const user = request.headers["x-test-user"];
      return typeof user === "string" && user ? { userId: user } : null;
    },
    isOriginAllowed: (origin) => origin === ORIGIN,
    logger: () => undefined,
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const settle = () => runtime.idle();

  async function client(userId: string | null, origin = ORIGIN): Promise<Client> {
    const socket: Client = connect(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      extraHeaders: { origin, ...(userId ? { "x-test-user": userId } : {}) },
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    return socket;
  }

  // Wait for in-flight socket events (they reach the runtime asynchronously).
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await settle();
    }
  };
  return { io, runtime, store, clock, client, settle, flush, advance: (ms: number) => clock.advance(ms, settle) };
}

function emit<T>(socket: Client, event: string, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => {
    (socket as unknown as { emit: (e: string, p: unknown, cb: (r: Ack<T>) => void) => void }).emit(event, payload, resolve);
  });
}

function lastState(states: TableView[]) {
  return states[states.length - 1]!;
}

describe("socket layer", () => {
  it("rejects bad origins and unauthenticated handshakes", async () => {
    const s = await setup();
    await expect(s.client("u1", "http://evil.test")).rejects.toBeTruthy();
    await expect(s.client(null)).rejects.toBeTruthy();
    await expect(s.client("u1")).resolves.toBeTruthy();
  });

  it("plays a hand through sockets with acks, per-viewer views and wallet updates", async () => {
    const s = await setup();
    const a = await s.client("u1");
    const b = await s.client("u2");
    const spec = await s.client("spec");
    const states: Record<string, TableView[]> = { a: [], b: [], spec: [] };
    a.on("table:state", (v) => states.a!.push(v));
    b.on("table:state", (v) => states.b!.push(v));
    spec.on("table:state", (v) => states.spec!.push(v));
    const balances: number[] = [];
    a.on("wallet:balance", ({ balance }) => balances.push(balance));

    const joined = await emit<TableView>(a, "table:join", { tableId: TABLE_ID });
    expect(joined.ok).toBe(true);
    expect((joined as { data: TableView }).data.viewer.walletBalance).toBe(50_000);
    expect((await emit(b, "table:join", { tableId: TABLE_ID })).ok).toBe(true);
    expect((await emit(spec, "table:join", { tableId: TABLE_ID })).ok).toBe(true);
    expect(await emit(a, "table:sit", { tableId: TABLE_ID, seat: 1, buyIn: 1000 })).toEqual({ ok: true, data: undefined });
    expect((await emit(b, "table:sit", { tableId: TABLE_ID, seat: 2, buyIn: 1000 })).ok).toBe(true);
    await s.flush();
    expect(balances).toContain(49_000);

    await s.advance(3_000);
    await s.flush();
    const view = lastState(states.a!);
    expect(view.hand).not.toBeNull();
    expect(view.seats.find((x) => x.userId === "u1")!.holeCards).toHaveLength(2);
    expect(view.seats.find((x) => x.userId === "u2")!.holeCards).toBeNull();
    expect(lastState(states.spec!).seats.every((x) => x.holeCards === null)).toBe(true);
    expect(lastState(states.spec!).viewer.seat).toBeNull();

    // Heads-up: the button (seat 1, u1) acts first preflop.
    const handId = view.hand!.handId;
    expect(view.viewer.legalActions).not.toBeNull();
    expect(lastState(states.b!).viewer.legalActions).toBeNull();
    const wrongTurn = await emit(b, "table:action", { tableId: TABLE_ID, handId, type: "call" });
    expect(wrongTurn).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
    const stale = await emit(a, "table:action", { tableId: TABLE_ID, handId: "old-hand", type: "call" });
    expect(stale).toMatchObject({ ok: false, code: "STALE_HAND" });
    expect(await emit(a, "table:action", { tableId: TABLE_ID, handId, type: "fold" })).toEqual({ ok: true, data: undefined });
    await s.flush();
    const done = lastState(states.spec!);
    expect(done.hand!.phase).toBe("COMPLETE");
    expect(done.hand!.result!.winners[0]!.userId).toBe("u2");
    expect(done.version).toBeGreaterThan(view.version);
    expect(s.store.hands).toHaveLength(1);

    // Reconnect: a fresh socket gets the full view (own cards included) on join.
    a.disconnect();
    const a2 = await s.client("u1");
    const rejoin = (await emit<TableView>(a2, "table:join", { tableId: TABLE_ID })) as { ok: true; data: TableView };
    expect(rejoin.data.viewer.seat).toBe(1);
  });

  it("validates payloads strictly and requires joining", async () => {
    const s = await setup();
    const a = await s.client("u1");
    expect(await emit(a, "table:sit", { tableId: TABLE_ID, seat: 1, buyIn: 1000 })).toMatchObject({ ok: false, code: "NOT_JOINED" });
    await emit(a, "table:join", { tableId: TABLE_ID });
    const bad = [
      { tableId: TABLE_ID, seat: 1, buyIn: 1000.5 },
      { tableId: TABLE_ID, seat: 1, buyIn: "1000" },
      { tableId: TABLE_ID, seat: 1, buyIn: 1000, userId: "u2" },
      { tableId: TABLE_ID, seat: 0, buyIn: 1000 },
      { tableId: "x".repeat(65), seat: 1, buyIn: 1000 },
      null,
      "hello",
    ];
    for (const payload of bad) {
      expect(await emit(a, "table:sit", payload)).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    }
    expect(await emit(a, "table:chat", { tableId: TABLE_ID, text: "   " })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await emit(a, "table:chat", { tableId: TABLE_ID, emoteId: "53" })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await emit(a, "table:chat", { tableId: TABLE_ID, text: "x".repeat(201) })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await emit(a, "table:action", { tableId: TABLE_ID, handId: "h", type: "shove" })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(s.store.balances.get("u1")).toBe(50_000);
  });

  it("drops oversized payloads by disconnecting the socket", async () => {
    const s = await setup();
    const a = await s.client("u1");
    const disconnected = new Promise<string>((resolve) => a.once("disconnect", (reason) => resolve(reason)));
    a.emit("table:chat", { tableId: TABLE_ID, text: "x".repeat(40_000) }, () => undefined);
    await expect(disconnected).resolves.toBeTruthy();
  });

  it("rate limits chat to 5 messages per 10 seconds per user", async () => {
    const s = await setup();
    const a = await s.client("u1");
    const a2 = await s.client("u1");
    await emit(a, "table:join", { tableId: TABLE_ID });
    await emit(a2, "table:join", { tableId: TABLE_ID });
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await emit(a, "table:chat", { tableId: TABLE_ID, text: `hi ${i}` }));
    results.push(await emit(a2, "table:chat", { tableId: TABLE_ID, text: "hi" }));
    results.push(await emit(a2, "table:chat", { tableId: TABLE_ID, text: "spam" }));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, true, true, false]);
    expect(results[5]).toMatchObject({ code: "RATE_LIMITED" });
    await s.clock.advance(10_000);
    expect((await emit(a, "table:chat", { tableId: TABLE_ID, text: "again" })).ok).toBe(true);
  });

  it("rate limits actions per socket", async () => {
    const s = await setup();
    const a = await s.client("u1");
    await emit(a, "table:join", { tableId: TABLE_ID });
    const codes: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      const r = await emit(a, "table:action", { tableId: TABLE_ID, handId: "h1", type: "fold" });
      if (!r.ok) codes.push(r.code);
    }
    expect(codes.filter((c) => c === "RATE_LIMITED")).toHaveLength(2);
  });

  it("one seat per user per table across sockets", async () => {
    const s = await setup();
    const a = await s.client("u1");
    const a2 = await s.client("u1");
    await emit(a, "table:join", { tableId: TABLE_ID });
    await emit(a2, "table:join", { tableId: TABLE_ID });
    expect((await emit(a, "table:sit", { tableId: TABLE_ID, seat: 1, buyIn: 1000 })).ok).toBe(true);
    expect(await emit(a2, "table:sit", { tableId: TABLE_ID, seat: 2, buyIn: 1000 })).toMatchObject({ ok: false, code: "ALREADY_SEATED" });
  });

  it("lobby feed: subscribe acks the list and pushes changes", async () => {
    const s = await setup();
    const a = await s.client("u1");
    const pushes: number[] = [];
    a.on("lobby:tables", (tables) => pushes.push(tables[0]!.seated));
    const sub = (await emit<Array<{ tableId: string; seated: number }>>(a, "lobby:subscribe", {})) as {
      ok: true;
      data: Array<{ tableId: string; seated: number }>;
    };
    expect(sub.data).toEqual([expect.objectContaining({ tableId: TABLE_ID, seated: 0 })]);
    await emit(a, "table:join", { tableId: TABLE_ID });
    await emit(a, "table:sit", { tableId: TABLE_ID, seat: 1, buyIn: 1000 });
    await s.advance(50);
    await s.flush();
    expect(pushes.at(-1)).toBe(1);
  });

  it("host closes the table: everyone refunded", async () => {
    const s = await setup();
    const a = await s.client("u1");
    const b = await s.client("u2");
    for (const [sock, seat] of [[a, 1], [b, 2]] as const) {
      await emit(sock, "table:join", { tableId: TABLE_ID });
      await emit(sock, "table:sit", { tableId: TABLE_ID, seat, buyIn: 1000 });
    }
    expect(await emit(b, "table:close", { tableId: TABLE_ID })).toMatchObject({ ok: false, code: "NOT_HOST" });
    expect((await emit(a, "table:close", { tableId: TABLE_ID })).ok).toBe(true);
    expect(s.store.balances.get("u1")).toBe(50_000);
    expect(s.store.balances.get("u2")).toBe(50_000);
    expect(await emit(a, "table:join", { tableId: TABLE_ID })).toMatchObject({ ok: false, code: "TABLE_NOT_FOUND" });
  });
});
