import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { resolveTestDatabaseUrl } from "./test/test-database.ts";

const rootEnv = loadEnv("test", resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "");

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // Tests share one database and truncate tables between files.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: resolveTestDatabaseUrl(rootEnv.TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL, rootEnv.DATABASE_URL ?? process.env.DATABASE_URL),
      // Fixed test-only key; never used outside the test database.
      AUTH_ENCRYPTION_KEY: "dGVzdC1vbmx5LWtleS0wMDAwMDAwMDAwMDAwMDAwMDA=",
      EMAIL_TRANSPORT: "console",
      NEXTAUTH_URL: "http://localhost:3000",
      ALLOWED_EMAIL_DOMAINS: "",
    },
  },
});
