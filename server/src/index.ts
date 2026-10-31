import { createServer } from "node:http";
import { env } from "./config/env";
import { createApp } from "./http/app";
import { isSocketOriginAllowed } from "./http/cors";
import { createRealtime } from "./realtime/socket-server";
import { authenticateCookieHeader } from "./security/session";
import { systemClock, type TableRuntime } from "./table-runtime";
import { cryptoRng } from "./table-runtime/crypto-rng";
import { PrismaHandStore, PrismaLobbyStore, PrismaPlayGate, PrismaWallet } from "./table-runtime/prisma-ports";

let tableRuntime: TableRuntime | null = null;
const app = createApp({ getTableRuntime: () => tableRuntime });
const httpServer = createServer(app);

const lobby = new PrismaLobbyStore();
const wallet = new PrismaWallet();

const { io, runtime } = createRealtime({
  httpServer,
  runtimeDeps: {
    clock: systemClock,
    rng: cryptoRng,
    wallet,
    hands: new PrismaHandStore(),
    lobby,
    gate: new PrismaPlayGate(),
  },
  async authenticate(request) {
    const session = await authenticateCookieHeader(request.headers.cookie);
    return session ? { userId: session.user.id } : null;
  },
  isOriginAllowed: isSocketOriginAllowed,
});

async function main() {
  // A previous process may have died with chips on tables: refund them before accepting players.
  const recovered = await runtime.recover();
  if (recovered.total > 0) {
    console.log(`Recovered ${recovered.refunded}/${recovered.total} table stacks from the previous run.`);
  }
  tableRuntime = runtime;
  httpServer.listen(env.port, env.host, () => {
    console.log(`Poker platform server listening on http://${env.host.includes(":") ? `[${env.host}]` : env.host}:${env.port}`);
  });
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received: closing tables and refunding stacks...`);
  const forceExit = setTimeout(() => process.exit(1), 25_000);
  forceExit.unref();
  try {
    httpServer.close();
    await runtime.shutdown();
    io.close();
  } catch (error) {
    console.error("Graceful shutdown failed", error);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((error) => {
  console.error("Server failed to start", error);
  process.exit(1);
});
