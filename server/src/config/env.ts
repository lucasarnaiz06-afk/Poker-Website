import "./load-env";

function readPort(rawPort?: string) {
  const parsedPort = Number(rawPort);

  if (Number.isInteger(parsedPort) && parsedPort > 0) {
    return parsedPort;
  }

  return 4000;
}

function readOrigins(rawOrigins?: string) {
  return (rawOrigins ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Number of reverse-proxy hops whose X-Forwarded-For entries Express may trust (0 = ignore XFF). */
function readTrustProxyHops(raw?: string) {
  const parsed = Number.parseInt(raw?.trim() ?? "", 10);

  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 10) : 0;
}

function readOptionalString(value?: string) {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : null;
}

const clientOrigins = readOrigins(
  process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN,
);
const defaultClientOrigin = "http://localhost:3000";

export const env = {
  port: readPort(process.env.PORT),
  /** Interface to bind. Loopback by default: browsers reach the server through the Next /socket.io rewrite. */
  host: readOptionalString(process.env.HOST) ?? "127.0.0.1",
  trustProxyHops: readTrustProxyHops(process.env.TRUST_PROXY_HOPS),
  clientOrigin: clientOrigins[0] ?? defaultClientOrigin,
  clientOrigins: clientOrigins.length > 0 ? clientOrigins : [defaultClientOrigin],
  commandCenterPassword: readOptionalString(process.env.COMMAND_CENTER_PASSWORD),
  nodeEnv: process.env.NODE_ENV ?? "development",
};
