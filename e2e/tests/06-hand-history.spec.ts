import { test, expect } from "../support/fixtures";
import type { PublicCard, TableView } from "@poker-platform/shared/types";
import { createTable, letWin, openTable, playHandWith, sit, waitForHandNumber, type Seated } from "../support/table";
import type { TableSpy } from "../support/spy";

/** Undo the string escaping of RSC payloads embedded in HTML (self.__next_f.push(["...\\"Kd\\"..."])). */
function normalize(body: string) {
  return body.replace(/\\+"/g, '"');
}

/** Every textual form a card could take in a payload: "Kd", {"rank":"K","suit":"d"}. */
function cardForms(card: PublicCard) {
  return [`"${card.rank}${card.suit}"`, `"rank":"${card.rank}","suit":"${card.suit}"`];
}

function startStack(spy: TableSpy, handId: string, seat: number) {
  const first = spy.views().find((v) => v.hand?.handId === handId)!;
  const s = first.seats.find((x) => x.seat === seat)!;
  return s.stack + s.bet;
}

function holeCardsOf(spy: TableSpy, handId: string): PublicCard[] {
  const v = spy.views().find((x) => x.hand?.handId === handId && x.seats.some((s) => s.userId === x.viewer.userId && s.holeCards));
  return v!.seats.find((s) => s.userId === v!.viewer.userId)!.holeCards!;
}

test("hand history lists played hands with the right net, replays them, and never leaks unshown hole cards", async ({ game }) => {
  const [a, b] = await game.newPlayers(2, "hh");
  const tableName = `E2E history ${a!.username.slice(-6)}`;
  const tableId = await createTable(a!.page, { name: tableName });
  game.hosted(a!, tableId);
  const sa: Seated = { player: a!, spy: await openTable(a!, tableId) };
  await sit(a!, sa.spy, 1);
  const sb: Seated = { player: b!, spy: await openTable(b!, tableId) };
  await sit(b!, sb.spy, 2);
  await waitForHandNumber(sa.spy, 1);

  // Hand X: B folds to A, nobody shows. Hand Y: checked down to showdown.
  const x = await playHandWith([sa, sb], letWin(a!));
  await waitForHandNumber(sa.spy, x.hand!.handNumber + 1);
  const y = await playHandWith([sa, sb], () => "check");
  await waitForHandNumber(sa.spy, y.hand!.handNumber + 1);

  const hands: Array<{ view: TableView; net: number; bCards: PublicCard[]; bShown: boolean }> = [];
  for (const h of [x, y]) {
    const handId = h.hand!.handId;
    const end = h.seats.find((s) => s.seat === 1)!.stack;
    hands.push({
      view: h,
      net: end - startStack(sa.spy, handId, 1),
      bCards: holeCardsOf(sb.spy, handId),
      bShown: h.hand!.result!.shown.some((s) => s.seat === 2),
    });
  }
  expect(hands[0]!.bShown, "B folded: nothing shown").toBe(false);

  // /hands lists both with the right net (A's point of view).
  await a!.page.goto("/hands");
  for (const h of hands) {
    // Desktop table row (the phone list renders the same rows, hidden at this width).
    const row = a!.page
      .getByRole("row")
      .filter({ has: a!.page.locator(`a[href="/hands/${h.view.hand!.handId}"]`) })
      .first();
    await expect(row).toContainText(`#${h.view.hand!.handNumber}`);
    await expect(row).toBeVisible();
    const sign = h.net > 0 ? "\\+" : h.net < 0 ? "−" : "";
    await expect(row).toContainText(new RegExp(`${sign}${Math.abs(h.net).toLocaleString("en-US")}(?!\\d)`));
  }

  // /hands/[id] replays the hand; B's cards appear in A's payloads only when B showed them.
  for (const h of hands) {
    const handId = h.view.hand!.handId;
    const bodies: string[] = [];
    const collect = (r: import("@playwright/test").Response) => {
      if (r.url().includes(`/hands/${handId}`)) bodies.push("");
      if (r.url().includes(`/hands/${handId}`)) void r.text().then((t) => bodies.push(t)).catch(() => undefined);
    };
    a!.page.on("response", collect);
    const response = await a!.page.goto(`/hands/${handId}`);
    expect(response!.status()).toBe(200);
    bodies.push(await response!.text());
    await expect(a!.page.getByRole("heading", { name: new RegExp(`Hand #${h.view.hand!.handNumber}`) })).toBeVisible();
    await a!.page.waitForLoadState("networkidle").catch(() => undefined);
    a!.page.off("response", collect);
    const payload = normalize(bodies.join("\n"));
    for (const card of h.bCards) {
      for (const form of cardForms(card)) {
        if (h.bShown) continue;
        expect(payload.includes(form), `B's unshown ${card.rank}${card.suit} leaked in /hands/${handId} (${form})`).toBe(false);
      }
    }
    // A's own cards are there.
    const aCards = holeCardsOf(sa.spy, handId);
    expect(cardForms(aCards[0]!).some((f) => payload.includes(f)), "A sees their own cards").toBe(true);
    if (h.bShown) expect(cardForms(h.bCards[0]!).some((f) => payload.includes(f)), "shown cards are in the replay").toBe(true);
  }

  // B's own history of hand X shows B's cards but A's (unshown) ones never reach B either.
  const aCardsX = holeCardsOf(sa.spy, hands[0]!.view.hand!.handId);
  const res = await b!.page.goto(`/hands/${hands[0]!.view.hand!.handId}`);
  const bBody = normalize(await res!.text());
  const bCardsX = hands[0]!.bCards;
  expect(cardForms(bCardsX[0]!).some((f) => bBody.includes(f)), "B sees their own cards").toBe(true);
  for (const card of aCardsX) for (const form of cardForms(card)) expect(bBody.includes(form), `A's ${card.rank}${card.suit} leaked to B`).toBe(false);

  // A stranger can't open someone else's hand.
  const stranger = await game.newPlayer("hhx");
  const other = await stranger.page.goto(`/hands/${hands[0]!.view.hand!.handId}`);
  const strangerBody = normalize(await other!.text());
  for (const card of [...aCardsX, ...hands[0]!.bCards]) for (const form of cardForms(card)) expect(strangerBody.includes(form)).toBe(false);
});
