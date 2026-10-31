// Turns a redacted hand (HandView) into replay frames for the hand replayer. Pure and browser-safe.
import type { Street } from "@poker-platform/engine";
import type { HandView, StoredHandEvent } from "./types";

export type ReplaySeat = {
  userId: string;
  name: string;
  seat: number;
  position: string;
  stack: number;
  /** Chips in front of the player this street. */
  bet: number;
  folded: boolean;
  allIn: boolean;
  /** Known cards (viewer's own or shown), null when hidden. */
  cards: string[] | null;
  /** Cards face up on the table at this frame (shown at showdown / voluntarily, or the viewer's own). */
  revealed: boolean;
  lastAction: string | null;
  handName: string | null;
  /** Chips collected from pots so far in this hand. */
  collected: number;
  isViewer: boolean;
};

export type FrameKind = "start" | "post" | "deal" | "action" | "street" | "return" | "runout" | "showdown" | "award" | "side" | "show" | "end";

export type ReplayFrame = {
  index: number;
  kind: FrameKind;
  street: Street;
  /** Boards dealt so far (board 0 first). */
  boards: string[][];
  /** All chips in the middle (pots + bets in front of players). */
  pot: number;
  seats: ReplaySeat[];
  /** User the event is about (highlighted seat). */
  actorId: string | null;
  /** Plain-English line for the action list. */
  text: string;
  /** Text tone for the action list. */
  tone: "neutral" | "accent" | "danger" | "gold" | "muted";
  /** True from the moment the action closed with players all-in (EV is shown). */
  allIn: boolean;
};

const STREET_LABEL: Record<Street, string> = { PREFLOP: "Preflop", FLOP: "Flop", TURN: "Turn", RIVER: "River" };

export function streetLabel(street: Street): string {
  return STREET_LABEL[street];
}

const SIDE_LABEL = { NIT_GAME: "nit game penalty", BOUNTY_7_2: "7-2 bounty" } as const;

