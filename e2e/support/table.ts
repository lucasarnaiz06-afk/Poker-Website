// Table-level helpers: create a game through the lobby dialog, open/sit/act through the table UI.
import { expect, type Page } from "@playwright/test";
import type { TableView } from "@poker-platform/shared/types";
import { summarize, TableSpy } from "./spy";
import type { Player } from "./users";

export type CreateOptions = {
  name: string;
  bombPots?: boolean;
  nitGame?: boolean;
  bounty?: boolean;
  /** Seconds per decision; "min" drags the slider to its minimum (10 s). */
  fastClock?: boolean;
  noTimeBank?: boolean;
  /** Vote rule for every side game ("Majority" / "Unanimous"). */
  voteRule?: "Majority" | "Unanimous";
};

async function setSwitch(page: Page, label: string, on: boolean) {
  const sw = page.getByRole("switch", { name: label, exact: true });
  const checked = (await sw.getAttribute("aria-checked")) === "true";
  if (checked !== on) await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", on ? "true" : "false");
}

/** Host creates a public table from /lobby via the "Create game" dialog. Returns the table id. */
export async function createTable(page: Page, options: CreateOptions): Promise<string> {
  await page.goto("/lobby");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.getByRole("button", { name: "Create game" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create a game" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Table name").fill(options.name);
  // Side games, timing and the rest live under the collapsed "More options".
  const more = dialog.getByRole("button", { name: /^More options/ });
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await setSwitch(page, "Bomb pots", options.bombPots ?? false);
  await setSwitch(page, "Nit game", options.nitGame ?? false);
  await setSwitch(page, "7-2 bounty", options.bounty ?? false);
  if (options.voteRule) {
    for (const group of await dialog.getByRole("radiogroup", { name: "Vote rule" }).all()) {
      await group.getByRole("radio", { name: options.voteRule }).click();
    }
  }
  if (options.fastClock) {
    const slider = dialog.getByRole("slider", { name: "Time to act" });
    await slider.focus();
    await slider.press("Home");
    await expect(slider).toHaveAttribute("aria-valuenow", "10");
  }
  if (options.noTimeBank) {
    const slider = dialog.getByRole("slider", { name: "Time bank" });
    await slider.focus();
    await slider.press("Home");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
  }
  await dialog.getByRole("radio", { name: "Public" }).click();
  await dialog.getByRole("button", { name: "Create game" }).click();
  await page.waitForURL(/\/lobby\/[^/?]+$/, { timeout: 30_000 });
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Opens the table page with a socket spy attached before navigation. */
export async function openTable(player: Player, tableId: string): Promise<TableSpy> {
  const spy = new TableSpy(player.page, player.username);
  await player.page.goto(`/lobby/${tableId}`);
  await spy.waitFor("joined table", (v) => v.tableId === tableId);
  await expect(player.page.getByRole("main", { name: "Table" })).toBeVisible();
  return spy;
}

/** Sits through the buy-in dialog: a typed amount, a preset button ("Min" / "Max"), or the default. */
export async function sit(player: Player, spy: TableSpy, seat: number, buyIn?: number | "Min" | "Max") {
  const page = player.page;
  await page.getByRole("button", { name: `Sit in seat ${seat}` }).click();
  const dialog = page.getByRole("dialog", { name: `Sit in seat ${seat}` });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("spinbutton");
  if (typeof buyIn === "number") {
    await input.fill(String(buyIn));
    await input.press("Tab");
    await expect(input).toHaveValue(String(buyIn));
  } else if (buyIn) {
    await dialog.getByRole("button", { name: buyIn, exact: true }).click();
  }
  // The amount field and the confirm button must agree before we commit.
  const button = dialog.getByRole("button", { name: /^Sit down with/ });
  await expect
    .poll(async () => {
      const shown = Number((await button.innerText()).replace(/[^\d]/g, ""));
      return shown === Number(await input.inputValue()) ? shown : -1;
    })
    .toBeGreaterThan(0);
  const amount = Number(await input.inputValue());
  await dialog.getByRole("button", { name: /^Sit down with/ }).click();
  await expect(dialog).toBeHidden();
  const view = await spy.waitFor(`${player.username} seated`, (v) =>
    v.viewer.seat === seat && v.seats.some((s) => s.userId === v.viewer.userId) ? v : null,
  );
  return { view, amount };
}

export function mySeat(view: TableView) {
  return view.seats.find((s) => s.userId === view.viewer.userId) ?? null;
}

export function actionBar(page: Page) {
  return page.getByRole("region", { name: "Your actions" });
}

/** Waits until it's this player's turn (per the server payload) and returns the view. */
export function waitForTurn(spy: TableSpy, timeout = 30_000) {
  return spy.waitFor(`${spy.label}'s turn`, (v) => (v.viewer.legalActions && v.hand && !v.hand.result ? v : null), timeout);
}

export async function waitForHandNumber(spy: TableSpy, atLeast: number, timeout = 45_000) {
  return spy.waitFor(`hand #${atLeast}`, (v) => (v.hand && v.hand.handNumber >= atLeast ? v : null), timeout);
}

export async function waitForHandEnd(spy: TableSpy, handNumber: number, timeout = 60_000) {
  return spy.waitFor(`hand #${handNumber} result`, (v) => (v.hand && v.hand.handNumber === handNumber && v.hand.result ? v : (v.hand && v.hand.handNumber > handNumber ? v : null)), timeout);
}

// ---- Acting through the action bar -----------------------------------------------------------

export type Intent =
  | "fold"
  | "fold:key"
  | "check"
  | "check:key"
  | "call"
  | "call:key"
  | "raise:preset"
  | "raise:slider"
  | "raise:key"
  | "allin";

/**
 * Performs one decision for `player` through the UI. Falls back sensibly when the intent isn't legal
 * (check -> call, raise -> call). Returns the server view in which the action was applied.
 */
export async function act(player: Player, spy: TableSpy, intent: Intent) {
  const view = await waitForTurn(spy);
  const legal = view.viewer.legalActions!;
  const page = player.page;
  const bar = actionBar(page);
  const handId = view.hand!.handId;
  const me = view.viewer.seat!;
  let expectedTo: number | null = null;

  let effective: Intent = intent;
  if ((intent.startsWith("check") || intent.startsWith("call")) && !legal.canCheck && legal.callAmount === 0) effective = "call";
  if (intent.startsWith("check") && !legal.canCheck) effective = intent.endsWith(":key") ? "call:key" : "call";
  if (intent.startsWith("call") && legal.canCheck) effective = intent.endsWith(":key") ? "check:key" : "check";
  if ((intent.startsWith("raise") || intent === "allin") && !legal.canBetOrRaise) effective = "call";

  switch (effective) {
    case "fold":
      await bar.locator('button[aria-keyshortcuts="F"]').click();
      break;
    case "fold:key":
      await page.locator("body").press("f");
      break;
    case "check":
      await expect(bar.locator('button[aria-keyshortcuts="C"]')).toHaveText(/^Check/);
      await bar.locator('button[aria-keyshortcuts="C"]').click();
      break;
    case "check:key":
    case "call:key":
      await page.locator("body").press("c");
      break;
    case "call":
      await expect(bar.locator('button[aria-keyshortcuts="C"]')).toHaveText(/^(Call|All-in)/);
      await bar.locator('button[aria-keyshortcuts="C"]').click();
      break;
    case "raise:preset": {
      const presets = bar.getByRole("group", { name: "Bet size presets" });
      await expect(presets.getByRole("button").first()).toBeVisible();
      // A pot-sized raise (keeps stacks deep enough for the rest of the script).
      await presets.getByRole("button", { name: "Pot", exact: true }).click();
      expectedTo = await readRaiseButtonAmount(page);
      await bar.locator('button[aria-keyshortcuts="R"]').click();
      break;
    }
    case "raise:slider": {
      const slider = bar.getByRole("slider");
      await slider.focus();
      await slider.press("Home");
      for (let i = 0; i < 3; i += 1) await slider.press("ArrowRight");
      expectedTo = await readRaiseButtonAmount(page);
      await bar.locator('button[aria-keyshortcuts="R"]').click();
      break;
    }
    case "raise:key": {
      const target = Math.min(legal.maxTo, legal.minTo + view.settings.bigBlind);
      await page.locator("body").press("r");
      const input = bar.getByRole("textbox", { name: /Bet amount in chips|Raise to, in chips/ });
      await expect(input).toBeFocused();
      await input.fill(String(target));
      await input.press("Enter");
      expectedTo = target;
      break;
    }
    case "allin": {
      const slider = bar.getByRole("slider");
      await slider.focus();
      await slider.press("End");
      expectedTo = legal.maxTo;
      await expect(bar.locator('button[aria-keyshortcuts="R"]')).toHaveText(/^All-in/);
      await bar.locator('button[aria-keyshortcuts="R"]').click();
      break;
    }
  }

  // Fold when checking is free asks for confirmation.
  if (effective.startsWith("fold")) {
    const confirm = page.getByRole("alertdialog", { name: "Confirm fold" });
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /^Fold anyway/ }).click();
  }

  const applied = await spy.waitFor(`${player.username} ${effective} applied`, (v) => {
    if (!v.hand || v.hand.handId !== handId) return v; // hand moved on
    if (v.version <= view.version) return null;
    if (v.hand.result || v.hand.phase !== view.hand!.phase || v.hand.toActSeat !== me) return v;
    return null;
  });
  if (expectedTo !== null && applied.hand?.handId === handId) {
    const seat = applied.seats.find((s) => s.seat === me)!;
    // The bet on the street (or an all-in) must match what the button said.
    if (applied.hand.phase === view.hand!.phase) {
      expect(seat.bet === expectedTo || seat.allIn, `${effective}: bet ${seat.bet} vs button ${expectedTo}`).toBe(true);
    }
  }
  return { before: view, after: applied, effective };
}

