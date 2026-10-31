// Per-viewer TableView. Redaction rules: a viewer sees their own hole cards and cards that were shown
// (showdown, all-in runout, voluntary show). Never the deck, burn cards or undealt board cards. After the hand
// `revealedDeck` carries the viewer's shuffle proof, which opens only those same cards.
import { buildDeckProof } from "@poker-platform/shared/hands/deck-proof-node";
import type { HandView, TableSeatView, TableView } from "@poker-platform/shared/types";
import { publicCards } from "./hand-utils";
import type { Table } from "./table";

function iso(ms: number | null) {
  return ms === null ? null : new Date(ms).toISOString();
}

function buildHandView(table: Table, userId: string, now: number): HandView | null {
  const hand = table.hand;
  if (!hand) return null;
  const snapshot = hand.engine.snapshot();
  const seatOf = (id: string) => hand.dealt.find((d) => d.userId === id)?.seat ?? null;
  const complete = hand.completedAt !== null;
  void now;
  return {
    handId: hand.id,
    handNumber: hand.number,
    phase: complete ? "COMPLETE" : snapshot.phase,
    isBombPot: snapshot.isBombPot,
    boards: snapshot.boards.map((board) => publicCards(board)),
    runItTwice: snapshot.runs === 2,
    buttonSeat: snapshot.buttonSeat,
    smallBlindSeat: snapshot.smallBlindSeat,
    bigBlindSeat: snapshot.bigBlindSeat,
    straddleSeat: snapshot.straddleSeat,
    toActSeat: !complete && snapshot.status === "BETTING" && snapshot.toActPlayerId ? seatOf(snapshot.toActPlayerId) : null,
    actionDeadline: complete ? null : iso(hand.clock.deadline),
    usingTimeBank: !complete && hand.clock.usingBank,
    currentBet: complete ? 0 : snapshot.currentBet,
    pots: snapshot.pots.map((pot) => ({
      amount: pot.amount,
      eligibleSeats: pot.eligiblePlayerIds.map((id) => seatOf(id)).filter((s): s is number => s !== null),
    })),
    totalPot: snapshot.totalPot,
    result: complete ? hand.result : null,
    deckCommitment: hand.commitment,
    revealedDeck: complete ? deckProofFor(hand, snapshot, userId) : null,
  };
}

/**
 * The viewer's proof as JSON (format in packages/shared/src/hands/deck-proof.ts): opens every dealt board card,
 * the viewer's own hole cards (if dealt in) and shown hands; every other position is a leaf hash only.
 */
function deckProofFor(hand: NonNullable<Table["hand"]>, snapshot: ReturnType<NonNullable<Table["hand"]>["engine"]["snapshot"]>, userId: string) {
  const visible = new Set<string>(snapshot.boards.flat());
  for (const player of snapshot.players) {
    if (player.id === userId) for (const card of player.holeCards) visible.add(card);
  }
  for (const shown of hand.shown.values()) for (const card of shown.cards) visible.add(card);
  const proof = buildDeckProof(hand.reveal, visible);
  return proof ? JSON.stringify(proof) : null;
}

export function buildTableView(table: Table, userId: string, now: number): TableView {
  const hand = table.hand;
  const snapshot = hand?.engine.snapshot() ?? null;
  const complete = hand?.completedAt !== null && hand !== null;
  const viewerSeat = table.seatOf(userId);
  const nitRunning = table.nit.active && table.nit.roundRunning;

  const seats: TableSeatView[] = [...table.seats.values()]
    .sort((a, b) => a.seat - b.seat)
    .map((seat) => {
      const player = snapshot?.players.find((p) => p.id === seat.userId) ?? null;
      const inHand = player !== null;
      const shown = hand?.shown.get(seat.userId) ?? null;
      let holeCards = null;
      if (player && player.holeCards.length > 0) {
        if (seat.userId === userId) holeCards = publicCards(player.holeCards);
        else if (shown) holeCards = publicCards(shown.cards);
      }
      const live = inHand && !complete;
      return {
        seat: seat.seat,
        userId: seat.userId,
        username: seat.profile.username,
        displayName: seat.profile.displayName,
        avatarUrl: seat.profile.avatarUrl,
        stack: live ? player!.stack : seat.stack,
        bet: live ? player!.streetBet : 0,
        status: seat.status,
        connected: table.connected.has(seat.userId),
        inHand,
        folded: player?.folded ?? false,
        allIn: live ? player!.allIn : false,
        cardCount: player && !player.folded ? player.holeCards.length : 0,
        holeCards,
        lastAction: live ? player!.lastAction : null,
        timeBankSec: Math.floor(seat.timeBankMs / 1000),
        wantsStraddle: seat.wantsStraddle,
        isNit: nitRunning ? table.nit.nits.includes(seat.userId) : null,
        handName: shown?.handName ?? null,
      };
    });

  const legalActions =
    hand && !complete && viewerSeat && hand.engine.toActPlayerId === userId ? hand.engine.legalActions(userId) : null;
  const dealtIn = hand?.dealt.some((d) => d.userId === userId) ?? false;
  const resolvedCutoff = now - table.timings.resolvedVoteVisibleMs;
  const bomb = table.settings.bombPot;
  const handsUntilAutoBombPot =
    bomb.enabled && bomb.everyNHands > 0 ? Math.max(1, bomb.everyNHands - table.handsSinceBomb) : null;

  return {
    tableId: table.id,
    name: table.record.name,
    hostUserId: table.record.hostUserId,
    settings: table.settings,
    status: table.status(),
    seats,
    hand: buildHandView(table, userId, now),
    votes: table.votes
      .filter((vote) => vote.status === "OPEN" || (vote.resolvedAtMs ?? 0) >= resolvedCutoff)
      .map(({ createdAtMs: _c, expiresAtMs: _e, resolvedAtMs: _r, timer: _t, ...vote }) => ({
        ...vote,
        eligibleUserIds: [...vote.eligibleUserIds],
        yesUserIds: [...vote.yesUserIds],
        noUserIds: [...vote.noUserIds],
      })),
    sideGames: {
      nitGame: {
        active: table.nit.active,
        nitUserIds: [...table.nit.nits],
        participantUserIds: [...table.nit.participants],
      },
      bountyGame: { active: table.bountyActive },
      bombPotQueued: bomb.enabled && (table.bombPotQueued || handsUntilAutoBombPot === 1),
      handsUntilAutoBombPot,
    },
    log: table.log.slice(-60),
    nextHandAt: iso(table.nextHandAt),
    viewer: {
      userId,
      seat: viewerSeat?.seat ?? null,
      legalActions,
      canShowCards: Boolean(hand && complete && dealtIn && !hand.shown.has(userId) && !table.closing),
      walletBalance: table.balances.get(userId) ?? 0,
    },
    version: table.version,
    serverTime: new Date(now).toISOString(),
    lastEvent: table.lastEvent,
  };
}
