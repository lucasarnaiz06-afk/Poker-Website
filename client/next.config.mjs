import nextEnv from "@next/env";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(clientDir, "..");
const { loadEnvConfig } = nextEnv;

loadEnvConfig(workspaceRoot);

/** @type {import("next").NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS:
      process.env.ALLOWED_EMAIL_DOMAINS ??
      process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS ??
      "university.edu",
  },
  async rewrites() {
    const socketUrl =
      process.env.SOCKET_SERVER_URL?.trim() ||
      process.env.NEXT_PUBLIC_SOCKET_URL?.trim() ||
      "http://localhost:4000";

    return [
      {
        source: "/socket.io",
        destination: `${socketUrl}/socket.io/`,
      },
      {
        source: "/socket.io/:path*",
        destination: `${socketUrl}/socket.io/:path*`,
      },
    ];
  },
  transpilePackages: ["@poker-platform/shared"],
};

export default nextConfig;
