import { test, expect } from "../support/fixtures";
import { summarize } from "../support/spy";
import {
  createTable,
  expectConsistent,
  letWin,
  openTable,
  playHandWith,
  propose,
  sit,
  tableChips,
  vote,
  waitForHandNumber,
  type Seated,
} from "../support/table";

test("votes: bomb pot, nit game (penalty paid by the last nit) and 7-2 bounty", async ({ game }) => {
  const [a, b, c] = await game.newPlayers(3, "sg");
  const tableId = await createTable(a!.page, {
    name: `E2E votes ${a!.username.slice(-6)}`,
    bombPots: true,
    nitGame: true,
    bounty: true,
    voteRule: "Majority",
  });
  game.hosted(a!, tableId);
  const seated: Seated[] = [];
  for (const [i, p] of [a!, b!, c!].entries()) {
    const spy = await openTable(p, tableId);
    await sit(p, spy, i * 2 + 1);
    seated.push({ player: p, spy });
  }
  const [sa, sb, sc] = seated as [Seated, Seated, Seated];
  const settings = sa.spy.latest()!.settings;
  const bb = settings.bigBlind;
  const onTable = 3 * settings.minBuyIn > 0 ? tableChips(await sa.spy.waitFor("all seated", (v) => (v.seats.length === 3 ? v : null))) : 0;

  // Get all three players dealt in (a late sitter waits for the big blind).
  for (let i = 0; i < 4; i += 1) {
    const v = await sa.spy.waitFor("hand running", (x) => (x.hand && !x.hand.result ? x : null), 60_000);
    if (v.seats.filter((s) => s.inHand).length === 3) break;
    await playHandWith(seated, () => "check");
  }

  // ---- Bomb pot by vote --------------------------------------------------------------------
  await propose(b!, "Bomb pot next hand");
  await sa.spy.waitFor("bomb vote open", (v) => v.votes.find((x) => x.kind === "BOMB_POT" && x.status === "OPEN"));
  await vote(c!, "Bomb pot");
  await sa.spy.waitFor("bomb pot queued", (v) => (v.sideGames.bombPotQueued ? v : null));
  await expect(a!.page.getByText("Bomb pot next").first()).toBeVisible();
  const beforeBomb = await playHandWith(seated, () => "check");
  const stacksBefore = new Map(beforeBomb.seats.map((s) => [s.seat, s.stack]));
  const bomb = await waitForHandNumber(sa.spy, beforeBomb.hand!.handNumber + 1);
  expect(bomb.hand!.isBombPot, summarize(bomb)).toBe(true);
  expect(bomb.hand!.phase).toBe("FLOP");
  expect(bomb.hand!.boards[0]).toHaveLength(3);
  const ante = settings.bombPot.anteBB * bb;
  for (const s of bomb.seats.filter((x) => x.inHand)) expect(s.stack, `ante from seat ${s.seat}`).toBe(stacksBefore.get(s.seat)! - ante);
  expect(bomb.hand!.totalPot).toBe(3 * ante);
  // No preflop action happened in the bomb pot: the first log entries of the hand are antes and the flop.
  const bombLog = bomb.log.filter((l) => l.handNumber === bomb.hand!.handNumber).map((l) => l.text).join("\n");
  expect(bombLog).not.toMatch(/(calls|raises|checks|folds)/);
  await playHandWith(seated, () => "check");
  expect(tableChips(sa.spy.latest()!)).toBe(onTable);

  // ---- Nit game --------------------------------------------------------------------------------
  await propose(a!, "Start nit game");
  await sa.spy.waitFor("nit vote open", (v) => v.votes.find((x) => x.kind === "NIT_GAME" && x.status === "OPEN"));
  // Majority: A (proposer) + B is enough; C's card then shows the result.
  await vote(b!, "Nit game");
  await expect(c!.page.getByText("Vote passed").first()).toBeVisible();
  await sa.spy.waitFor("nit game active", (v) => (v.sideGames.nitGame.active ? v : null));
  // The vote passes mid-hand: finish it, then the round starts with everyone dealt in.
  if (sa.spy.latest()!.hand && !sa.spy.latest()!.hand!.result) await playHandWith(seated, () => "check");
  const nitStart = await sa.spy.waitFor("nit round running", (v) =>
    v.hand && !v.hand.result && v.seats.every((s) => s.isNit === true) ? v : null, 60_000);
  expect(nitStart.sideGames.nitGame.participantUserIds).toHaveLength(3);
  // Badges: every seat is labelled as a nit for every viewer.
  for (const { player } of seated) {
    for (const other of seated) {
      await expect(player.page.getByRole("group", { name: new RegExp(`^${other.player.username}\\b.*\\bnit\\b`) })).toBeAttached();
    }
  }

  // A wins a pot (safe), then B wins a pot (safe): C is the last nit and pays the penalty to both.
  const h1 = await playHandWith(seated, letWin(a!));
  expect(h1.hand!.result!.winners.map((w) => w.userId)).toContain(sa.spy.latest()!.viewer.userId);
  await sa.spy.waitFor("A is safe", (v) => (!v.sideGames.nitGame.nitUserIds.includes(sa.spy.latest()!.viewer.userId) ? v : null));
  await waitForHandNumber(sa.spy, h1.hand!.handNumber + 1);
  const cUser = sc.spy.latest()!.viewer.userId;
  const before = sa.spy.latest()!;
  const startStacks = new Map(before.seats.map((s) => [s.userId, s.stack + s.bet]));
  const h2 = await playHandWith(seated, letWin(b!));
  const penalty = settings.nitGame.penaltyBB * bb;
  const payments = h2.hand!.result!.sidePayments.filter((p) => p.reason === "NIT_GAME");
  const cSeat = h2.seats.find((s) => s.userId === cUser)!.seat;
  expect(payments, summarize(h2)).toHaveLength(2);
  for (const p of payments) {
    expect(p.fromSeat).toBe(cSeat);
    expect(p.amount).toBe(penalty);
  }
  expect(new Set(payments.map((p) => p.toSeat))).toEqual(new Set(h2.seats.filter((s) => s.userId !== cUser).map((s) => s.seat)));
  // Stacks: C lost what they put in the pot plus 2 penalties; everyone sees the same numbers.
  await expectConsistent(seated.map((s) => s.spy));
  const after = sa.spy.latest()!;
  expect(tableChips(after)).toBe(onTable);
  const cAfter = after.seats.find((s) => s.userId === cUser)!.stack;
  const cPutIn = startStacks.get(cUser)! - cAfter - 2 * penalty;
  expect(cPutIn, "C's loss is blinds/calls plus the penalty").toBeGreaterThanOrEqual(0);
  expect(cPutIn).toBeLessThanOrEqual(2 * bb);
  await game.audit();
  // The round is over and the table shows who paid.
  await sa.spy.waitFor("nit round over", (v) => (!v.sideGames.nitGame.active || v.sideGames.nitGame.nitUserIds.length !== 1 ? v : null));
  for (const { player } of seated) {
    await expect(player.page.getByText(/was the last nit and pays \d+/).first()).toBeVisible();
  }

  // ---- 7-2 bounty start vote -------------------------------------------------------------------
  await propose(c!, "Start 7-2 bounty");
  await sa.spy.waitFor("bounty vote open", (v) => v.votes.find((x) => x.kind === "BOUNTY_GAME" && x.status === "OPEN"));
  await vote(a!, "7-2 bounty");
  await sa.spy.waitFor("bounty active", (v) => (v.sideGames.bountyGame.active ? v : null));
  await expect(b!.page.getByText("7-2 bounty").first()).toBeVisible();
  await expectConsistent(seated.map((s) => s.spy));
});
