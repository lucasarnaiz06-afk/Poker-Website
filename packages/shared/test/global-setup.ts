import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { resolveTestDatabaseUrl } from "./test-database";

/** Creates/migrates the test database once per run (prisma migrate deploy creates it if missing). */
export default function setup() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const rootEnv = loadEnv("test", repoRoot, "");
  const databaseUrl = resolveTestDatabaseUrl(
    rootEnv.TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL,
    rootEnv.DATABASE_URL ?? process.env.DATABASE_URL,
  );

  execSync("npx prisma migrate deploy --schema server/prisma/schema.prisma", {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: ["ignore", "ignore", "inherit"],
  });
}