async function readRaiseButtonAmount(page: Page): Promise<number> {
  const button = actionBar(page).locator('button[aria-keyshortcuts="R"]');
  const text = (await button.innerText()).replace(/\s+/g, " ");
  const match = text.match(/([\d,]+)/);
  if (!match) throw new Error(`No amount on raise button: ${text}`);
  return Number(match[1]!.replace(/,/g, ""));
}

/** Plays one hand: whoever is to act performs the next intent (or `fallback`). Returns the result view. */
export async function playHand(
  seated: Array<{ player: Player; spy: TableSpy }>,
  intents: Intent[],
  fallback: Intent = "check",
  observers: TableSpy[] = [],
) {
  const first = seated[0]!.spy;
  const start = await first.waitFor("hand in progress", (v) => (v.hand && !v.hand.result ? v : null), 60_000);
  const handNumber = start.hand!.handNumber;
  const queue = [...intents];
  for (let guard = 0; guard < 60; guard += 1) {
    const now = await first.waitFor("next decision or hand end", (v) => {
      if (!v.hand || v.hand.handNumber !== handNumber) return v;
      if (v.hand.result) return v;
      if (v.hand.toActSeat !== null) return v;
      return null;
    }, 60_000);
    if (!now.hand || now.hand.handNumber !== handNumber || now.hand.result) break;
    const actor = seated.find((s) => s.player.username === now.seats.find((x) => x.seat === now.hand!.toActSeat)?.username);
    if (!actor) throw new Error(`Seat ${now.hand.toActSeat} is not one of our players`);
    await act(actor.player, actor.spy, queue.shift() ?? fallback);
    await expectConsistent([...seated.map((s) => s.spy), ...observers]);
  }
  return first.waitFor(`hand #${handNumber} complete`, (v) =>
    v.hand && v.hand.handNumber === handNumber && v.hand.result ? v : null, 60_000);
}

