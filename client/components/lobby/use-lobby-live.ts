"use client";

import type { ClientToServerEvents, LobbyTableSummary, ServerToClientEvents } from "@poker-platform/shared/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { getRealtimeSocketOptions, getRealtimeSocketUrl } from "@/lib/realtime-socket";

export type LobbyLiveMode = "connecting" | "live" | "polling";

const POLL_INTERVAL_MS = 10_000;
const SUBSCRIBE_TIMEOUT_MS = 5_000;

/**
 * Keeps the table list fresh. Prefers the realtime "lobby:subscribe" feed; if the game server
 * doesn't support it (or is unreachable) it falls back to router.refresh() every 10 s while visible.
 */
export function useLobbyLive(initialTables: LobbyTableSummary[]) {
  const router = useRouter();
  const [tables, setTables] = useState(initialTables);
  const [mode, setMode] = useState<LobbyLiveMode>("connecting");

  // Server re-render (refresh or revalidate) always wins.
  useEffect(() => {
    setTables(initialTables);
  }, [initialTables]);

  useEffect(() => {
    let stopped = false;
    let polling = false;
    let pollTimer: number | undefined;
    const url = getRealtimeSocketUrl();
    const options = getRealtimeSocketOptions(Boolean(url));
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = url ? io(url, options) : io(options);

    function startPolling() {
      if (stopped || polling) {
        return;
      }

      polling = true;
      socket.removeAllListeners();
      socket.disconnect();
      setMode("polling");
      pollTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          router.refresh();
        }
      }, POLL_INTERVAL_MS);
    }

    const giveUpTimer = window.setTimeout(startPolling, SUBSCRIBE_TIMEOUT_MS + 2_000);

    socket.on("connect", () => {
      socket.timeout(SUBSCRIBE_TIMEOUT_MS).emit("lobby:subscribe", {}, (error, response) => {
        if (stopped || polling) {
          return;
        }

        if (error || !response.ok) {
          startPolling();

          return;
        }

        window.clearTimeout(giveUpTimer);
        setTables(response.data);
        setMode("live");
      });
    });
    socket.on("lobby:tables", (next) => {
      if (!stopped) {
        setTables(next);
      }
    });
    socket.on("connect_error", startPolling);
    socket.on("disconnect", (reason) => {
      // Server-initiated disconnects won't auto-reconnect; fall back to polling.
      if (reason === "io server disconnect") {
        startPolling();
      }
    });
    socket.connect();

    return () => {
      stopped = true;
      window.clearTimeout(giveUpTimer);
      window.clearInterval(pollTimer);

      if (socket.connected) {
        socket.emit("lobby:unsubscribe", {}, () => undefined);
      }

      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [router]);

  return { tables, mode };
}
