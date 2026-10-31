import type { TableView } from "@poker-platform/shared/types";

/**
 * What the viewer did between sitting down and standing up (or being cashed out). Built from the
 * views this tab saw: each hand's result is the stack after the hand minus the stack before it
 * (the last stack seen between hands), so top-ups between hands never count as winnings.
 */
export type SeatSession = {
  tableId: string;
  userId: string;
  startedAt: number;
  handsPlayed: number;
  net: number;
  biggestPotWon: number;
  /** Stack between hands (after the last result / top-up). null until one is seen. */
  idleStack: number | null;
  /** The hand in progress the viewer was dealt into, with the stack before it. */
  live: { handId: string; startStack: number | null } | null;
  /** Hands already counted (by id), newest last. */
  counted: string[];
  /** Last stack seen while seated (what is cashed out when the viewer stands up). */
  lastStack: number;
};

export type SessionResult = Pick<SeatSession, "handsPlayed" | "net" | "biggestPotWon" | "startedAt"> & {
  endedAt: number;
  bigBlind: number;
};

/** Folds one view into the session. */
export function advanceSession(prev: SeatSession, view: TableView): SeatSession {
  const me = view.seats.find((s) => s.seat === view.viewer.seat);
  if (!me) return prev;
  const hand = view.hand;
  let next: SeatSession = { ...prev, lastStack: me.stack };

  if (hand && !hand.result) {
    if (next.live?.handId !== hand.handId) {
      next.live = me.inHand && !next.counted.includes(hand.handId) ? { handId: hand.handId, startStack: next.idleStack } : null;
    }
    return next;
  }

  // Between hands, or a hand that just finished.
  if (hand?.result && next.live?.handId === hand.handId && !next.counted.includes(hand.handId)) {
    const start = next.live.startStack;
    const won = hand.result.winners.filter((w) => w.seat === me.seat).reduce((n, w) => n + w.amount, 0);
    if (start !== null) {
      next = {
        ...next,
        handsPlayed: next.handsPlayed + 1,
        net: next.net + (me.stack - start),
        biggestPotWon: Math.max(next.biggestPotWon, won),
      };
    }
    next.counted = [...next.counted, hand.handId].slice(-50);
    next.live = null;
  }
  next.idleStack = me.stack + me.bet;
  return next;
}

/** Closes a session when the viewer leaves the seat: a hand abandoned mid-way counts as played. */
export function closeSession(s: SeatSession): SeatSession {
  if (s.live && s.live.startStack !== null) {
    return { ...s, handsPlayed: s.handsPlayed + 1, net: s.net + (s.lastStack - s.live.startStack), live: null };
  }
  return s;
}

