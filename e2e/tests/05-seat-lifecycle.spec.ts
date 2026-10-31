import { test, expect } from "../support/fixtures";
import { chipAudit, walletBalance } from "../support/db";
import { TableSpy } from "../support/spy";
import {
  actionBar,
  createTable,
  expectConsistent,
  openTable,
  playHandWith,
  sit,
  waitForHandNumber,
  type Seated,
} from "../support/table";
import { newPlayerContext, signIn } from "../support/users";

test("stand mid-hand, disconnect/reconnect, chat + emotes, host closes the table", async ({ game, browser }) => {
  const [a, b, c] = await game.newPlayers(3, "sl");
  const tableId = await createTable(a!.page, { name: `E2E lifecycle ${a!.username.slice(-6)}` });
  game.hosted(a!, tableId);
  const seated: Seated[] = [];
  const buyIns = new Map<string, number>();
  for (const [i, p] of [a!, b!, c!].entries()) {
    const spy = await openTable(p, tableId);
    const { amount } = await sit(p, spy, i + 1);
    buyIns.set(p.username, amount);
    seated.push({ player: p, spy });
  }
  const [sa, sb, sc] = seated as [Seated, Seated, Seated];

  // ---- Chat and emotes ---------------------------------------------------------------------
  const text = `gl hf ${Date.now().toString(36)}`;
  await a!.page.getByRole("textbox", { name: "Chat message" }).fill(text);
  await a!.page.getByRole("textbox", { name: "Chat message" }).press("Enter");
  for (const p of [b!, c!]) await expect(p.page.getByRole("log").or(p.page.getByLabel("Chat messages")).first().getByText(text)).toBeVisible();
  await b!.page.getByRole("button", { name: "Emotes" }).click();
  const emote = b!.page.getByRole("listitem", { name: /^Send emote / }).first();
  const emoteId = ((await emote.getAttribute("aria-label")) ?? "").replace("Send emote ", "");
  await emote.click();
  await expect.poll(() => sa.spy.chats().some((m) => m.emoteId === emoteId)).toBe(true);
  await expect(a!.page.getByLabel("Chat messages").locator(`img[src="/emotes/${emoteId}.png"]`).first()).toBeAttached();
  expect(sc.spy.chats().some((m) => m.text === text)).toBe(true);

  // ---- Stand up mid-hand: folds now, chips back after the hand -------------------------------
  // Wait for a hand with everyone dealt in.
  for (let i = 0; i < 4; i += 1) {
    const v = await sa.spy.waitFor("hand running", (x) => (x.hand && !x.hand.result ? x : null), 60_000);
    if (v.seats.filter((s) => s.inHand).length === 3 && v.hand!.toActSeat !== 3) break;
    await playHandWith(seated, () => "check");
  }
  const live = await sa.spy.waitFor("3-handed hand", (x) => (x.hand && !x.hand.result && x.seats.filter((s) => s.inHand).length === 3 ? x : null));
  const handNumber = live.hand!.handNumber;
  const cWalletBefore = await walletBalance(c!.username);
  await c!.page.getByRole("button", { name: "Seat options" }).click();
  await c!.page.getByRole("menuitem", { name: "Stand up" }).click();
  const confirm = c!.page.getByRole("dialog", { name: "Stand up?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Stand up" }).click();
  const folded = await sa.spy.waitFor("C folded", (v) =>
    v.hand?.handNumber === handNumber && (v.hand.result || v.seats.find((s) => s.seat === 3)?.folded) ? v : null);
  const cStack = folded.seats.find((s) => s.seat === 3);
  // Wallet unchanged until the hand is over (stacks move only at hand boundaries).
  if (!folded.hand!.result) expect(await walletBalance(c!.username)).toBe(cWalletBefore);
  await playHandWith([sa, sb], () => "check");
  await sa.spy.waitFor("C left the table", (v) => (v.seats.every((s) => s.userId !== sc.spy.latest()!.viewer.userId) ? v : null));
  // The stack C had behind after folding goes back to the wallet (what C bet stays in the pot).
  await expect.poll(() => walletBalance(c!.username)).toBe(cWalletBefore + cStack!.stack);
  expect(cWalletBefore + cStack!.stack).toBeLessThanOrEqual(10_000);
  await sc.spy.waitFor("C spectating", (v) => (v.viewer.seat === null ? v : null));
  const summary = c!.page.getByRole("dialog", { name: "Session summary" });
  if (await summary.isVisible().catch(() => false)) await summary.getByRole("button", { name: "Close" }).click();
  await expect(actionBar(c!.page).getByRole("button", { name: "Take a seat" })).toBeVisible();

  // ---- Disconnect (context closed) and reconnect from a new browser ---------------------------
  await waitForHandNumber(sa.spy, handNumber + 1);
  const bSeat = sb.spy.latest()!.viewer.seat!;
  await b!.context.close();
  await sa.spy.waitFor("B shown disconnected", (v) => (v.seats.find((s) => s.seat === bSeat)?.connected === false ? v : null), 30_000);
  const bContext = await newPlayerContext(browser);
  const bPage = await bContext.newPage();
  b!.context = bContext;
  b!.page = bPage;
  await signIn(bPage, b!.username, `/lobby/${tableId}`);
  const bSpy = new TableSpy(bPage, b!.username);
  await bPage.reload();
  const resynced = await bSpy.waitFor("B resynced", (v) => (v.viewer.seat === bSeat ? v : null));
  expect(resynced.seats.find((s) => s.seat === bSeat)!.userId).toBe(resynced.viewer.userId);
  if (resynced.hand && !resynced.hand.result && resynced.seats.find((s) => s.seat === bSeat)!.inHand) {
    expect(resynced.seats.find((s) => s.seat === bSeat)!.holeCards).toHaveLength(2);
  }
  await sa.spy.waitFor("B connected again", (v) => (v.seats.find((s) => s.seat === bSeat)?.connected ? v : null));
  const sb2: Seated = { player: b!, spy: bSpy };
  // The game keeps going with the reconnected player.
  await playHandWith([sa, sb2], () => "check");
  await expectConsistent([sa.spy, bSpy]);

  // ---- Host closes the table: every stack goes back to its wallet ----------------------------
  await a!.page.getByRole("button", { name: "Seat options" }).click();
  await a!.page.getByRole("menuitem", { name: "Close table" }).click();
  const closeDialog = a!.page.getByRole("dialog", { name: "Close this table?" });
  await expect(closeDialog).toBeVisible();
  await closeDialog.getByRole("button", { name: "Close table" }).click();
  // The host lands back in the lobby.
  await a!.page.waitForURL(/\/lobby(\?.*)?$/, { timeout: 15_000 });
  await sa.spy.waitFor("table closed", (v) => (v.status === "CLOSED" || v.seats.length === 0 ? v : null), 15_000).catch(() => null);
  const audit = await chipAudit([a!.username, b!.username, c!.username]);
  expect(audit.onTables).toBe(0);
  expect(audit.wallets).toBe(audit.granted);
  // Closed tables leave the public lobby.
  await c!.page.goto("/lobby");
  await expect(c!.page.getByText(`E2E lifecycle ${a!.username.slice(-6)}`)).toHaveCount(0);
});
