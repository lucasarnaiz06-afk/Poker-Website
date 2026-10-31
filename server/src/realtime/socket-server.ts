// Socket.io layer: handshake checks (Origin allowlist, session cookie), payload validation, per-socket
// rate limits and ack-based commands that forward to the TableRuntime. No game logic lives here.
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type {
  Ack,
  ClientToServerEvents,
  LobbyTableSummary,
  ServerToClientEvents,
} from "@poker-platform/shared/types";
import { Server, type Socket } from "socket.io";
import { ZodError } from "zod";
import { RuntimeError } from "../table-runtime/errors";
import type { TableTransport } from "../table-runtime/ports";
import { TableRuntime, type RuntimeDeps } from "../table-runtime/runtime";
import { DEFAULT_SOCKET_LIMITS, SlidingWindowLimiter, type RateLimitCategory, type WindowPolicy } from "./rate-limit";
import { schemas, type PayloadOf, type SocketEventName } from "./schemas";

export type SocketAuth = { userId: string };

type SocketData = { userId: string };
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type LooseSocket = { on(event: string, listener: (...args: unknown[]) => void): void };
type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export type RealtimeOptions = {
  httpServer: HttpServer;
  runtimeDeps: Omit<RuntimeDeps, "transport">;
  /** Resolves the user from the handshake (session cookie in production). null = reject. */
  authenticate: (request: IncomingMessage) => Promise<SocketAuth | null>;
  isOriginAllowed: (origin: string | undefined) => boolean;
  limits?: Partial<Record<RateLimitCategory, WindowPolicy>>;
  maxPayloadBytes?: number;
  logger?: (message: string, error?: unknown) => void;
};

const CATEGORY: Record<SocketEventName, RateLimitCategory> = {
  "table:join": "join",
  "table:leave": "join",
  "table:sit": "seat",
  "table:stand": "seat",
  "table:sitOut": "seat",
  "table:rebuy": "seat",
  "table:start": "seat",
  "table:close": "seat",
  "table:straddle": "seat",
  "table:show": "seat",
  "table:action": "action",
  "table:propose": "vote",
  "table:vote": "vote",
  "table:chat": "chat",
  "lobby:subscribe": "lobby",
  "lobby:unsubscribe": "lobby",
};

/** Chat is limited per user (all their sockets); everything else per socket. */
const PER_USER: ReadonlySet<RateLimitCategory> = new Set(["chat"]);

function userRoom(userId: string) {
  return `user:${userId}`;
}
const LOBBY_ROOM = "lobby";

