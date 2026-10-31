import { Router, type Request } from "express";
import { z } from "zod";
import { SlidingWindowLimiter } from "../../realtime/rate-limit";
import { authenticateCookieHeader } from "../../security/session";
import { RuntimeError, type TableRuntime } from "../../table-runtime";
import { isCorsOriginAllowed } from "../cors";

type TableRuntimeGetter = () => TableRuntime | null;
/** Resolves the signed-in user from the Cookie header (null = not signed in). */
export type CookieAuthenticator = (cookieHeader: string | undefined) => Promise<{ userId: string } | null>;

const sessionCookieAuth: CookieAuthenticator = async (cookieHeader) => {
  const session = await authenticateCookieHeader(cookieHeader);
  return session ? { userId: session.user.id } : null;
};

const tableIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const CLOSE_LIMIT = { capacity: 10, windowMs: 60_000 };
const LIST_LIMIT = { capacity: 30, windowMs: 60_000 };

const STATUS_BY_CODE: Record<string, number> = {
  NOT_HOST: 403,
  TABLE_NOT_FOUND: 404,
  TABLE_CLOSED: 404,
  CLOSE_INCOMPLETE: 409,
  SERVER_RESTARTING: 503,
};

/**
 * Table commands that don't need a socket (the lobby's "Close" button, via a Next server action that forwards
 * the user's session cookie). Mutations require JSON and, when an Origin is sent (browsers), an allowed one,
 * so a cross-site form post can't trigger them.
 */
export function createTablesRouter(
  getTableRuntime: TableRuntimeGetter,
  options: { now?: () => number; authenticate?: CookieAuthenticator } = {},
) {
  const router = Router();
  const authenticate = options.authenticate ?? sessionCookieAuth;
  const limiter = new SlidingWindowLimiter(options.now ?? Date.now);

  function originOk(request: Request) {
    const origin = request.headers.origin;
    return origin === undefined || isCorsOriginAllowed(origin);
  }

  /** Live public table list (same data as the socket lobby feed): seated counts come from the running tables. */
  router.get("/", async (request, response, next) => {
    try {
      const session = await authenticate(request.headers.cookie);
      if (!session) {
        response.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in again." });
        return;
      }
      if (!limiter.take(`list:${session.userId}`, LIST_LIMIT)) {
        response.status(429).json({ error: "RATE_LIMITED", message: "Too many requests. Try again in a minute." });
        return;
      }
      const runtime = getTableRuntime();
      if (!runtime) {
        response.status(503).json({ error: "SERVER_RESTARTING", message: "The game server is starting. Try again in a moment." });
        return;
      }
      response.json({ tables: await runtime.lobbySummaries() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:tableId/close", async (request, response, next) => {
    try {
      if (!originOk(request) || !request.is("application/json")) {
        response.status(403).json({ error: "FORBIDDEN" });
        return;
      }
      const tableId = tableIdSchema.safeParse(request.params.tableId);
      if (!tableId.success) {
        response.status(404).json({ error: "TABLE_NOT_FOUND", message: "Table not found." });
        return;
      }
      const session = await authenticate(request.headers.cookie);
      if (!session) {
        response.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in again." });
        return;
      }
      if (!limiter.take(`close:${session.userId}`, CLOSE_LIMIT)) {
        response.status(429).json({ error: "RATE_LIMITED", message: "Too many requests. Try again in a minute." });
        return;
      }
      const runtime = getTableRuntime();
      if (!runtime) {
        response.status(503).json({ error: "SERVER_RESTARTING", message: "The game server is starting. Try again in a moment." });
        return;
      }
      await runtime.closeAsHost(session.userId, tableId.data);
      response.json({ ok: true });
    } catch (error) {
      if (error instanceof RuntimeError) {
        response.status(STATUS_BY_CODE[error.code] ?? 400).json({ error: error.code, message: error.message });
        return;
      }
      next(error);
    }
  });

  return router;
}
