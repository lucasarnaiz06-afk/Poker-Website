// Property test: thousands of random hands with random legal (and probed illegal) actions.
import { describe, expect, it } from "vitest";
import {
  computePositions,
  EngineError,
  evaluateHand,
  evaluateOmaha,
  PokerHand,
  type Card,
  type HandEvent,
  type LegalActions,
  type PlayerAction,
  type StartHandConfig,
} from "../src";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = { float: () => number; int: (n: number) => number; chance: (p: number) => boolean; pick: <T>(xs: readonly T[]) => T };

function makeRng(seed: number): Rng {
  const f = mulberry32(seed);
  const int = (n: number) => Math.floor(f() * n);
  return { float: f, int, chance: (p) => f() < p, pick: (xs) => xs[int(xs.length)]! };
}

function randomConfig(rng: Rng): StartHandConfig {
  const n = 2 + rng.int(8);
  const seats = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => rng.float() - 0.5).slice(0, n);
  const [sb, bb] = rng.pick([
    [1, 2],
    [5, 10],
    [25, 50],
    [0, 10],
  ] as const);
  const players = seats.map((seat, i) => {
    const stackKind = rng.int(10);
    const stack = stackKind < 2 ? 1 + rng.int(3 * bb) : stackKind < 4 ? 1 + rng.int(30 * bb) : 1 + rng.int(300 * bb);
    return { id: `u${i}`, seat, stack };
  });
  const buttonSeat = rng.chance(0.85) ? rng.pick(seats) : 1 + rng.int(9);
  const variant = rng.chance(0.4) ? "PLO" : "NLHE";
  const bombPot = rng.chance(0.15) ? { ante: bb * (1 + rng.int(4)), doubleBoard: rng.chance(0.5) } : null;
  const positions = computePositions(seats, buttonSeat);
  return {
    handId: null,
    variant,
    players,
    buttonSeat,
    smallBlind: sb,
    bigBlind: bb,
    ante: rng.chance(0.2) ? 1 + rng.int(bb) : 0,
    straddleSeat: !bombPot && positions.straddleSeat !== null && rng.chance(0.25) ? positions.straddleSeat : null,
    bombPot,
    runItTwice: rng.chance(0.4),
    extraBlindPlayerIds: rng.chance(0.1) ? [rng.pick(players).id] : [],
  };
}

function expectThrows(fn: () => unknown) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    expect(e).toBeInstanceOf(EngineError);
  }
  expect(threw).toBe(true);
}

function allInAllowed(la: LegalActions, stack: number, streetBet: number): boolean {
  return stack <= la.callAmount || (la.canBetOrRaise && streetBet + stack <= la.maxTo);
}

type Style = { fold: number; allin: number; raise: number };

function chooseAction(rng: Rng, style: Style, la: LegalActions, stack: number, streetBet: number): PlayerAction {
  const r = rng.float();
  if (r < (la.canCheck ? style.fold / 4 : style.fold)) return { type: "fold" };
  if (rng.float() < style.allin && allInAllowed(la, stack, streetBet)) return { type: "allin" };
  if (rng.float() < style.raise && la.canBetOrRaise) {
    const k = rng.int(4);
    const amount =
      k === 0 ? la.minTo : k === 1 ? la.maxTo : k === 2 ? la.potTo : la.minTo + rng.int(la.maxTo - la.minTo + 1);
    return { type: rng.chance(0.5) ? (la.isBet ? "bet" : "raise") : "raise", amount };
  }
  return la.canCheck ? { type: "check" } : { type: "call" };
}

