import { prisma } from "../src/db/prisma";

/** Empties every application table in the test database. */
export async function resetDatabase() {
  if (!process.env.DATABASE_URL?.includes("_test")) {
    throw new Error("resetDatabase() only runs against a *_test database.");
  }

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length > 0) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map(({ tablename }) => `"public"."${tablename.replace(/"/g, "")}"`).join(", ")} CASCADE`,
    );
  }
}

let counter = 0;

export async function createTestUser(overrides: { chipBalance?: number; username?: string | null; email?: string } = {}) {
  counter += 1;
  const suffix = `${Date.now().toString(36)}${counter}`;

  return prisma.user.create({
    data: {
      email: overrides.email ?? `user${suffix}@example.com`,
      emailVerified: new Date(),
      username: overrides.username === undefined ? `u${suffix}`.slice(0, 20) : overrides.username,
      chipBalance: overrides.chipBalance ?? 0,
    },
  });
}

export { prisma };
