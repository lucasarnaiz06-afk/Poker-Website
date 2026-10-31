import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ManualClock } from "../table-runtime/clock";
import { MemoryStore, RecordingTransport, seededRng } from "../table-runtime/memory-ports";
import { TableRuntime } from "../table-runtime/runtime";
import { makeSettings, TABLE_ID } from "../table-runtime/test-harness";
import { createApp } from "./app";
import { constantTimeEquals } from "./routes/admin.routes";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

async function start(password: string | null, trustProxyHops = 0) {
  return startWith(password, trustProxyHops);
}

async function startWith(password: string | null, trustProxyHops = 0) {
  const store = new MemoryStore();
  store.addTable({ id: TABLE_ID, hostUserId: "u1", settings: makeSettings() });
  store.addUser("u1", 10_000);
  store.addUser("u2", 10_000);
  const runtime = new TableRuntime({
    clock: new ManualClock(),
    rng: seededRng(3),
    wallet: store,
    hands: store,
    lobby: store,
    gate: store,
    transport: new RecordingTransport(),
  });
  const server = createServer(
    createApp({
      getTableRuntime: () => runtime,
      commandCenterPassword: password,
      trustProxyHops,
      // Test auth: "Cookie: uid=<userId>".
      authenticate: async (cookie) => {
        const match = cookie?.match(/(?:^|; )uid=([\w-]+)/);
        return match ? { userId: match[1]! } : null;
      },
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { runtime, base };
}

describe("http", () => {
  it("POST /tables/:id/close: host only, JSON + allowed Origin, closes the table", async () => {
    const { base, runtime } = await start("pw");
    const close = (headers: Record<string, string>) =>
      fetch(`${base}/tables/${TABLE_ID}/close`, { method: "POST", headers, body: "{}" });
    const json = { "content-type": "application/json" };
    expect((await close(json)).status).toBe(401);
    expect((await close({ ...json, cookie: "uid=u1", origin: "https://evil.example" })).status).toBe(403);
    expect((await close({ "content-type": "text/plain", cookie: "uid=u1" })).status).toBe(403);
    const notHost = await close({ ...json, cookie: "uid=u2" });
    expect(notHost.status).toBe(403);
    expect(await notHost.json()).toMatchObject({ error: "NOT_HOST" });
    const ok = await close({ ...json, cookie: "uid=u1", origin: "http://localhost:3000" });
    expect(ok.status).toBe(200);
    expect(runtime.tables.has(TABLE_ID)).toBe(false);
    expect((await close({ ...json, cookie: "uid=u1" })).status).toBe(404);
  });

  it("GET /tables: live public tables for signed-in users", async () => {
    const { base } = await start("pw");
    expect((await fetch(`${base}/tables`)).status).toBe(401);
    const response = await fetch(`${base}/tables`, { headers: { cookie: "uid=u2" } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { tables: Array<{ tableId: string; seated: number }> };
    expect(body.tables.map((t) => t.tableId)).toContain(TABLE_ID);
  });

  it("sends security headers", async () => {
    const { base } = await start("pw");
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("x-frame-options")).toBeTruthy();
    expect(response.headers.get("x-powered-by")).toBeNull();
  });

  it("constant-time password comparison", () => {
    expect(constantTimeEquals("secret", "secret")).toBe(true);
    expect(constantTimeEquals("secret", "secreT")).toBe(false);
    expect(constantTimeEquals("", "secret")).toBe(false);
    expect(constantTimeEquals("secret-and-more", "secret")).toBe(false);
  });

  it("command center: disabled without a password, protected, rate limited, works with the runtime", async () => {
    const disabled = await start(null);
    expect((await fetch(`${disabled.base}/admin/games`)).status).toBe(503);

    const { base, runtime } = await start("letmein");
    expect((await fetch(`${base}/admin/games`, { headers: { "x-command-password": "nope" } })).status).toBe(401);
    await runtime.join("c1", "u1", TABLE_ID, {});
    await runtime.join("c2", "u2", TABLE_ID, {});
    await runtime.sit("u1", TABLE_ID, 1, 1000);
    await runtime.sit("u2", TABLE_ID, 2, 1000);
    const ok = await fetch(`${base}/admin/games`, { headers: { "x-command-password": "letmein" } });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { games: Array<{ lobbyId: string; playerCount: number }> };
    expect(body.games[0]).toMatchObject({ lobbyId: TABLE_ID, playerCount: 2 });
    const detail = await fetch(`${base}/admin/games/${TABLE_ID}`, { headers: { "x-command-password": "letmein" } });
    expect(detail.status).toBe(200);
    const missing = await fetch(`${base}/admin/games/nope`, { headers: { "x-command-password": "letmein" } });
    expect(missing.status).toBe(404);

    for (let i = 0; i < 9; i += 1) await fetch(`${base}/admin/games`, { headers: { "x-command-password": `bad${i}` } });
    // 10 failures in the window: locked out even with the right password.
    const locked = await fetch(`${base}/admin/games`, { headers: { "x-command-password": "letmein" } });
    expect(locked.status).toBe(429);
  });

  it("command center: rotating X-Forwarded-For does not reset the per-IP lockout by default", async () => {
    const { base } = await start("letmein");
    for (let i = 0; i < 10; i += 1) {
      const response = await fetch(`${base}/admin/games`, {
        headers: { "x-command-password": `bad${i}`, "x-forwarded-for": `198.51.100.${i}` },
      });
      expect(response.status).toBe(401);
    }
    const locked = await fetch(`${base}/admin/games`, {
      headers: { "x-command-password": "letmein", "x-forwarded-for": "198.51.100.200" },
    });
    expect(locked.status).toBe(429);
  });

  it("command center: a global failure ceiling stops brute force from many (trusted) client IPs", async () => {
    const { base } = await start("letmein", 1);
    // 30 failures spread over 6 IPs (5 each) never trip the per-IP limit of 10...
    for (let i = 0; i < 30; i += 1) {
      const response = await fetch(`${base}/admin/games`, {
        headers: { "x-command-password": `bad${i}`, "x-forwarded-for": `198.51.100.${i % 6}` },
      });
      expect(response.status).toBe(401);
    }
    // ...but the site-wide ceiling locks every IP, including a fresh one with the right password.
    const locked = await fetch(`${base}/admin/games`, {
      headers: { "x-command-password": "letmein", "x-forwarded-for": "203.0.113.99" },
    });
    expect(locked.status).toBe(429);
  });
});