/** All spies converge on the same public state (stacks, bets, pots, board, turn). */
export async function expectConsistent(spies: TableSpy[]) {
  await expect
    .poll(
      () => {
        const views = spies.map((s) => s.latest());
        if (views.some((v) => !v)) return "missing view";
        const keys = views.map((v) => JSON.stringify(publicState(v!)));
        return keys.every((k) => k === keys[0]) ? "same" : keys.join("\n");
      },
      { timeout: 10_000, message: "all players see the same table state" },
    )
    .toBe("same");
}

function publicState(v: TableView) {
  return {
    version: v.version,
    seats: v.seats.map((s) => [s.seat, s.userId, s.stack, s.bet, s.folded, s.allIn, s.status, s.inHand, s.isNit]),
    hand: v.hand && {
      id: v.hand.handId,
      phase: v.hand.phase,
      boards: v.hand.boards,
      pots: v.hand.pots,
      totalPot: v.hand.totalPot,
      toAct: v.hand.toActSeat,
      currentBet: v.hand.currentBet,
      result: v.hand.result && { winners: v.hand.result.winners, side: v.hand.result.sidePayments },
    },
    side: v.sideGames,
  };
}

/** Hidden information: a viewer never receives another seat's hole cards unless they were shown. */
export function assertNoForeignHoleCards(spy: TableSpy) {
  for (const view of spy.views()) {
    for (const seat of view.seats) {
      if (seat.userId === view.viewer.userId || !seat.holeCards) continue;
      const shown = view.hand?.result?.shown.some((s) => s.seat === seat.seat) ?? false;
      // All-in with no betting left: live hands are turned face up for the runout (standard rule).
      const live = view.seats.filter((s) => s.inHand && !s.folded);
      const runout =
        view.hand !== null && !view.hand.result && view.hand.toActSeat === null && !seat.folded &&
        live.some((s) => s.allIn) && live.filter((s) => !s.allIn).length <= 1;
      expect(
        shown || runout,
        `${spy.label} received hole cards of seat ${seat.seat} in hand #${view.hand?.handNumber} (${view.hand?.phase}) ${summarize(view)}`,
      ).toBe(true);
    }
  }
}

