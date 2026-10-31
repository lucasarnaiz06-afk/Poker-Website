import type { ManagerOptions, SocketOptions } from "socket.io-client";

const NGROK_SKIP_BROWSER_WARNING_HEADERS = {
  "ngrok-skip-browser-warning": "true",
};

type RealtimeSocketOptions = Partial<ManagerOptions & SocketOptions> & {
  extraHeaders: Record<string, string>;
  transportOptions: {
    polling: {
      extraHeaders: Record<string, string>;
    };
  };
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Where the browser opens its socket.io connection.
 *
 * - NEXT_PUBLIC_SOCKET_URL set: connect straight to the game server (WebSocket upgrades work; the Next
 *   `/socket.io` rewrite only proxies HTTP, so through it clients stay on long-polling). The game server must
 *   accept this page's Origin (CLIENT_ORIGINS) and the session cookie must reach it (same site, e.g.
 *   localhost:3000 -> localhost:4000, or app.example.com -> app.example.com behind a reverse proxy).
 * - Not set, or set to a loopback address while the page itself is served from another host (a phone on the
 *   LAN, an ngrok tunnel): same origin through the `/socket.io` rewrite / reverse proxy.
 */
export function getRealtimeSocketUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();

  if (!configuredUrl) {
    return null;
  }

  if (typeof window !== "undefined") {
    try {
      const target = new URL(configuredUrl);

      if (LOOPBACK_HOSTS.has(target.hostname) && !LOOPBACK_HOSTS.has(window.location.hostname)) {
        return null;
      }
    } catch {
      return null;
    }
  }

  return configuredUrl;
}

/** `direct`: connecting to NEXT_PUBLIC_SOCKET_URL (see getRealtimeSocketUrl) rather than the same-origin rewrite. */
export function getRealtimeSocketOptions(direct = false): RealtimeSocketOptions {
  // The ngrok header only matters for same-origin requests through a tunnel; on direct connections it would
  // just force a CORS preflight before every long-polling request.
  const headers = direct ? {} : NGROK_SKIP_BROWSER_WARNING_HEADERS;

  return {
    autoConnect: false,
    // Sends the session cookie on cross-origin (direct) connections; same-origin ones send it anyway.
    withCredentials: true,
    // Through the rewrite, request "/socket.io?..." rather than "/socket.io/?...": Next answers the
    // trailing-slash form with a 308 redirect before applying the rewrite, which doubled every long-polling
    // round trip. The game server itself only matches "/socket.io/".
    addTrailingSlash: direct,
    extraHeaders: headers,
    transportOptions: {
      polling: {
        extraHeaders: headers,
      },
    },
  };
}
