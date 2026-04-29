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
  transpilePackages: ["@poker-platform/shared"],
};

export default nextConfig;
