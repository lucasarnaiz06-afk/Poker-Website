// Per-viewer shuffle proofs: no proof opens a card outside the viewer's entitled set, every viewer's proof
// verifies, and any tampering with a card, salt, leaf or position is detected.
import { describe, expect, it } from "vitest";
import { BOT_STYLES, playBotHand, seededRandom, type BotHandResult } from "./bots";
import { verifyHandCommitment } from "./commitment";
import { expectedDealLayout, parseDeckProof, type DeckProof } from "./deck-proof";
import { buildDeckProof, createDeckReveal, deckRevealCommitment } from "./deck-proof-node";
import type { HandView, HandViewPlayer } from "./types";

type Scenario = { result: BotHandResult; variant: "NLHE" | "PLO"; ids: string[] };

function randomHand(seed: number): Scenario {
  const rng = seededRandom(seed);
  const variant = rng.randomInt(3) === 0 ? "PLO" : "NLHE";
  const count = 2 + rng.randomInt(variant === "PLO" ? 8 : 9);
  const ids = Array.from({ length: count }, (_, i) => `p${i}`);
  // Sparse seats and a sometimes-dead button exercise the deal order.
  const seats = ids.map((_, i) => i * 2 + 1 + (i > 2 ? 1 : 0));
  const players = ids.map((id, i) => ({ id, seat: seats[i]!, stack: 200 + rng.randomInt(1500) }));
  const bomb = rng.randomInt(4) === 0;
  const styles = new Map(ids.map((id, i) => [id, Object.values(BOT_STYLES)[(i + seed) % 5]!]));
  const result = playBotHand(
    {
      variant,
      players,
      buttonSeat: rng.randomInt(4) === 0 ? 2 : seats[rng.randomInt(count)]!,
      smallBlind: 5,
      bigBlind: 10,
      bombPot: bomb ? { ante: 20, doubleBoard: rng.randomInt(2) === 0 } : null,
      runItTwice: true,
    },
    styles,
    rng,
    { runItTwiceChance: 0.5 },
  );
  return { result, variant, ids };
}

/** The view fields the verifier uses, redacted like queries.ts for `viewer` (null = spectator). */
function viewFor(s: Scenario, viewer: string | null, commitment: string, proof: DeckProof | null) {
  const shown = new Set([...s.result.summary.players.filter((p) => p.mustShow).map((p) => p.id), ...s.result.voluntaryShows]);
  const players = s.result.summary.players.map((p) => ({
    userId: p.id,
    seat: p.seat,
    holeCards: p.id === viewer || shown.has(p.id) ? p.holeCards.slice() : null,
  })) as unknown as HandViewPlayer[];
  const view: Pick<HandView, "deckCommitment" | "deckProof" | "boards" | "players" | "buttonSeat" | "variant" | "events"> = {
    deckCommitment: commitment,
    deckProof: proof,
    boards: s.result.summary.boards.map((b) => b.slice()),
    players,
    buttonSeat: s.result.summary.buttonSeat,
    variant: s.variant,
    events: s.result.events,
  };
  const entitled = new Set([...view.boards.flat(), ...players.flatMap((p) => p.holeCards ?? [])]);
  return { view, entitled };
}

const clone = <T>(v: T): T => structuredClone(v);