function checkInvariants(hand: PokerHand, total: number) {
  const snap = hand.snapshot();
  const stacks = snap.players.reduce((s, p) => s + p.stack, 0);
  const committed = snap.players.reduce((s, p) => s + p.committed, 0);
  expect(snap.status === "COMPLETE" ? stacks : stacks + committed).toBe(total);
  for (const p of snap.players) {
    expect(p.stack).toBeGreaterThanOrEqual(0);
    expect(p.streetBet).toBeGreaterThanOrEqual(0);
    expect(p.streetBet).toBeLessThanOrEqual(p.committed);
    if (p.allIn && snap.status !== "COMPLETE") expect(p.stack).toBe(0);
  }
  const potSum = snap.pots.reduce((s, p) => s + p.amount, 0);
  const streetBets = snap.players.reduce((s, p) => s + p.streetBet, 0);
  expect(potSum + streetBets).toBe(snap.totalPot);
  expect(snap.totalPot).toBe(committed);
  for (const pot of snap.pots) {
    for (const id of pot.eligiblePlayerIds) expect(snap.players.find((p) => p.id === id)!.folded).toBe(false);
  }
  if (snap.status === "BETTING") {
    expect(snap.toActPlayerId).not.toBeNull();
    const actor = snap.players.find((p) => p.id === snap.toActPlayerId)!;
    expect(actor.folded || actor.allIn).toBe(false);
    for (const p of snap.players) {
      expect(hand.legalActions(p.id) === null).toBe(p.id !== actor.id);
      expect(p.streetBet).toBeLessThanOrEqual(snap.currentBet);
    }
  } else {
    expect(snap.toActPlayerId).toBeNull();
  }
}

function checkSummary(hand: PokerHand, config: StartHandConfig) {
  const s = hand.summary!;
  const events = hand.events;
  const total = config.players.reduce((sum, p) => sum + p.stack, 0);
  expect(s.players.reduce((sum, p) => sum + p.endingStack, 0)).toBe(total);
  expect(s.players.reduce((sum, p) => sum + p.net, 0)).toBe(0);
  expect(s.totalPot).toBe(s.players.reduce((sum, p) => sum + p.committed, 0));
  expect(s.totalPot).toBe(s.players.reduce((sum, p) => sum + p.won, 0));
  const awards = events.filter((e): e is Extract<HandEvent, { type: "POT_AWARD" }> => e.type === "POT_AWARD");
  expect(awards.reduce((sum, a) => sum + a.amount, 0)).toBe(s.totalPot);
  const returned = events.filter((e): e is Extract<HandEvent, { type: "UNCALLED_RETURN" }> => e.type === "UNCALLED_RETURN");
  expect(returned.reduce((sum, e) => sum + e.amount, 0)).toBe(s.players.reduce((sum, p) => sum + p.uncalledReturned, 0));
  // One per betting round, plus unwinnable chips returned to players who left (folded out of turn).
  expect(returned.length).toBeLessThanOrEqual(4 + config.players.length);
  events.forEach((e, i) => expect(e.seq).toBe(i));
  expect(events.at(-1)!.type).toBe("HAND_END");
  expect(events[0]!.type).toBe("HAND_START");

  for (const p of s.players) {
    expect(p.endingStack).toBe(p.startingStack - p.committed + p.won);
    expect(p.endingStack).toBeGreaterThanOrEqual(0);
    if (p.folded) {
      expect(p.won).toBe(0);
      expect(p.wentToShowdown).toBe(false);
    }
    expect(p.wonPerPot.reduce((sum, w) => sum + w.amount, 0)).toBe(p.won);
  }

  for (const pot of s.pots) {
    expect(pot.amount).toBeGreaterThan(0);
    expect(pot.awards.reduce((sum, a) => sum + a.amount, 0)).toBe(pot.amount);
    for (const id of pot.eligiblePlayerIds) expect(s.players.find((p) => p.id === id)!.folded).toBe(false);
    for (const award of pot.awards) {
      expect(award.winners.reduce((sum, w) => sum + w.amount, 0)).toBe(award.amount);
      const shares = award.winners.map((w) => w.amount);
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
      for (const w of award.winners) expect(pot.eligiblePlayerIds).toContain(w.playerId);
      if (s.showdown) {
        // Independent re-evaluation of the winners.
        const board = s.boards[award.boardIndex]!;
        const value = (id: string) => {
          const hole = s.players.find((p) => p.id === id)!.holeCards;
          return (s.variant === "PLO" ? evaluateOmaha(hole, board) : evaluateHand([...hole, ...board])).value;
        };
        const best = Math.max(...pot.eligiblePlayerIds.map(value));
        const expected = pot.eligiblePlayerIds.filter((id) => value(id) === best).sort();
        expect(award.winners.map((w) => w.playerId).sort()).toEqual(expected);
      }
    }
  }
  if (s.pots.length > 1) {
    for (let i = 1; i < s.pots.length; i++) {
      for (const id of s.pots[i]!.eligiblePlayerIds) expect(s.pots[i - 1]!.eligiblePlayerIds).toContain(id);
    }
  }

  if (s.showdown) {
    expect(s.boards.every((b) => b.length === 5)).toBe(true);
    const live = s.players.filter((p) => !p.folded);
    expect(live.length).toBeGreaterThanOrEqual(2);
    for (const p of live) {
      expect(p.wentToShowdown).toBe(true);
      expect(p.hands).toHaveLength(s.boards.length);
      if (p.won > 0) expect(p.mustShow).toBe(true);
    }
  } else {
    expect(s.players.filter((p) => !p.folded)).toHaveLength(1);
  }
  const state = hand.getState();
  const cards: Card[] = [...s.players.flatMap((p) => p.holeCards), ...state.burns];
  const boardCards = new Set<string>(s.boards.flat());
  expect(new Set(cards).size).toBe(cards.length);
  for (const c of cards) expect(boardCards.has(c)).toBe(false);
  if (s.runs === 2) expect(s.boards).toHaveLength(2);
  if (s.isBombPot) expect(s.players.every((p) => !p.stats.vpip && !p.stats.pfr && !p.stats.cbet)).toBe(true);
  for (const p of s.players) {
    if (p.stats.pfr || p.stats.threeBet) expect(p.stats.vpip).toBe(true);
    if (p.stats.threeBet) expect(p.stats.threeBetOpportunity).toBe(true);
    if (p.stats.cbet) expect(p.stats.cbetOpportunity).toBe(true);
  }
}

