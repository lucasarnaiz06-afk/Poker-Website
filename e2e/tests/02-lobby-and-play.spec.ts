import { test, expect } from "../support/fixtures";
import { walletBalance } from "../support/db";
import {
  assertNoForeignHoleCards,
  createTable,
  expectConsistent,
  openTable,
  playHand,
  sit,
  waitForHandNumber,
} from "../support/table";
import { TableSpy } from "../support/spy";
import { navBalance } from "../support/users";

test("host creates a side-game table, others find it live in the lobby, spectate, sit and play hands", async ({ game }) => {
  const [host, p2, p3] = await game.newPlayers(3, "lp");
  const tableName = `E2E side games ${host!.username.slice(-6)}`;

  // Players 2 and 3 are already looking at the lobby when the table is created.
  for (const p of [p2!, p3!]) {
    await p.page.goto("/lobby");
    await expect(p.page.getByRole("heading", { name: /tables/i }).first()).toBeVisible();
  }

  const tableId = await createTable(host!.page, { name: tableName, bombPots: true, nitGame: true, bounty: true });
  game.hosted(host!, tableId);

  // The lobby list updates live (no reload) and shows the side-game features.
  for (const p of [p2!, p3!]) {
    const row = p.page.getByRole("row").filter({ hasText: tableName }).or(p.page.getByRole("listitem").filter({ hasText: tableName }));
    await expect(row.first()).toBeVisible({ timeout: 20_000 });
  }

  // Host opens the table and sits with a custom buy-in.
  const hostSpy = await openTable(host!, tableId);
  expect(hostSpy.latest()!.settings.bombPot.enabled).toBe(true);
  expect(hostSpy.latest()!.settings.nitGame.enabled).toBe(true);
  expect(hostSpy.latest()!.settings.bountyGame.enabled).toBe(true);
  const settings = hostSpy.latest()!.settings;
  const hostBuyIn = settings.maxBuyIn - 3 * settings.bigBlind;
  await sit(host!, hostSpy, 1, hostBuyIn);
  await expect.poll(() => hostSpy.latest()!.viewer.walletBalance).toBe(10_000 - hostBuyIn);
  expect(await walletBalance(host!.username)).toBe(10_000 - hostBuyIn);

  // Player 2 joins from the lobby row.
  const p2Spy = new TableSpy(p2!.page, p2!.username);
  await p2!.page.getByRole("button", { name: `Join ${tableName}` }).first().click();
  await p2!.page.waitForURL(new RegExp(`/lobby/${tableId}$`));
  await p2Spy.waitFor("p2 joined", (v) => v.tableId === tableId);
  await sit(p2!, p2Spy, 3, "Min");
  const p2Buy = 10_000 - (await walletBalance(p2!.username));
  expect(p2Buy).toBe(settings.minBuyIn);
  await expect.poll(() => p2Spy.latest()!.viewer.walletBalance).toBe(10_000 - p2Buy);

  // Player 3 joins and only watches the first hand.
  const p3Spy = new TableSpy(p3!.page, p3!.username);
  await p3!.page.getByRole("button", { name: `Join ${tableName}` }).first().click();
  await p3!.page.waitForURL(new RegExp(`/lobby/${tableId}$`));
  await p3Spy.waitFor("p3 joined", (v) => v.tableId === tableId);

  // Hand 1 deals automatically. The spectator sees two card backs per player and no faces.
  const h1 = await waitForHandNumber(hostSpy, 1);
  expect(h1.hand!.phase).toBe("PREFLOP");
  const spectatorView = await p3Spy.waitFor("spectator sees hand", (v) => (v.hand ? v : null));
  expect(spectatorView.viewer.seat).toBeNull();
  for (const seat of spectatorView.seats) {
    expect(seat.cardCount).toBe(2);
    expect(seat.holeCards).toBeNull();
  }
  // The host's own payload has their cards; the spectator's never does.
  const hostCards = hostSpy.latest()!.seats.find((s) => s.seat === 1)!.holeCards!;
  expect(hostCards).toHaveLength(2);
  const spectatorRaw = p3Spy.raw.join("\n");
  expect(spectatorRaw).not.toContain(JSON.stringify(hostCards));

  await playHand(
    [
      { player: host!, spy: hostSpy },
      { player: p2!, spy: p2Spy },
    ],
    ["raise:preset", "call", "raise:slider", "call:key", "check", "check:key", "check", "check"],
    "check",
    [p3Spy],
  );
  const r1 = hostSpy.latest()!;
  expect(r1.hand!.result!.winners.length).toBeGreaterThan(0);
  await expect(host!.page.getByRole("status").filter({ hasText: /wins?\b/ }).first()).toBeVisible();
  await expect(p3!.page.getByRole("status").filter({ hasText: /wins?\b/ }).first()).toBeVisible();
  assertNoForeignHoleCards(p3Spy);
  assertNoForeignHoleCards(p2Spy);
  assertNoForeignHoleCards(hostSpy);

  // Player 3 sits; the next hands include three players.
  const p3Sit = await sit(p3!, p3Spy, 5, "Max");
  expect(p3Sit.amount).toBe(settings.maxBuyIn);
  expect(await walletBalance(p3!.username)).toBe(10_000 - settings.maxBuyIn);

  const players = [
    { player: host!, spy: hostSpy },
    { player: p2!, spy: p2Spy },
    { player: p3!, spy: p3Spy },
  ];
  // Play until all three have been dealt in together (p3 may wait for the big blind).
  for (let i = 0; i < 4; i += 1) {
    const next = await waitForHandNumber(hostSpy, hostSpy.latest()!.hand!.handNumber + 1, 30_000);
    const dealt = next.seats.filter((s) => s.inHand).length;
    await playHand(players, dealt === 3 ? ["raise:key", "call", "fold:key", "check", "check", "check", "check", "check", "check"] : ["call", "check"], "check");
    if (dealt === 3) break;
  }
  await expectConsistent(players.map((p) => p.spy));
  expect(hostSpy.views().some((v) => v.hand && v.seats.filter((s) => s.inHand).length === 3)).toBe(true);
  for (const { spy } of players) assertNoForeignHoleCards(spy);

  // The next hand starts by itself.
  const last = hostSpy.latest()!.hand!.handNumber;
  await waitForHandNumber(hostSpy, last + 1, 30_000);

  // Stacks on the table + wallets account for every chip (hand boundary).
  await game.audit();
  await host!.page.goto("/lobby");
  expect(await navBalance(host!.page)).toBe(10_000 - hostBuyIn);
});
