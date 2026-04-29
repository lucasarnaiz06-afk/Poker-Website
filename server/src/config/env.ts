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

const clientOrigins = readOrigins(
  process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN,
);
const defaultClientOrigin = "http://localhost:3000";

export const env = {
  port: readPort(process.env.PORT),
  clientOrigin: clientOrigins[0] ?? defaultClientOrigin,
  clientOrigins: clientOrigins.length > 0 ? clientOrigins : [defaultClientOrigin],
  nodeEnv: process.env.NODE_ENV ?? "development",
};
