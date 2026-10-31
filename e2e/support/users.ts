// Creates real users through the UI: register -> verification email (dev outbox) -> verify -> signed in.
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const OUTBOX = process.env.MAIL_OUTBOX_FILE?.trim() || join(tmpdir(), "poker-platform-mail-outbox.jsonl");
export const PASSWORD = "felt-and-chips-e2e-42";

export type Player = {
  username: string;
  email: string;
  context: BrowserContext;
  page: Page;
};

export function uniqueName(prefix = "e2e") {
  return `${prefix}_${Date.now().toString(36).slice(-5)}${randomBytes(3).toString("hex")}`.slice(0, 20);
}

/** A random documentation-range IP per player so per-IP auth rate limits don't trip across the suite. */
function fakeIp() {
  return `198.18.${randomInt(0, 255)}.${randomInt(1, 254)}`;
}

const APP_ORIGIN = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;

export async function newPlayerContext(browser: Browser) {
  const context = await browser.newContext();
  // Only on requests to the app: a custom header on the browser's direct (cross-origin) socket.io requests to
  // the game server would turn them into CORS preflights the server rightly refuses.
  const ip = fakeIp();
  await context.route(
    (url) => url.origin === APP_ORIGIN,
    (route) => route.continue({ headers: { ...route.request().headers(), "x-real-ip": ip } }),
  );
  return context;
}

type OutboxMail = { to: string; subject: string; text: string; sentAt: string };

export async function waitForMail(to: string, subject: RegExp, after = 0): Promise<OutboxMail> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (existsSync(OUTBOX)) {
      const mails = readFileSync(OUTBOX, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as OutboxMail)
        .filter((m) => m.to === to && subject.test(m.subject) && Date.parse(m.sentAt) >= after);
      const last = mails.at(-1);
      if (last) return last;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No "${subject}" mail for ${to} in ${OUTBOX} (is the client running in console mail mode?)`);
}

export function linkFrom(mail: OutboxMail) {
  const match = mail.text.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`No link in mail: ${mail.text}`);
  // Mails link to NEXTAUTH_URL; keep only path+query so tests follow them on the configured baseURL.
  const url = new URL(match[0]);
  return `${url.pathname}${url.search}`;
}

/**
 * The dev server hot-reloads while other people edit code, which can wipe a half-filled form. Retries a
 * fill+submit step until the page leaves `from` (or the attempts run out).
 */
export async function submitUntilNavigated(page: Page, from: RegExp, step: () => Promise<void>, attempts = 4) {
  for (let i = 1; ; i += 1) {
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await step();
    try {
      await page.waitForURL((url) => !from.test(url.pathname + url.search), { timeout: 15_000 });
      return;
    } catch (error) {
      if (i >= attempts) throw error;
      if (!from.test(new URL(page.url()).pathname)) return;
    }
  }
}

export async function registerPlayer(browser: Browser, prefix = "e2e"): Promise<Player> {
  const username = uniqueName(prefix);
  const email = `${username}@e2e.example.com`;
  const context = await newPlayerContext(browser);
  const page = await context.newPage();
  const started = Date.now() - 1000;

  await page.goto("/auth/register");
  await submitUntilNavigated(page, /^\/auth\/register/, async () => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
  });
  await expect(page).toHaveURL(/\/auth\/check-email/);

  const mail = await waitForMail(email, /verify/i, started);
  await page.goto(linkFrom(mail));
  await submitUntilNavigated(page, /^\/auth\/verify/, async () => {
    await page.getByRole("button", { name: /verify and continue/i }).click();
  });
  if (page.url().includes("/onboarding")) {
    await completeOnboarding(page, username);
  }
  return { username, email, context, page };
}

export async function completeOnboarding(page: Page, username: string) {
  await page.getByLabel("Username").fill(username);
  await expect(page.getByText(`@${username.toLowerCase()} is available.`)).toBeVisible();
  await page.getByRole("button", { name: /continue|save|start/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/onboarding"));
}

export async function signIn(page: Page, identifier: string, callbackUrl = "/lobby") {
  await page.goto(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await submitUntilNavigated(page, /^\/auth\/signin/, async () => {
    await page.getByLabel("Email or username").fill(identifier);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  });
}

/**
 * Nav pill: a link "Chip balance: 10,000 chips. Open wallet", or a button "Chip balance: 10,000 chips. Daily bonus
 * ready" (opens the claim popover) while today's daily bonus is unclaimed.
 */
export function chipPill(page: Page) {
  return page.getByRole("link", { name: /^Chip balance:/ }).or(page.getByRole("button", { name: /^Chip balance:/ }));
}

export async function navBalance(page: Page): Promise<number> {
  const label = (await chipPill(page).first().getAttribute("aria-label")) ?? "";
  const match = label.match(/Chip balance: ([\d,]+) chips/);
  if (!match) throw new Error(`Unexpected chip pill label: ${label}`);
  return Number(match[1]!.replace(/,/g, ""));
}
