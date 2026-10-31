// The one place that decides which hole cards a viewer may see in a stored hand.
//
// Rules: a viewer sees their own hole cards in any hand they played; other players' cards only when that
// player showed them (HandPlayer.shown: forced at showdown or shown voluntarily). Spectators (and players
// viewing a shared link to a hand they were not in) see shown cards only. Events with unknown types are
// dropped so new private events can never leak by default.
import type { StoredHandEvent } from "./types";

export type RedactablePlayer = {
  userId: string;
  holeCards: unknown;
  shown: boolean;
  allInEvNet: number | null;
};

const PUBLIC_EVENT_TYPES = new Set([
  "HAND_START",
  "POST",
  "ACTION",
  "STREET",
  "UNCALLED_RETURN",
  "RUNOUT_DECISION",
  "RUNOUT",
  "POT_AWARD",
  "HAND_END",
  "SIDE_PAYMENT",
  "SHOW",
]);

function asCards(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((c): c is string => typeof c === "string") : [];
}

/** Ids of the players whose cards `viewerId` may see. */
export function visibleCardOwners(players: readonly RedactablePlayer[], viewerId: string | null): Set<string> {
  return new Set(players.filter((p) => p.shown || (viewerId !== null && p.userId === viewerId)).map((p) => p.userId));
}

export type RedactedHand<P extends RedactablePlayer> = {
  players: Array<Omit<P, "holeCards"> & { holeCards: string[] | null }>;
  events: StoredHandEvent[];
};

/**
 * Returns copies of `players` and `events` with every card the viewer may not see removed:
 * - players[].holeCards -> null and allInEvNet -> null unless visible;
 * - HOLE_CARDS keeps only visible players; SHOWDOWN keeps only visible hands (mucked hands disappear);
 * - POT_AWARD hand names of hidden players are cleared.
 */
export function redactHandForViewer<P extends RedactablePlayer>(
  players: readonly P[],
  events: unknown,
  viewerId: string | null,
): RedactedHand<P> {
  const visible = visibleCardOwners(players, viewerId);
  const outPlayers = players.map((p) => ({
    ...p,
    holeCards: visible.has(p.userId) ? asCards(p.holeCards) : null,
    allInEvNet: visible.has(p.userId) ? p.allInEvNet : null,
  }));

  const list = Array.isArray(events) ? (events as Array<{ type?: unknown }>) : [];
  const outEvents: StoredHandEvent[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as StoredHandEvent;
    if (event.type === "HOLE_CARDS") {
      outEvents.push({
        ...event,
        hands: event.hands.filter((h) => visible.has(h.playerId)).map((h) => ({ ...h, cards: h.cards.slice() })),
      });
    } else if (event.type === "SHOWDOWN") {
      outEvents.push({
        ...event,
        hands: event.hands.filter((h) => visible.has(h.playerId)).map((h) => ({ ...h, cards: h.cards.slice() })),
      });
    } else if (event.type === "POT_AWARD") {
      outEvents.push({
        ...event,
        winners: event.winners.map((w) => (visible.has(w.playerId) ? { ...w } : { ...w, handName: null })),
      });
    } else if (event.type === "SHOW") {
      // HandPlayer.shown is the source of truth; a SHOW event without it is ignored.
      if (visible.has(event.playerId)) outEvents.push({ ...event, cards: event.cards.slice() });
    } else if (PUBLIC_EVENT_TYPES.has(event.type as string)) {
      outEvents.push(structuredClone(event));
    }
  }
  return { players: outPlayers, events: outEvents };
}
