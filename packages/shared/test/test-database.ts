/**
 * Test database URL: TEST_DATABASE_URL, or DATABASE_URL with the database renamed to poker_platform_test.
 * Refuses anything whose database name doesn't end in "_test" so tests can never truncate the dev DB.
 */
export function resolveTestDatabaseUrl(testUrl?: string, devUrl?: string): string {
  const base = testUrl?.trim() || devUrl?.trim() || "postgresql://postgres:postgres@localhost:5432/poker_platform?schema=public";
  const url = new URL(base);

  if (!testUrl?.trim()) {
    url.pathname = "/poker_platform_test";
  }

  if (!url.pathname.replace(/^\//, "").endsWith("_test")) {
    throw new Error(`Refusing to run tests against non-test database "${url.pathname}".`);
  }

  return url.toString();
}
