import { describe, expect, it } from "vitest";
import { SerialQueue } from "./serial-queue";
import { createHarness, deckFor, TABLE_ID } from "./test-harness";

describe("SerialQueue / table actor", () => {
  it("never interleaves tasks across awaits", async () => {
    const queue = new SerialQueue();
    const trace: string[] = [];
    const task = (name: string, delay: number) => async () => {
      trace.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      trace.push(`${name}:end`);
      return name;
    };
    const results = await Promise.all([queue.run(task("a", 15)), queue.run(task("b", 1)), queue.run(task("c", 5))]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(trace).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("a failing task does not block the queue", async () => {
    const queue = new SerialQueue();
    await expect(queue.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(queue.run(() => 42)).resolves.toBe(42);
  });

  it("concurrent sits for the same seat: exactly one wins and only one buy-in is charged", async () => {
    const h = createHarness();
    await h.join("u1");
    await h.join("u2");
    // Slow wallet: the second command must wait for the first one's await.
    const original = h.store.buyIn.bind(h.store);
    h.store.buyIn = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return original(input);
    };
    const results = await Promise.allSettled([
      h.runtime.sit("u1", TABLE_ID, 3, 1000),
      h.runtime.sit("u2", TABLE_ID, 3, 1000),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(h.store.balances.get("u2")).toBe(100_000);
    expect(h.store.balances.get("u1")).toBe(99_000);
  });
});

describe("seating", () => {
  it("validates buy-in, seat and wallet", async () => {
    const h = createHarness({ settings: { minBuyIn: 400, maxBuyIn: 2000 } });
    await h.join("u1", 500);
    await expect(h.runtime.sit("u1", TABLE_ID, 1, 300)).rejects.toMatchObject({ code: "INVALID_BUY_IN" });
    await expect(h.runtime.sit("u1", TABLE_ID, 1, 2001)).rejects.toMatchObject({ code: "INVALID_BUY_IN" });
    await expect(h.runtime.sit("u1", TABLE_ID, 10, 400)).rejects.toMatchObject({ code: "INVALID_SEAT" });
    await expect(h.runtime.sit("u1", TABLE_ID, 1, 600)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    await h.runtime.sit("u1", TABLE_ID, 1, 500);
    expect(h.store.balances.get("u1")).toBe(0);
    await expect(h.runtime.sit("u1", TABLE_ID, 2, 400)).rejects.toMatchObject({ code: "ALREADY_SEATED" });
    await h.join("u2");
    await expect(h.runtime.sit("u2", TABLE_ID, 1, 400)).rejects.toMatchObject({ code: "SEAT_TAKEN" });
    expect(h.transport.balances.at(-1)).toEqual({ userId: "u1", balance: 0 });
  });

  it("requires joining first and respects play restrictions", async () => {
    const h = createHarness();
    h.store.addUser("u9", 10_000);
    await expect(h.runtime.join("c", "u9", "nope", {})).rejects.toMatchObject({ code: "TABLE_NOT_FOUND" });
    await h.join("u9");
    h.store.restricted.set("u9", { ok: false, code: "SELF_EXCLUDED", message: "no" });
    await expect(h.runtime.sit("u9", TABLE_ID, 1, 1000)).rejects.toMatchObject({ code: "SELF_EXCLUDED" });
    expect(h.store.balances.get("u9")).toBe(10_000);
  });

  it("private tables need membership, the invite code or the password", async () => {
    const h = createHarness({ record: { visibility: "PRIVATE", inviteCode: "ABC123", passwordHash: "plain:secret" } });
    h.store.addUser("u2", 1000);
    await expect(h.runtime.join("c2", "u2", TABLE_ID, {})).rejects.toMatchObject({ code: "PASSWORD_REQUIRED" });
    await expect(h.runtime.join("c2", "u2", TABLE_ID, { password: "nope" })).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    await expect(h.runtime.join("c2", "u2", TABLE_ID, { password: "secret" })).resolves.toMatchObject({ tableId: TABLE_ID });
    h.store.addUser("u3", 1000);
    await expect(h.runtime.join("c3", "u3", TABLE_ID, { inviteCode: "ABC123" })).resolves.toMatchObject({ tableId: TABLE_ID });
    // Membership now remembered: no password on reconnect.
    await expect(h.runtime.join("c3b", "u3", TABLE_ID, {})).resolves.toMatchObject({ tableId: TABLE_ID });
  });

  it("locks out after repeated wrong passwords", async () => {
    const h = createHarness({ record: { passwordHash: "plain:secret" } });
    h.store.addUser("u2", 1000);
    for (let i = 0; i < 8; i += 1) {
      await expect(h.runtime.join("c2", "u2", TABLE_ID, { password: `x${i}` })).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    }
    await expect(h.runtime.join("c2", "u2", TABLE_ID, { password: "secret" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("spectators blocked when disabled and the table is full", async () => {
    const h = createHarness({ settings: { allowSpectators: false, maxPlayers: 2 } });
    await h.seat(["u1", "u2"]);
    h.store.addUser("u3", 1000);
    await expect(h.runtime.join("c3", "u3", TABLE_ID, {})).rejects.toMatchObject({ code: "SPECTATORS_NOT_ALLOWED" });
  });

  it("new players wait for the big blind once the game runs", async () => {
    const h = createHarness();
    await h.seat(["u1", "u2", "u3"]);
    await h.untilHand();
    await h.join("u4");
    await h.runtime.sit("u4", TABLE_ID, 5, 1000);
    expect(h.view("u4").seats.find((s) => s.userId === "u4")!.status).toBe("WAITING_BB");
    let dealtAt = 0;
    for (let hand = 0; hand < 6 && dealtAt === 0; hand += 1) {
      await h.passiveToEnd();
      await h.untilHand();
      const t = h.table();
      if (t.hand!.dealt.some((d) => d.userId === "u4")) {
        dealtAt = t.hand!.number;
        expect(t.hand!.engine.snapshot().bigBlindSeat).toBe(5);
      }
    }
    expect(dealtAt).toBeGreaterThan(0);
  });

  it("host must start the table when autoStart is off", async () => {
    const h = createHarness({ settings: { autoStart: false } });
    await h.seat(["u1", "u2"]);
    await h.advance(10_000);
    expect(h.table().hand).toBeNull();
    await expect(h.runtime.start("u2", TABLE_ID)).rejects.toMatchObject({ code: "NOT_HOST" });
    await h.runtime.start("u1", TABLE_ID);
    await h.untilHand();
    expect(h.table().isLive()).toBe(true);
    // Host leaving does not stop the table.
    await h.join("u3");
    await h.runtime.sit("u3", TABLE_ID, 3, 1000);
    await h.runtime.stand("u1", TABLE_ID);
    await h.passiveToEnd();
    await h.untilHand();
    expect(h.table().isLive()).toBe(true);
  });
});

describe("hands", () => {
  it("plays a full hand, persists it and moves the button", async () => {
    const h = createHarness();
    await h.seat(["u1", "u2", "u3"]);
    const hand = await h.untilHand();
    expect(hand.engine.snapshot().buttonSeat).toBe(1);
    const view = h.view("u1");
    expect(view.hand!.deckCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(view.hand!.revealedDeck).toBeNull();
    await h.passiveToEnd();
    expect(h.store.hands).toHaveLength(1);
    const saved = h.store.hands[0]!;
    expect(saved.positions).toEqual({ u1: "BTN", u2: "SB", u3: "BB" });
    const after = h.view("u2");
    expect(after.hand!.phase).toBe("COMPLETE");
    // Per-viewer shuffle proof: verifies against the commitment and opens only u2's cards + the board.
    const { parseDeckProof, proofCommitment } = await import("@poker-platform/shared/hands/client");
    const proof = parseDeckProof(after.hand!.revealedDeck)!;
    expect(proof).not.toBeNull();
    expect(await proofCommitment(proof)).toBe(after.hand!.deckCommitment);
    const u2Cards = hand.engine.snapshot().players.find((p) => p.id === "u2")!.holeCards;
    const shown = [...hand.shown.values()].flatMap((s) => s.cards);
    expect(new Set(proof.open.map((o) => o.card))).toEqual(new Set([...hand.engine.boards.flat(), ...u2Cards, ...shown]));
    expect(saved.deckReveal.cards).toHaveLength(52);
    expect(JSON.stringify(after)).not.toContain(saved.deckReveal.salts.find((_, i) => !proof.open.some((o) => o.i === i))!);
    await h.untilHand();
    expect(h.table().hand!.engine.snapshot().buttonSeat).toBe(2);
    expect(h.table().hand!.number).toBe(2);
  });

  it("acks actions before the next-hand delay and rejects stale hand ids", async () => {
    const h = createHarness();
    await h.seat(["u1", "u2"]);
    const hand = await h.untilHand();
    const actor = h.toAct()!;
    await h.act(actor, "fold");
    // The ack resolves as soon as the action is applied: the hand is settled, persistence and the
    // next-hand timer follow on the queue.
    expect(h.table().hand!.completedAt).not.toBeNull();
    await h.settle();
    expect(h.table().nextHandAt).not.toBeNull();
    await expect(h.runtime.action(actor, TABLE_ID, hand.id, "check")).rejects.toMatchObject({ code: "HAND_COMPLETE" });
    await h.untilHand();
    await expect(h.runtime.action(h.toAct()!, TABLE_ID, hand.id, "call")).rejects.toMatchObject({ code: "STALE_HAND" });
  });

  it("maps an all-in that cannot raise to a call", async () => {
    const h = createHarness();
    await h.join("u1");
    await h.join("u2");
    await h.join("u3");
    await h.runtime.sit("u1", TABLE_ID, 1, 2000);
    await h.runtime.sit("u2", TABLE_ID, 2, 400);
    await h.runtime.sit("u3", TABLE_ID, 3, 2000);
    await h.untilHand();
    // u1 (button, first to act 3-handed) shoves 2000; u2 calls all-in 400; u3 can only call or fold? no: u3 can raise.
    await h.act("u1", "allin");
    await h.act("u2", "allin");
    await h.act("u3", "call");
    expect(h.table().hand!.engine.isComplete || h.table().hand!.engine.status === "RUNOUT_DECISION").toBe(true);
  });

  it("heads-up: the previous big blind is not the big blind again", async () => {
    const h = createHarness();
    await h.seat(["u1", "u2", "u3"]);
    await h.untilHand(); // button 1, SB 2, BB 3
    await h.runtime.stand("u1", TABLE_ID);
    await h.passiveToEnd();
    await h.untilHand();
    const snap = h.table().hand!.engine.snapshot();
    expect(snap.bigBlindSeat).toBe(2);
    expect(snap.buttonSeat).toBe(3);
  });

  it("straddle and antes are posted", async () => {
    const h = createHarness({ settings: { straddle: true, ante: 2 } });
    await h.seat(["u1", "u2", "u3", "u4"]);
    await h.runtime.straddle("u4", TABLE_ID, true);
    await h.untilHand();
    const snap = h.table().hand!.engine.snapshot();
    expect(snap.straddleSeat).toBe(4);
    expect(snap.totalPot).toBe(4 * 2 + 5 + 10 + 20);
  });

  it("time bank then timeout, auto sit-out after two timeouts, auto stand after 10 minutes", async () => {
    const h = createHarness({ settings: { actionTimeSec: 10, timeBankSec: 5 } });
    await h.seat(["u1", "u2"]);
    await h.untilHand();
    const actor = h.toAct()!;
    await h.advance(10_000);
    let view = h.view(actor);
    expect(view.hand!.usingTimeBank).toBe(true);
    expect(view.hand!.toActSeat).toBe(h.table().seatOf(actor)!.seat);
    await h.advance(5_000);
    expect(h.table().seatOf(actor)!.timeBankMs).toBe(0);
    expect(h.table().seatOf(actor)!.consecutiveTimeouts).toBe(1);
    // Hand over (heads-up preflop SB timed out -> fold). Next hand: let them time out again.
    for (let i = 0; i < 40 && h.table().seatOf(actor)!.status !== "SITTING_OUT"; i += 1) {
      if (!h.table().isLive()) await h.untilHand();
      const next = h.toAct();
      if (next === actor) await h.advance(10_000);
      else if (next) {
        const legal = h.table().hand!.engine.legalActions(next)!;
        await h.act(next, legal.canCheck ? "check" : "call");
      }
    }
    expect(h.table().seatOf(actor)!.status).toBe("SITTING_OUT");
    view = h.view(actor);
    expect(view.seats.find((s) => s.userId === actor)!.status).toBe("SITTING_OUT");
    if (h.table().isLive()) await h.passiveToEnd();
    const balanceBefore = h.store.balances.get(actor)!;
    const stack = h.table().seatOf(actor)!.stack;
    await h.advance(10 * 60_000 + 1000);
    expect(h.table().seatOf(actor)).toBeNull();
    expect(h.store.balances.get(actor)).toBe(balanceBefore + stack);
  });

  it("time bank replenishes 5s every 10 hands, capped", async () => {
    const h = createHarness({ settings: { timeBankSec: 30 } });
    await h.seat(["u1", "u2"]);
    const seat = () => h.table().seatOf("u1")!;
    await h.untilHand();
    seat().timeBankMs = 10_000;
    seat().handsTowardsBank = 0;
    for (let i = 0; i < 10; i += 1) {
      await h.passiveToEnd();
      await h.untilHand();
    }
    expect(seat().timeBankMs).toBe(15_000);
  });

  it("standing mid-hand folds immediately and cashes out after the hand", async () => {
    const h = createHarness();
    await h.seat(["u1", "u2", "u3"]);
    await h.untilHand();
    const before = h.store.balances.get("u2")!;
    await h.runtime.stand("u2", TABLE_ID);
    const p = h.table().hand!.engine.getPlayer("u2")!;
    expect(p.folded).toBe(true);
    expect(h.table().seatOf("u2")!.leaving).toBe(true);
    await h.passiveToEnd();
    expect(h.table().seatOf("u2")).toBeNull();
    expect(h.store.balances.get("u2")).toBe(before + 1000 - 5);
  });

  it("sit out skips dealing; sit in waits for the big blind", async () => {
    const h = createHarness();
    await h.seat(["u1", "u2", "u3", "u4"]);
    await h.untilHand();
    await h.runtime.sitOut("u4", TABLE_ID, true);
    await h.passiveToEnd();
    await h.untilHand();
    expect(h.table().hand!.dealt.map((d) => d.userId)).not.toContain("u4");
    await h.runtime.sitOut("u4", TABLE_ID, false);
    expect(h.table().seatOf("u4")!.status).toBe("WAITING_BB");
  });

  it("busted players sit out and can rebuy", async () => {
    const h = createHarness({
      decks: [deckFor([["As", "Ah"], ["7c", "2d"]], ["Ad", "Kc", "9h", "4s", "3c"])],
      settings: { minBuyIn: 400, maxBuyIn: 2000 },
    });
    await h.seat(["u1", "u2"], 400);
    await h.untilHand();
    // heads-up: button (seat 1, u1) is SB and acts first; deal order starts left of button: u2 then u1.
    // deckFor order = deal order: [u2 cards, u1 cards]
    await h.act("u1", "allin");
    await h.act("u2", "call");
    await h.passiveToEnd();
    const loser = h.table().seatOf("u1")!.stack === 0 ? "u1" : "u2";
    expect(h.table().seatOf(loser)!.status).toBe("SITTING_OUT");
    expect(loser).toBe("u1");
    await expect(h.runtime.sitOut(loser, TABLE_ID, false)).rejects.toMatchObject({ code: "REBUY_REQUIRED" });
    await expect(h.runtime.rebuy(loser, TABLE_ID, 100)).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await h.runtime.rebuy(loser, TABLE_ID, 500);
    expect(h.table().seatOf(loser)!.status).toBe("ACTIVE");
    expect(h.store.totalChips()).toBe(200_000);
  });

  it("top-up during a hand is applied at the hand boundary, capped at max buy-in", async () => {
    const h = createHarness({ settings: { minBuyIn: 400, maxBuyIn: 2000 } });
    await h.seat(["u1", "u2"], 1000);
    await h.untilHand();
    await h.runtime.rebuy("u1", TABLE_ID, 900);
    expect(h.table().seatOf("u1")!.pendingTopUp).toBe(900);
    await expect(h.runtime.rebuy("u1", TABLE_ID, 200)).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await h.passiveToEnd();
    const stack = h.table().seatOf("u1")!.stack;
    expect(stack).toBeLessThanOrEqual(2000);
    expect(h.store.totalChips()).toBe(200_000);
  });

  it("disconnect keeps the seat; reconnect resyncs with a full view", async () => {
    const h = createHarness({ timings: { disconnectGraceMs: 5_000 } });
    await h.seat(["u1", "u2"]);
    await h.untilHand();
    await h.runtime.disconnect("c-u1");
    expect(h.view("u2").seats.find((s) => s.userId === "u1")!.connected).toBe(true);
    await h.advance(5_000);
    expect(h.view("u2").seats.find((s) => s.userId === "u1")!.connected).toBe(false);
    expect(h.table().seatOf("u1")).not.toBeNull();
    const view = await h.runtime.join("c-u1-new", "u1", TABLE_ID, {});
    expect(view.viewer.seat).toBe(1);
    expect(view.seats.find((s) => s.userId === "u1")!.holeCards).toHaveLength(2);
    expect(h.view("u2").seats.find((s) => s.userId === "u1")!.connected).toBe(true);
  });

  it("chat: trimmed, masked, emotes, disabled setting", async () => {
    const h = createHarness();
    await h.seat(["u1"]);
    await h.join("u2");
    await h.runtime.chat("u1", TABLE_ID, "  hello   shit  ", undefined);
    expect(h.transport.chats.at(-1)!.message.text).toBe("hello s***");
    expect(h.transport.chats.at(-1)!.connIds.sort()).toEqual(["c-u1", "c-u2"]);
    await h.runtime.chat("u2", TABLE_ID, undefined, "7");
    expect(h.transport.chats.at(-1)!.message.emoteId).toBe("7");
    const off = createHarness({ settings: { chatEnabled: false } });
    await off.join("u1");
    await expect(off.runtime.chat("u1", TABLE_ID, "hi", undefined)).rejects.toMatchObject({ code: "CHAT_DISABLED" });
  });

  it("host closes the table: hand voided, every stack refunded", async () => {
    const h = createHarness();
    await h.seat(["u1", "u2", "u3"]);
    await h.untilHand();
    await h.act(h.toAct()!, "raise", 100);
    await h.runtime.close("u1", TABLE_ID);
    expect(h.store.totalChips()).toBe(300_000);
    for (const id of ["u1", "u2", "u3"]) expect(h.store.balances.get(id)).toBe(100_000);
    expect(h.store.tables.get(TABLE_ID)!.closed).toBe(true);
    expect(h.runtime.tables.has(TABLE_ID)).toBe(false);
  });

  it("host closes from the lobby (closeAsHost): loaded table refunds stacks; others are rejected", async () => {
    const h = createHarness();
    await h.seat(["u1", "u2"]);
    await h.untilHand();
    await expect(h.runtime.closeAsHost("u2", TABLE_ID)).rejects.toMatchObject({ code: "NOT_HOST" });
    await h.runtime.closeAsHost("u1", TABLE_ID);
    expect(h.store.balances.get("u1")).toBe(100_000);
    expect(h.store.balances.get("u2")).toBe(100_000);
    expect(h.store.tables.get(TABLE_ID)!.closed).toBe(true);
    await expect(h.runtime.closeAsHost("u1", TABLE_ID)).rejects.toMatchObject({ code: "TABLE_NOT_FOUND" });
  });

  it("closeAsHost on a table this process hasn't loaded closes it without loading it for non-hosts", async () => {
    const h = createHarness();
    expect(h.runtime.tables.has(TABLE_ID)).toBe(false);
    await expect(h.runtime.closeAsHost("u2", TABLE_ID)).rejects.toMatchObject({ code: "NOT_HOST" });
    expect(h.runtime.tables.has(TABLE_ID)).toBe(false);
    await h.runtime.closeAsHost("u1", TABLE_ID);
    expect(h.store.tables.get(TABLE_ID)!.closed).toBe(true);
    expect(h.runtime.tables.has(TABLE_ID)).toBe(false);
  });
});

describe("crash recovery and shutdown", () => {
  it("refunds stacks persisted by a dead process (idempotent)", async () => {
    const h = createHarness();
    await h.seat(["u1", "u2", "u3"]);
    await h.untilHand();
    await h.passiveToEnd();
    await h.untilHand();
    await h.act(h.toAct()!, "raise", 200); // mid-hand crash: not persisted
    const persisted = [...h.store.rows.values()].reduce((sum, r) => sum + (r.stack ?? 0), 0);
    expect(persisted).toBe(3000);

    // "Restart": a new runtime over the same store.
    const { TableRuntime } = await import("./runtime");
    const fresh = new TableRuntime({
      clock: h.clock,
      rng: { randomInt: () => 0, randomHex: () => "00", uuid: () => "x" },
      wallet: h.store,
      hands: h.store,
      lobby: h.store,
      gate: h.store,
      transport: h.transport,
    });
    const result = await fresh.recover();
    expect(result).toEqual({ refunded: 3, total: 3 });
    expect(h.store.totalChips()).toBe(300_000);
    const again = await fresh.recover();
    expect(again.total).toBe(0);
    expect(h.store.totalChips()).toBe(300_000);
  });

  it("graceful shutdown voids the hand in progress and refunds pre-hand stacks", async () => {
    const h = createHarness();
    await h.seat(["u1", "u2"]);
    await h.untilHand();
    await h.act(h.toAct()!, "raise", 300);
    await h.runtime.shutdown();
    expect(h.store.balances.get("u1")).toBe(100_000);
    expect(h.store.balances.get("u2")).toBe(100_000);
    expect(h.view("u1").status).toBe("CLOSED");
    await expect(h.runtime.join("c", "u1", TABLE_ID, {})).rejects.toMatchObject({ code: "SERVER_RESTARTING" });
  });

  it("a failed hand save is retried and does not lose chips", async () => {
    const h = createHarness();
    await h.seat(["u1", "u2"]);
    await h.untilHand();
    h.store.failNextSaveHand = 1;
    await h.passiveToEnd();
    expect(h.store.hands).toHaveLength(1);
  });
});