export function createRealtime(options: RealtimeOptions) {
  const limits = { ...DEFAULT_SOCKET_LIMITS, ...options.limits };
  const logError = options.logger ?? ((message: string, error?: unknown) => console.error(`[realtime] ${message}`, error ?? ""));
  const io: GameServer = new Server(options.httpServer, {
    maxHttpBufferSize: options.maxPayloadBytes ?? 16_384,
    serveClient: false,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    cors: {
      origin(origin, callback) {
        callback(null, options.isOriginAllowed(origin));
      },
      allowedHeaders: ["content-type", "ngrok-skip-browser-warning"],
      credentials: true,
    },
    allowRequest(request, callback) {
      callback(null, options.isOriginAllowed(request.headers.origin));
    },
  });

  const transport: TableTransport = {
    sendState(connId, view) {
      io.sockets.sockets.get(connId)?.emit("table:state", view);
    },
    sendChat(connIds, message) {
      if (connIds.length > 0) io.to(connIds).emit("table:chat", message);
    },
    sendError(connId, error) {
      io.sockets.sockets.get(connId)?.emit("table:error", error);
    },
    sendBalance(userId, balance) {
      io.to(userRoom(userId)).emit("wallet:balance", { balance });
    },
  };
  const runtime = new TableRuntime({ ...options.runtimeDeps, transport });
  const limiter = new SlidingWindowLimiter(() => options.runtimeDeps.clock.now());

  let lobbySubscribers = 0;
  let unsubscribeLobby: (() => void) | null = null;
  const lobbyListener = (tables: LobbyTableSummary[]) => io.to(LOBBY_ROOM).emit("lobby:tables", tables);

  io.use(async (socket, next) => {
    try {
      const auth = await options.authenticate(socket.request);
      if (!auth) {
        next(new Error("Unauthorized"));
        return;
      }
      socket.data.userId = auth.userId;
      next();
    } catch (error) {
      logError("socket auth failed", error);
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as GameSocket;
    const userId = socket.data.userId;
    let inLobby = false;
    void socket.join(userRoom(userId));

    function handle<E extends SocketEventName, T>(
      event: E,
      handler: (payload: PayloadOf<E>) => Promise<T>,
    ) {
      (socket as unknown as LooseSocket).on(event, async (...args: unknown[]) => {
        const ack = typeof args[args.length - 1] === "function" ? (args.pop() as (r: Ack<T>) => void) : null;
        const reply = (result: Ack<T>) => {
          if (ack) ack(result);
        };
        if (!ack) return; // every command is ack-based
        const category = CATEGORY[event];
        const limitKey = PER_USER.has(category) ? `u:${userId}:${category}` : `s:${socket.id}:${category}`;
        if (!limiter.take(`s:${socket.id}:any`, limits.any) || !limiter.take(limitKey, limits[category])) {
          reply({ ok: false, code: "RATE_LIMITED", message: "Slow down a little." });
          return;
        }
        const parsed = schemas[event].safeParse(args[0]);
        if (!parsed.success) {
          reply({ ok: false, code: "INVALID_PAYLOAD", message: parsed.error.issues[0]?.message ?? "Invalid request." });
          return;
        }
        try {
          const data = await handler(parsed.data as PayloadOf<E>);
          reply({ ok: true, data });
        } catch (error) {
          if (error instanceof RuntimeError) {
            reply({ ok: false, code: error.code, message: error.message });
          } else if (error instanceof ZodError) {
            reply({ ok: false, code: "INVALID_PAYLOAD", message: "Invalid request." });
          } else {
            logError(`${event} failed`, error);
            reply({ ok: false, code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." });
          }
        }
      });
    }

    /** Table commands need a prior table:join from this socket. */
    function requireJoined(tableId: string) {
      if (!runtime.isViewing(socket.id, tableId)) throw new RuntimeError("NOT_JOINED", "Join the table first.");
    }

    handle("table:join", (p) => runtime.join(socket.id, userId, p.tableId, { password: p.password, inviteCode: p.inviteCode }));
    handle("table:leave", async (p) => {
      await runtime.leave(socket.id, p.tableId);
      return undefined;
    });
    handle("table:sit", async (p) => {
      requireJoined(p.tableId);
      await runtime.sit(userId, p.tableId, p.seat, p.buyIn, p.postNow);
      return undefined;
    });
    handle("table:stand", async (p) => {
      requireJoined(p.tableId);
      await runtime.stand(userId, p.tableId);
      return undefined;
    });
    handle("table:sitOut", async (p) => {
      requireJoined(p.tableId);
      await runtime.sitOut(userId, p.tableId, p.sitOut);
      return undefined;
    });
    handle("table:rebuy", async (p) => {
      requireJoined(p.tableId);
      await runtime.rebuy(userId, p.tableId, p.amount);
      return undefined;
    });
    handle("table:start", async (p) => {
      requireJoined(p.tableId);
      await runtime.start(userId, p.tableId);
      return undefined;
    });
    handle("table:close", async (p) => {
      requireJoined(p.tableId);
      await runtime.close(userId, p.tableId);
      return undefined;
    });
    handle("table:action", async (p) => {
      requireJoined(p.tableId);
      await runtime.action(userId, p.tableId, p.handId, p.type, p.amount);
      return undefined;
    });
    handle("table:straddle", async (p) => {
      requireJoined(p.tableId);
      await runtime.straddle(userId, p.tableId, p.enabled);
      return undefined;
    });
    handle("table:propose", async (p) => {
      requireJoined(p.tableId);
      await runtime.propose(userId, p.tableId, p.kind, p.action);
      return undefined;
    });
    handle("table:vote", async (p) => {
      requireJoined(p.tableId);
      await runtime.vote(userId, p.tableId, p.voteId, p.yes);
      return undefined;
    });
    handle("table:show", async (p) => {
      requireJoined(p.tableId);
      await runtime.show(userId, p.tableId, p.handId);
      return undefined;
    });
    handle("table:chat", async (p) => {
      requireJoined(p.tableId);
      await runtime.chat(userId, p.tableId, p.text, p.emoteId);
      return undefined;
    });
    handle("lobby:subscribe", async () => {
      if (!inLobby) {
        inLobby = true;
        await socket.join(LOBBY_ROOM);
        lobbySubscribers += 1;
        unsubscribeLobby ??= runtime.subscribeLobby(lobbyListener);
      }
      return runtime.lobbySummaries();
    });
    const leaveLobby = () => {
      if (!inLobby) return;
      inLobby = false;
      void socket.leave(LOBBY_ROOM);
      lobbySubscribers -= 1;
      if (lobbySubscribers <= 0 && unsubscribeLobby) {
        lobbySubscribers = 0;
        unsubscribeLobby();
        unsubscribeLobby = null;
      }
    };
    handle("lobby:unsubscribe", async () => {
      leaveLobby();
      return undefined;
    });

    socket.on("disconnect", () => {
      leaveLobby();
      limiter.forget(`s:${socket.id}:`);
      void runtime.disconnect(socket.id).catch((error) => logError("disconnect cleanup failed", error));
    });
  });

  return { io, runtime };
}
