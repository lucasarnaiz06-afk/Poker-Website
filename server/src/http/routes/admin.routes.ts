import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { env } from "../../config/env";
import {
  getCommandCenterGame,
  listCommandCenterGames,
  RuntimeError,
  type TableRuntime,
} from "../../table-runtime";
import { SlidingWindowLimiter } from "../../realtime/rate-limit";

type TableRuntimeGetter = () => TableRuntime | null;

/** Constant-time comparison: both sides are hashed first so lengths never leak. */
export function constantTimeEquals(provided: string, expected: string) {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b) && provided.length === expected.length;
}

function readPasswordHeader(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim().slice(0, 256) : "";
}

const FAILED_ATTEMPTS = { capacity: 10, windowMs: 15 * 60_000 };
/**
 * Site-wide ceiling on wrong passwords: even an attacker with many source IPs gets at most this many guesses
 * per 15 minutes. The trade-off is that a flood of bad guesses also locks out the real operator for the window.
 */
const GLOBAL_FAILED_ATTEMPTS = { capacity: 30, windowMs: 15 * 60_000 };
const GLOBAL_FAIL_KEY = "fail:*";
const REQUESTS = { capacity: 120, windowMs: 60_000 };

export function createAdminRouter(
  getTableRuntime: TableRuntimeGetter,
  options: { password?: string | null; now?: () => number } = {},
) {
  const adminRouter = Router();
  const limiter = new SlidingWindowLimiter(options.now ?? Date.now);
  const failures = new SlidingWindowLimiter(options.now ?? Date.now);
  const password = options.password === undefined ? env.commandCenterPassword : options.password;
  const clientKey = (request: Request) => request.ip ?? request.socket.remoteAddress ?? "unknown";

  adminRouter.use((request, response, next) => {
    if (!password) {
      response.status(503).json({ error: "COMMAND_CENTER_DISABLED" });
      return;
    }
    const key = clientKey(request);
    if (!limiter.take(`req:${key}`, REQUESTS)) {
      response.status(429).json({ error: "RATE_LIMITED" });
      return;
    }
    // Locked out after too many wrong passwords: refuse without checking (no oracle while locked).
    if (isLocked(`fail:${key}`, FAILED_ATTEMPTS) || isLocked(GLOBAL_FAIL_KEY, GLOBAL_FAILED_ATTEMPTS)) {
      response.status(429).json({ error: "RATE_LIMITED" });
      return;
    }
    if (!constantTimeEquals(readPasswordHeader(request.headers["x-command-password"]), password)) {
      failures.take(`fail:${key}`, FAILED_ATTEMPTS);
      failures.take(GLOBAL_FAIL_KEY, GLOBAL_FAILED_ATTEMPTS);
      response.status(401).json({ error: "UNAUTHORIZED" });
      return;
    }
    next();
  });

  function isLocked(probe: string, policy: typeof FAILED_ATTEMPTS) {
    // A probe that does not record: the window is full when one more take would fail.
    const allowed = failures.take(probe, policy);
    if (allowed) failures.untake(probe);
    return !allowed;
  }

  adminRouter.get("/games", (_request, response) => {
    const runtime = getTableRuntime();
    if (!runtime) {
      response.status(503).json({ error: "TABLE_RUNTIME_UNAVAILABLE" });
      return;
    }
    response.json({ games: listCommandCenterGames(runtime) });
  });

  adminRouter.get("/games/:lobbyId", (request, response) => {
    const runtime = getTableRuntime();
    if (!runtime) {
      response.status(503).json({ error: "TABLE_RUNTIME_UNAVAILABLE" });
      return;
    }
    try {
      response.json({ game: getCommandCenterGame(runtime, request.params.lobbyId) });
    } catch (error) {
      if (error instanceof RuntimeError && error.code === "GAME_NOT_STARTED") {
        response.status(404).json({ error: error.code, message: error.message });
        return;
      }
      throw error;
    }
  });

  return adminRouter;
}
