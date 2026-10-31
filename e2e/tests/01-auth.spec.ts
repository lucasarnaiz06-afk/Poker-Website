import { test, expect } from "../support/fixtures";
import { walletBalance } from "../support/db";
import { chipPill, navBalance, signIn } from "../support/users";

test("register, see 10,000 chips, sign out and back in, claim the daily bonus", async ({ game }) => {
  const player = await game.newPlayer("auth");
  const { page } = player;

  // Registration (UI) -> verification link from the dev outbox -> signed in, 10,000 chips in the nav.
  await expect(chipPill(page)).toBeVisible();
  expect(await navBalance(page)).toBe(10_000);
  await expect(chipPill(page)).toHaveText(/10K|10,000/);
  expect(await walletBalance(player.username)).toBe(10_000);

  // Sign out through the account menu.
  await page.getByRole("button", { name: /^Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(chipPill(page)).toHaveCount(0);
  await page.goto("/lobby");
  await expect(page).toHaveURL(/\/auth\/signin/);

  // Sign in with the username and password.
  await signIn(page, player.username, "/lobby");
  await expect(page).toHaveURL(/\/lobby/);
  expect(await navBalance(page)).toBe(10_000);

  // Daily bonus: the nav pill says it's ready and claims it in one click; the pill and the DB move together.
  await page.getByRole("button", { name: /^Chip balance: .*Daily bonus ready/ }).click();
  await page.getByRole("button", { name: /^Claim [\d,]+ chips$/ }).click();
  await expect(page.getByText(/^\+[\d,]+ chips\. Day 1 streak\./).first()).toBeVisible();
  const after = await walletBalance(player.username);
  expect(after).toBeGreaterThan(10_000);
  await expect.poll(() => navBalance(page)).toBe(after);
  await expect(page.getByRole("link", { name: /^Chip balance:.*Open wallet/ })).toBeVisible();

  // The wallet shows when the next one is due instead of a Claim button.
  await page.goto("/account/wallet");
  await expect(page.getByText(/^Next bonus in /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim", exact: true })).toHaveCount(0);

  // A second claim is refused server-side as well (idempotent per UTC day).
  await page.reload();
  await expect(page.getByText(/^Next bonus in /)).toBeVisible();
  expect(await walletBalance(player.username)).toBe(after);
});