/** Street of the last action when the remaining board was dealt without further action (all-in), else null. */
export function allInClosingStreet(events: readonly StoredHandEvent[]): Street | null {
  let lastAction = -1;
  for (let i = 0; i < events.length; i++) if (events[i]!.type === "ACTION") lastAction = i;
  if (lastAction < 0) return null;
  const after = events.slice(lastAction + 1);
  if (!after.some((e) => e.type === "STREET")) return null;
  const action = events[lastAction]!;
  return action.type === "ACTION" ? action.street : null;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

export function buildReplayFrames(view: HandView): ReplayFrame[] {
  const players = new Map(view.players.map((p) => [p.userId, p]));
  const nameOf = (id: string) => (id === view.viewerId ? "You" : (players.get(id)?.displayName ?? "Player"));
  /** "You fold" / "Ann folds": `you` is the second-person verb, `they` the third-person one. */
  const says = (id: string, you: string, they: string) => `${nameOf(id)} ${id === view.viewerId ? you : they}`;
  const seats = new Map<string, ReplaySeat>();
  for (const p of view.players) {
    seats.set(p.userId, {
      userId: p.userId,
      name: p.isViewer ? "You" : p.displayName,
      seat: p.seat,
      position: p.position,
      stack: p.startingStack,
      bet: 0,
      folded: false,
      allIn: false,
      cards: p.holeCards,
      revealed: p.isViewer && p.holeCards !== null,
      lastAction: null,
      handName: null,
      collected: 0,
      isViewer: p.isViewer,
    });
  }
  const frames: ReplayFrame[] = [];
  let street: Street = "PREFLOP";
  const boards: string[][] = [];
  let pot = 0;
  let allIn = false;
  const allInStreet = allInClosingStreet(view.events);
  let lastActionIndex = -1;
  view.events.forEach((e, i) => {
    if (e.type === "ACTION") lastActionIndex = i;
  });

  const push = (kind: FrameKind, actorId: string | null, text: string, tone: ReplayFrame["tone"] = "neutral") => {
    frames.push({
      index: frames.length,
      kind,
      street,
      boards: boards.map((b) => b.slice()),
      pot,
      seats: [...seats.values()].sort((a, b) => a.seat - b.seat).map((s) => ({ ...s, cards: s.cards ? s.cards.slice() : null })),
      actorId,
      text,
      tone,
      allIn,
    });
  };

  view.events.forEach((event, i) => {
    switch (event.type) {
      case "HAND_START": {
        const stakes = `${fmt(event.smallBlind)}/${fmt(event.bigBlind)}`;
        push("start", null, view.isBombPot ? `Bomb pot at ${stakes}` : `Hand #${view.handNumber} at ${stakes}`, "muted");
        break;
      }
      case "POST": {
        const s = seats.get(event.playerId);
        if (s) {
          s.stack = event.stackAfter;
          if (event.kind === "ANTE" || event.kind === "BOMB_POT_ANTE") {
            // Antes go straight to the pot.
          } else {
            s.bet += event.amount;
          }
          s.allIn = event.allIn;
          s.lastAction = event.kind === "SMALL_BLIND" ? "SB" : event.kind === "BIG_BLIND" ? "BB" : event.kind === "STRADDLE" ? "Straddle" : "Ante";
        }
        pot += event.amount;
        const what =
          event.kind === "SMALL_BLIND"
            ? "posts the small blind"
            : event.kind === "BIG_BLIND"
              ? "posts the big blind"
              : event.kind === "STRADDLE"
                ? "straddles"
                : event.kind === "EXTRA_BLIND"
                  ? "posts a blind"
                  : "antes";
        push("post", event.playerId, `${says(event.playerId, what.replace(/^posts/, "post").replace(/^straddles/, "straddle").replace(/^antes/, "ante"), what)} ${fmt(event.amount)}`, "muted");
        break;
      }
      case "HOLE_CARDS": {
        const mine = event.hands.find((h) => h.playerId === view.viewerId);
        push("deal", view.viewerId, mine ? `You are dealt ${mine.cards.join(" ")}` : "Cards are dealt", "muted");
        break;
      }
      case "ACTION": {
        const s = seats.get(event.playerId);
        if (s) {
          s.stack = event.stackAfter;
          s.bet = event.to;
          s.allIn = event.allIn;
          if (event.action === "fold") s.folded = true;
        }
        pot = event.potAfter;
        const allInText = event.allIn ? (event.playerId === view.viewerId ? " and are all-in" : " and is all-in") : "";
        let text: string;
        let label: string;
        switch (event.action) {
          case "fold":
            text = says(event.playerId, "fold", "folds");
            label = "Fold";
            break;
          case "check":
            text = says(event.playerId, "check", "checks");
            label = "Check";
            break;
          case "call":
            text = `${says(event.playerId, "call", "calls")} ${fmt(event.amount)}${allInText}`;
            label = event.allIn ? "All-in" : "Call";
            break;
          case "bet":
            text = `${says(event.playerId, "bet", "bets")} ${fmt(event.to)}${allInText}`;
            label = event.allIn ? "All-in" : "Bet";
            break;
          default:
            text = `${says(event.playerId, "raise", "raises")} to ${fmt(event.to)}${allInText}`;
            label = event.allIn ? "All-in" : "Raise";
        }
        if (event.reason === "timeout") text += " (timed out)";
        if (event.reason === "left") text += " (left the table)";
        if (s) s.lastAction = label;
        if (allInStreet && i === lastActionIndex) allIn = true;
        push("action", event.playerId, text, event.action === "fold" ? "muted" : "neutral");
        break;
      }
      case "STREET": {
        street = event.street;
        for (const s of seats.values()) {
          s.bet = 0;
          if (!s.folded && !s.allIn) s.lastAction = null;
        }
        boards[event.boardIndex] = event.board.slice();
        const boardText = boards.length > 1 || event.boardIndex > 0 ? ` (board ${event.boardIndex + 1})` : "";
        push("street", null, `${STREET_LABEL[event.street]}${boardText}: ${event.cards.join(" ")}`, "gold");
        break;
      }
      case "UNCALLED_RETURN": {
        const s = seats.get(event.playerId);
        if (s) {
          s.stack += event.amount;
          s.bet = Math.max(0, s.bet - event.amount);
        }
        pot -= event.amount;
        push("return", event.playerId, `Uncalled ${fmt(event.amount)} returned to ${event.playerId === view.viewerId ? "you" : nameOf(event.playerId)}`, "muted");
        break;
      }
      case "RUNOUT_DECISION":
        allIn = true;
        push("runout", null, "Everyone is all-in", "muted");
        break;
      case "RUNOUT":
        push("runout", null, event.runs === 2 ? "Running it twice" : "Running it once", "muted");
        break;
      case "SHOWDOWN": {
        for (const s of seats.values()) s.bet = 0;
        const shownIds = new Set(event.hands.map((h) => h.playerId));
        for (const h of event.hands) {
          const s = seats.get(h.playerId);
          if (!s) continue;
          s.cards = h.cards.slice();
          s.revealed = true;
          s.handName = h.boards[0]?.name ?? null;
          const name = h.boards.map((b) => b.name).join(" / ");
          push("showdown", h.playerId, `${says(h.playerId, "show", "shows")} ${h.cards.join(" ")}${name ? ` (${name})` : ""}`);
        }
        for (const id of event.order) {
          if (shownIds.has(id)) continue;
          push("showdown", id, says(id, "muck", "mucks"), "muted");
        }
        break;
      }
      case "POT_AWARD": {
        for (const s of seats.values()) s.bet = 0;
        const potName = event.potIndex === 0 ? "the main pot" : `side pot ${event.potIndex}`;
        const boardText = boards.length > 1 ? ` (board ${event.boardIndex + 1})` : "";
        for (const w of event.winners) {
          const s = seats.get(w.playerId);
          if (s) {
            s.stack += w.amount;
            s.collected += w.amount;
          }
          pot -= w.amount;
          push(
            "award",
            w.playerId,
            `${nameOf(w.playerId)} ${w.playerId === view.viewerId ? "win" : "wins"} ${fmt(w.amount)} from ${potName}${boardText}${w.handName ? ` with ${w.handName}` : ""}`,
            "accent",
          );
        }
        break;
      }
      case "SHOW": {
        const s = seats.get(event.playerId);
        if (s) {
          s.cards = event.cards.slice();
          s.revealed = true;
        }
        push("show", event.playerId, `${nameOf(event.playerId)} ${event.playerId === view.viewerId ? "show" : "shows"} ${event.cards.join(" ")}`);
        break;
      }
      case "SIDE_PAYMENT": {
        const from = seats.get(event.fromUserId);
        const to = seats.get(event.toUserId);
        if (from) from.stack -= event.amount;
        if (to) to.stack += event.amount;
        const payer = players.has(event.fromUserId) ? nameOf(event.fromUserId) : "A player";
        const payee = players.has(event.toUserId) ? nameOf(event.toUserId) : "a player";
        push(
          "side",
          event.toUserId,
          `${payer} ${event.fromUserId === view.viewerId ? "pay" : "pays"} ${fmt(event.amount)} to ${payee === "You" ? "you" : payee} (${SIDE_LABEL[event.reason]})`,
          event.fromUserId === view.viewerId ? "danger" : event.toUserId === view.viewerId ? "accent" : "gold",
        );
        break;
      }
      case "HAND_END": {
        for (const st of event.stacks) {
          const s = seats.get(st.playerId);
          if (s) s.stack = st.stack;
        }
        pot = 0;
        break;
      }
      default:
        break;
    }
  });
  // Final frame: settled stacks including side payments (HandPlayer.endingStack).
  for (const s of seats.values()) {
    const p = players.get(s.userId);
    if (p) s.stack = p.endingStack;
  }
  pot = 0;
  push("end", null, "Hand complete", "muted");
  return frames;
}

/** Points where equity is meaningful: every live player's cards are known (>= 2 players), per street reached. */
export type EquitySpot = { frameIndex: number; street: Street; board: string[]; playerIds: string[]; hands: string[][] };

export function equitySpots(frames: readonly ReplayFrame[]): EquitySpot[] {
  const spots: EquitySpot[] = [];
  const seen = new Set<string>();
  // Run it twice / double board: a single-board equity is only meaningful up to the all-in moment.
  const multiBoard = (frames[frames.length - 1]?.boards.length ?? 0) > 1;
  for (const f of frames) {
    if (f.kind !== "deal" && f.kind !== "street" && f.kind !== "action") continue;
    if (f.boards.length > 1 || (multiBoard && f.allIn && f.kind !== "action")) continue;
    const board = f.boards[0] ?? [];
    if (board.length >= 5) continue;
    const live = f.seats.filter((s) => !s.folded);
    if (live.length < 2 || live.some((s) => !s.cards || s.cards.length === 0)) continue;
    const key = `${f.street}:${board.join("")}:${live.map((s) => s.userId).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    spots.push({ frameIndex: f.index, street: f.street, board: board.slice(), playerIds: live.map((s) => s.userId), hands: live.map((s) => s.cards!.slice()) });
  }
  return spots;
}