type Coverage = Record<string, number>;

function playRandomHand(seed: number, coverage: Coverage): { actions: number } {
  const rng = makeRng(seed);
  const config = randomConfig(rng);
  const total = config.players.reduce((sum, p) => sum + p.stack, 0);
  let hand = PokerHand.start(config, { randomInt: (n) => rng.int(n) });
  const style: Style = { fold: 0.05 + rng.float() * 0.2, allin: rng.float() * 0.1, raise: 0.05 + rng.float() * 0.4 };
  let steps = 0;
  checkInvariants(hand, total);
  while (!hand.isComplete) {
    if (++steps > 400) throw new Error(`hand did not terminate (seed ${seed})`);
    if (rng.chance(0.05)) hand = PokerHand.fromState(JSON.parse(JSON.stringify(hand.getState())));

    const snap = hand.snapshot();
    if (hand.status === "RUNOUT_DECISION") {
      const leavers = snap.players.filter((p) => !p.folded && !p.allIn);
      if (leavers.length > 0 && rng.chance(0.1)) {
        expect(hand.foldOutOfTurn(rng.pick(leavers).id)).toBe(true);
      } else {
        expectThrows(() => hand.act(snap.players[0]!.id, { type: "fold" }));
        hand.chooseRunout(rng.chance(0.5) ? 1 : 2);
      }
      checkInvariants(hand, total);
      continue;
    }
    expectThrows(() => hand.chooseRunout(2));

    const id = hand.toActPlayerId!;
    const la = hand.legalActions(id)!;
    const me = snap.players.find((p) => p.id === id)!;
    expect(la.canFold).toBe(true);
    expect(la.callAmount).toBeLessThanOrEqual(me.stack);
    expect(la.canCheck).toBe(la.callAmount === 0);
    if (la.canBetOrRaise) {
      expect(la.minTo).toBeGreaterThan(snap.currentBet);
      expect(la.minTo).toBeLessThanOrEqual(la.maxTo);
      expect(la.potTo).toBeGreaterThanOrEqual(la.minTo);
      expect(la.potTo).toBeLessThanOrEqual(la.maxTo);
      expect(la.maxTo).toBeLessThanOrEqual(me.streetBet + me.stack);
      expect(la.isBet).toBe(snap.currentBet === 0);
    }

    // Probe illegal actions: they must throw and leave the state untouched.
    const before = hand.events.length;
    if (!la.canCheck) expectThrows(() => hand.act(id, { type: "check" }));
    if (la.callAmount === 0) expectThrows(() => hand.act(id, { type: "call" }));
    if (la.canBetOrRaise) {
      expectThrows(() => hand.act(id, { type: "raise", amount: la.minTo - 1 }));
      expectThrows(() => hand.act(id, { type: "raise", amount: la.maxTo + 1 }));
    } else {
      expectThrows(() => hand.act(id, { type: "raise", amount: snap.currentBet + 1_000_000 }));
    }
    if (!allInAllowed(la, me.stack, me.streetBet)) expectThrows(() => hand.act(id, { type: "allin" }));
    const other = snap.players.find((p) => p.id !== id)!;
    expectThrows(() => hand.act(other.id, { type: "fold" }));
    expect(hand.events.length).toBe(before);
    expect(hand.toActPlayerId).toBe(id);

    const r = rng.float();
    if (r < 0.03) {
      const others = snap.players.filter((p) => p.id !== id && !p.folded && !p.allIn);
      if (others.length > 0) expect(hand.foldOutOfTurn(rng.pick(others).id)).toBe(true);
      else hand.timeout();
    } else if (r < 0.06) {
      const ev = hand.timeout();
      expect(ev.action).toBe(la.canCheck ? "check" : "fold");
    } else {
      const action = chooseAction(rng, style, la, me.stack, me.streetBet);
      const ev = hand.act(id, action);
      if (action.type === "call") expect(ev.amount).toBe(la.callAmount);
      if (action.type === "raise" || action.type === "bet") expect(ev.to).toBe(action.amount);
    }
    checkInvariants(hand, total);
  }
  checkSummary(hand, config);
  const s = hand.summary!;
  const events = hand.events;
  const bump = (key: string, cond: boolean) => {
    if (cond) coverage[key] = (coverage[key] ?? 0) + 1;
  };
  bump("showdown", s.showdown);
  bump("plo showdown", s.showdown && s.variant === "PLO");
  bump("run twice", s.runs === 2);
  bump("double board", s.doubleBoard && s.showdown);
  bump("side pots", s.pots.length > 1);
  bump("split pot", s.pots.some((p) => p.awards.some((a) => a.winners.length > 1)));
  bump("uncalled", events.some((e) => e.type === "UNCALLED_RETURN"));
  bump("incomplete raise", events.some((e) => e.type === "ACTION" && (e.action === "raise" || e.action === "bet") && !e.fullRaise));
  bump("out of turn", events.some((e) => e.type === "ACTION" && e.outOfTurn));
  bump("straddle", s.straddleSeat !== null);
  bump("all-in runout", s.allIn !== null);
  bump("walk", s.isWalk);
  bump("river showdown without all-in", s.showdown && s.allIn === null);
  bump("cbet", s.players.some((p) => p.stats.cbet));
  bump("3bet", s.players.some((p) => p.stats.threeBet));
  return { actions: steps };
}

describe("random hands (property test)", () => {
  it("6,000 random hands keep every invariant", () => {
    let actions = 0;
    let showdowns = 0;
    const coverage: Coverage = {};
    for (let seed = 1; seed <= 6000; seed++) {
      try {
        actions += playRandomHand(seed, coverage).actions;
      } catch (e) {
        (e as Error).message = `seed ${seed}: ${(e as Error).message}`;
        throw e;
      }
      showdowns++;
    }
    expect(showdowns).toBe(6000);
    expect(actions).toBeGreaterThan(20_000);
    for (const key of ["showdown", "plo showdown", "run twice", "double board", "side pots", "split pot", "uncalled", "incomplete raise", "out of turn", "straddle", "all-in runout", "walk", "river showdown without all-in", "cbet", "3bet"]) {
      expect(coverage[key] ?? 0, key).toBeGreaterThan(20);
    }
    console.log("fuzz coverage", JSON.stringify(coverage), "actions", actions);
  }, 300_000);
});