export type Seated = { player: Player; spy: TableSpy };

/** Plays the current hand with a per-decision strategy. Returns the completed hand's view. */
export async function playHandWith(
  seated: Seated[],
  choose: (actor: Seated, view: TableView) => Intent,
  observers: TableSpy[] = [],
) {
  const first = seated[0]!.spy;
  const start = await first.waitFor("hand in progress", (v) => (v.hand && !v.hand.result ? v : null), 60_000);
  const handNumber = start.hand!.handNumber;
  for (let guard = 0; guard < 60; guard += 1) {
    const now = await first.waitFor("next decision or hand end", (v) => {
      if (!v.hand || v.hand.handNumber !== handNumber || v.hand.result || v.hand.toActSeat !== null) return v;
      return null;
    }, 60_000);
    if (!now.hand || now.hand.handNumber !== handNumber || now.hand.result) break;
    const username = now.seats.find((x) => x.seat === now.hand!.toActSeat)?.username;
    const actor = seated.find((s) => s.player.username === username);
    if (!actor) throw new Error(`Seat ${now.hand.toActSeat} is not one of our players`);
    await act(actor.player, actor.spy, choose(actor, now));
    await expectConsistent([...seated.map((s) => s.spy), ...observers]);
  }
  return first.waitFor(`hand #${handNumber} complete`, (v) =>
    v.hand && v.hand.handNumber === handNumber && v.hand.result ? v : null, 60_000);
}

/** Strategy: everyone but `winner` folds; the winner checks/calls. */
export const letWin = (winner: Player) => (actor: Seated) => (actor.player === winner ? "check" : "fold") as Intent;

/** Opens the "Table games" menu and proposes one of its options. */
export async function propose(player: Player, label: RegExp | string) {
  const page = player.page;
  await page.getByRole("button", { name: "Table games" }).click();
  await page.getByRole("menuitem", { name: label }).click();
}

/** Votes on the open vote card of the given kind ("Bomb pot", "Nit game", "7-2 bounty"). */
export async function vote(player: Player, kindLabel: string, yes = true) {
  const card = player.page.getByRole("region", { name: `${kindLabel} vote` }).or(player.page.locator(`section[aria-label="${kindLabel} vote"]`)).first();
  await card.getByRole("button", { name: yes ? "Yes" : "No", exact: true }).click();
}

/** Sum of every seat's chips on the table (stack + current bet + pots). Constant while no one buys/cashes. */
export function tableChips(view: TableView) {
  const seats = view.seats.reduce((sum, s) => sum + s.stack + s.bet, 0);
  const pots = view.hand && !view.hand.result ? view.hand.pots.reduce((sum, p) => sum + p.amount, 0) : 0;
  return seats + pots;
}
