import { test, expect } from "../support/fixtures";
import { act, createTable, openTable, sit, waitForHandNumber } from "../support/table";

test("a player who doesn't act is checked/folded by the clock, and sits out after two timeouts", async ({ game }) => {
  const [host, idle] = await game.newPlayers(2, "to");
  const tableId = await createTable(host!.page, { name: `E2E clock ${host!.username.slice(-6)}`, fastClock: true, noTimeBank: true });
  game.hosted(host!, tableId);
  const hostSpy = await openTable(host!, tableId);
  const idleSpy = await openTable(idle!, tableId);
  expect(hostSpy.latest()!.settings.actionTimeSec).toBe(10);
  expect(hostSpy.latest()!.settings.timeBankSec).toBe(0);
  await sit(host!, hostSpy, 1);
  await sit(idle!, idleSpy, 2);
  await waitForHandNumber(hostSpy, 1);

  // The host plays passively; the idle player never touches anything.
  const idleSeat = 2;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const v = hostSpy.latest()!;
    if (v.seats.find((s) => s.seat === idleSeat)!.status === "SITTING_OUT") break;
    if (v.hand && !v.hand.result && v.hand.toActSeat === 1 && v.viewer.legalActions) {
      await act(host!, hostSpy, "call");
      continue;
    }
    await host!.page.waitForTimeout(100);
  }

  // What the clock did for the idle player: every "(timed out)" log line, checked against the public state
  // the moment before (a free check is checked, a bet is folded) and the time the turn had started.
  const views = hostSpy.views().sort((a, b) => a.version - b.version);
  const entries = new Map<string, { text: string; at: string }>();
  for (const v of views) for (const e of v.log) entries.set(e.id, e);
  const timeouts = [...entries.values()]
    .filter((e) => e.text.startsWith(`${idle!.username} `) && / (checks|folds) \(timed out\)$/.test(e.text))
    .map((e) => {
      const at = Date.parse(e.at);
      const before = views.filter((v) => Date.parse(v.serverTime) < at && v.hand?.toActSeat === idleSeat).at(-1)!;
      const seat = before.seats.find((s) => s.seat === idleSeat)!;
      const turnStart = views.find(
        (x) => x.hand?.handId === before.hand?.handId && x.hand?.phase === before.hand?.phase && x.hand?.toActSeat === idleSeat,
      )!;
      return {
        text: e.text,
        couldCheck: seat.bet >= before.hand!.currentBet,
        waitedMs: at - Date.parse(turnStart.serverTime),
      };
    });
  expect(timeouts.length, JSON.stringify(timeouts)).toBeGreaterThanOrEqual(2);
  for (const t of timeouts) {
    expect(t.text, JSON.stringify(timeouts)).toMatch(t.couldCheck ? / checks \(timed out\)$/ : / folds \(timed out\)$/);
    expect(t.waitedMs, `the turn clock runs ~10 s ${JSON.stringify(t)}`).toBeGreaterThan(8_000);
  }

  // Two timeouts in a row: sitting out, for everybody.
  await hostSpy.waitFor("idle player sitting out", (v) => v.seats.find((s) => s.seat === idleSeat)?.status === "SITTING_OUT");
  await idleSpy.waitFor("idle sees sitting out", (v) => v.seats.find((s) => s.seat === idleSeat)?.status === "SITTING_OUT");
  await expect(host!.page.getByRole("group", { name: new RegExp(`^${idle!.username}.*sitting out`) })).toBeAttached();
  const bar = idle!.page.getByRole("region", { name: "Your actions" });
  await expect(bar.getByText("You're sitting out")).toBeVisible();

  // Coming back works.
  await bar.getByRole("button", { name: "I'm back" }).click();
  await hostSpy.waitFor("idle player back", (v) => v.seats.find((s) => s.seat === idleSeat)?.status !== "SITTING_OUT");
});
