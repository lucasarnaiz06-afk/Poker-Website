import type { LobbyTableSummary } from "@poker-platform/shared/types";
import { headers } from "next/headers";

/** Server-to-server base URL of the game server (never sent to the browser). */
export function getGameServerUrl() {
  return (
    process.env.SOCKET_SERVER_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOCKET_URL?.trim() ||
    "http://localhost:4000"
  ).replace(/\/+$/, "");
}

export type GameServerResult = { ok: true } | { ok: false; code: string; message: string };

/**
 * Asks the game server to close a table as the signed-in user (it checks the host and refunds every stack).
 * The user's own session cookie is forwarded, so the game server authenticates them exactly like a socket.
 */
export async function closeTableOnGameServer(tableId: string): Promise<GameServerResult> {
  const cookie = headers().get("cookie") ?? "";
  let response: Response;

  try {
    response = await fetch(`${getGameServerUrl()}/tables/${encodeURIComponent(tableId)}/close`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "ngrok-skip-browser-warning": "true" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, code: "UNREACHABLE", message: "The game server isn't reachable right now. Try again in a moment." };
  }

  if (response.ok) {
    return { ok: true };
  }

  const body = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  return {
    ok: false,
    code: typeof body?.error === "string" ? body.error : "FAILED",
    message: typeof body?.message === "string" ? body.message : "The table could not be closed. Try again.",
  };
}

/** Live public tables from the game server (seated counts of running tables), or null if it's unreachable. */
export async function fetchLiveTables(): Promise<LobbyTableSummary[] | null> {
  try {
    const response = await fetch(`${getGameServerUrl()}/tables`, {
      headers: { cookie: headers().get("cookie") ?? "", "ngrok-skip-browser-warning": "true" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { tables?: unknown };
    return Array.isArray(body.tables) ? (body.tables as LobbyTableSummary[]) : null;
  } catch {
    return null;
  }
}
