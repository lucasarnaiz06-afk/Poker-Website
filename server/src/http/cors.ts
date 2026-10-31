import type { CorsOptions } from "cors";
import { env } from "../config/env";

function isPrivateNetworkHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function isDevelopmentClientOrigin(origin: string) {
  if (env.nodeEnv === "production") {
    return false;
  }

  try {
    const url = new URL(origin);

    return (
      url.protocol === "http:" &&
      Number(url.port) >= 3000 &&
      Number(url.port) < 4000 &&
      isPrivateNetworkHost(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isCorsOriginAllowed(origin?: string) {
  if (!origin) {
    return true;
  }

  return env.clientOrigins.includes(origin) || isDevelopmentClientOrigin(origin);
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    callback(null, isCorsOriginAllowed(origin));
  },
  credentials: true,
};

/** Socket handshakes: browsers always send Origin; only non-browser dev tools may omit it. */
export function isSocketOriginAllowed(origin?: string) {
  if (!origin) {
    return env.nodeEnv !== "production";
  }

  return isCorsOriginAllowed(origin);
}