describe("per-viewer deck proofs", () => {
  it("opens exactly the entitled cards, verifies for every viewer and rejects tampering", async () => {
    let viewersChecked = 0;
    let hiddenChecked = 0;
    let runTwice = 0;
    let doubleBoard = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = randomHand(seed);
      if (s.result.summary.runs === 2) runTwice++;
      if (s.result.summary.doubleBoard) doubleBoard++;
      const reveal = createDeckReveal(s.result.deck);
      expect(new Set(reveal.salts).size).toBe(52);
      const commitment = deckRevealCommitment(reveal);
      const layout = expectedDealLayout({
        variant: s.variant,
        seats: s.result.summary.players.map((p) => p.seat),
        buttonSeat: s.result.summary.buttonSeat,
        events: s.result.events,
      })!;
      // The documented deal order matches the engine: hole cards and board cards sit where the layout says.
      for (const p of s.result.summary.players) {
        expect(layout.holeBySeat.get(p.seat)!.map((i) => s.result.deck[i])).toEqual(p.holeCards);
      }
      for (const [card, i] of layout.boardPositions) expect(s.result.deck[i]).toBe(card);

      for (const viewer of [...s.ids, null]) {
        const { entitled } = viewFor(s, viewer, commitment, null);
        const proof = buildDeckProof(reveal, entitled)!;
        const { view } = viewFor(s, viewer, commitment, proof);

        // No leak: only entitled cards are opened, burns never are, and nothing else carries a card.
        const opened = proof.open.map((o) => o.card);
        expect(new Set(opened)).toEqual(entitled);
        for (const burn of layout.burns) expect(proof.open.some((o) => o.i === burn)).toBe(false);
        for (const entry of [...proof.open, ...proof.leaves]) {
          expect(Object.keys(entry).sort()).toEqual("card" in entry ? ["card", "i", "salt"] : ["i", "leaf"]);
        }
        expect(Object.keys(proof).sort()).toEqual(["leaves", "open", "size", "v"]);
        hiddenChecked += 52 - entitled.size;
        expect(parseDeckProof(JSON.stringify(proof))).toEqual(proof);

        const check = await verifyHandCommitment(view);
        expect(check, `seed ${seed} viewer ${viewer}: ${check.reason}`).toMatchObject({ ok: true, hashOk: true, positionsOk: true });
        viewersChecked++;
        if (proof.open.length < 2) continue; // spectator of a hand folded preflop: nothing opened

        // Tampering: a different card at an opened position.
        const unused = s.result.deck.find((c) => !entitled.has(c))!;
        const t1 = clone(proof);
        t1.open[0]!.card = unused;
        expect((await verifyHandCommitment({ ...view, deckProof: t1 })).ok).toBe(false);
        // Swapping the cards of two opened positions (same set of cards, wrong positions).
        const t2 = clone(proof);
        [t2.open[0]!.card, t2.open[1]!.card] = [t2.open[1]!.card, t2.open[0]!.card];
        expect((await verifyHandCommitment({ ...view, deckProof: t2 })).ok).toBe(false);
        // Moving an opened card to another (hidden) position.
        const t3 = clone(proof);
        const moved = t3.leaves.shift()!;
        const prev = t3.open[0]!.i;
        t3.open[0]!.i = moved.i;
        t3.leaves.push({ i: prev, leaf: moved.leaf });
        expect((await verifyHandCommitment({ ...view, deckProof: t3 })).ok).toBe(false);
        // A changed salt or hidden leaf.
        const t4 = clone(proof);
        t4.open[0]!.salt = t4.open[0]!.salt.replace(/^./, (c) => (c === "0" ? "1" : "0"));
        expect((await verifyHandCommitment({ ...view, deckProof: t4 })).ok).toBe(false);
        const t5 = clone(proof);
        t5.leaves[0]!.leaf = t5.leaves[0]!.leaf.replace(/^./, (c) => (c === "0" ? "1" : "0"));
        expect((await verifyHandCommitment({ ...view, deckProof: t5 })).ok).toBe(false);
        // A displayed card that differs from the committed one.
        const t6 = clone(view);
        const target = t6.boards[0]?.length ? t6.boards[0] : t6.players.find((p) => p.holeCards)!.holeCards!;
        target[0] = unused;
        expect((await verifyHandCommitment(t6)).ok).toBe(false);
        // A different commitment.
        expect((await verifyHandCommitment({ ...view, deckCommitment: "0".repeat(64) })).ok).toBe(false);
        // An honest proof built for another viewer opens cards this view doesn't show.
        if (viewer !== null) {
          const spectator = buildDeckProof(reveal, viewFor(s, null, commitment, null).entitled)!;
          if (spectator.open.length !== proof.open.length) expect((await verifyHandCommitment({ ...view, deckProof: spectator })).ok).toBe(false);
        }
      }
    }
    expect(viewersChecked).toBeGreaterThan(200);
    expect(hiddenChecked).toBeGreaterThan(5000);
    expect(runTwice).toBeGreaterThan(0);
    expect(doubleBoard).toBeGreaterThan(0);
  });

  it("treats legacy full-deck reveals and malformed proofs as not verifiable / failed", async () => {
    const s = randomHand(7);
    expect(buildDeckProof({ deck: s.result.deck, salt: "abc" }, s.result.deck)).toBeNull();
    expect(buildDeckProof(null, [])).toBeNull();
    const { view } = viewFor(s, s.ids[0]!, "0".repeat(64), null);
    const legacy = await verifyHandCommitment(view);
    expect(legacy).toMatchObject({ ok: false, verifiable: false });
    expect(parseDeckProof("{not json")).toBeNull();
    expect(parseDeckProof({ v: 2, size: 2, open: [], leaves: [{ i: 0, leaf: "a".repeat(64) }] })).toBeNull(); // missing position
    expect(parseDeckProof({ v: 2, size: 1, open: [], leaves: [{ i: 0, leaf: "a".repeat(64) }, { i: 0, leaf: "b".repeat(64) }] })).toBeNull();
    const bad = await verifyHandCommitment({ ...view, deckProof: { v: 2, size: 1, open: [], leaves: [] } });
    expect(bad).toMatchObject({ ok: false, verifiable: true });
  });
});
