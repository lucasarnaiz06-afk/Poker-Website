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

export function getRealtimeSocketUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  return null;
}

export function getRealtimeSocketOptions(): RealtimeSocketOptions {
  return {
    autoConnect: false,
    withCredentials: true,
    extraHeaders: NGROK_SKIP_BROWSER_WARNING_HEADERS,
    transportOptions: {
      polling: {
        extraHeaders: NGROK_SKIP_BROWSER_WARNING_HEADERS,
      },
    },
  };
}
