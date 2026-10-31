// Export a (redacted) hand as PokerStars play-money hand-history text, which PokerTracker 4, Hand2Note and
// GTO Wizard import. Only cards the viewer can see are written (their own "Dealt to" line, shown hands).
// Side-game payments (nit / 7-2) have no PokerStars equivalent and are left out.
import type { ActionEvent, Street } from "@poker-platform/engine";
import type { HandView, HandViewPlayer } from "./types";

const STREET_TITLE: Record<Exclude<Street, "PREFLOP">, string> = { FLOP: "FLOP", TURN: "TURN", RIVER: "RIVER" };
const STREET_NAME: Record<Street, string> = { PREFLOP: "Flop", FLOP: "Flop", TURN: "Turn", RIVER: "River" };

/** Stable 15-digit numeric id from the hand id (PokerStars hand numbers are numeric). */
export function numericHandId(id: string): string {
  // Two independent 32-bit FNV-1a style hashes -> 15 digits.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  const n = (BigInt(h1) << 20n) ^ BigInt(h2 & 0xfffff);
  return (100_000_000_000_000n + (n % 899_999_999_999_999n)).toString();
}

function playerName(p: HandViewPlayer): string {
  return (p.username ?? p.displayName ?? `seat${p.seat}`).replace(/[\s:'[\]()]/g, "_");
}

function etTimestamp(iso: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ET`;
}

function seatNumber(view: HandView, seat: number): number {
  // PokerStars seats are 1-based.
  const min = Math.min(...view.players.map((p) => p.seat));
  return min <= 0 ? seat + 1 : seat;
}

function maxSeats(view: HandView): number {
  const top = Math.max(...view.players.map((p) => seatNumber(view, p.seat)));
  return top <= 2 ? 2 : top <= 6 ? 6 : top <= 9 ? 9 : 10;
}

/** One hand as PokerStars text. */
export function handToPokerStars(view: HandView, options: { siteName?: string } = {}): string {
  const byId = new Map(view.players.map((p) => [p.userId, p]));
  const name = (id: string) => {
    const p = byId.get(id);
    return p ? playerName(p) : "unknown";
  };
  const game = view.variant === "PLO" ? "Omaha Pot Limit" : "Hold'em No Limit";
  const out: string[] = [];
  out.push(`PokerStars Hand #${numericHandId(view.id)}:  ${game} (${view.smallBlind}/${view.bigBlind}) - ${etTimestamp(view.startedAt)}`);
  // ASCII only: some trackers choke on other characters in the table name.
  const table = `${options.siteName ?? "Felt"} ${view.tableName}`
    .replace(/[^A-Za-z0-9 /#.,_-]+/g, "-")
    .replace(/\s*-\s*(-\s*)*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
  out.push(`Table '${table}' ${maxSeats(view)}-max Seat #${seatNumber(view, view.buttonSeat)} is the button`);
  for (const p of view.players) out.push(`Seat ${seatNumber(view, p.seat)}: ${playerName(p)} (${p.startingStack} in chips)`);

  const twoBoards = view.boards.length > 1;
  const folded = new Map<string, Street>();
  const putIn = new Map<string, number>();
  const collected = new Map<string, number>();
  const showLines: string[][] = [[], []];
  const shownCards = new Map<string, { cards: string[]; names: string[] }>();
  const streetsShown = new Set<string>();
  let dealtPrinted = false;
  let preHole: string[] = [];
  const body: string[] = [];

  const printDealt = () => {
    if (dealtPrinted) return;
    dealtPrinted = true;
    out.push(...preHole);
    out.push("*** HOLE CARDS ***");
    const me = byId.get(view.viewerId);
    if (me?.holeCards && me.holeCards.length > 0) out.push(`Dealt to ${playerName(me)} [${me.holeCards.join(" ")}]`);
  };

  for (const event of view.events) {
    switch (event.type) {
      case "POST": {
        putIn.set(event.playerId, (putIn.get(event.playerId) ?? 0) + event.amount);
        const who = name(event.playerId);
        const allIn = event.allIn ? " and is all-in" : "";
        if (event.kind === "SMALL_BLIND") preHole.push(`${who}: posts small blind ${event.amount}${allIn}`);
        else if (event.kind === "BIG_BLIND" || event.kind === "EXTRA_BLIND") preHole.push(`${who}: posts big blind ${event.amount}${allIn}`);
        else if (event.kind === "STRADDLE") preHole.push(`${who}: posts straddle ${event.amount}${allIn}`);
        else preHole.push(`${who}: posts the ante ${event.amount}${allIn}`);
        break;
      }
      case "HOLE_CARDS":
        printDealt();
        break;
      case "ACTION": {
        printDealt();
        const a = event as ActionEvent;
        putIn.set(a.playerId, (putIn.get(a.playerId) ?? 0) + a.amount);
        const who = name(a.playerId);
        const allIn = a.allIn ? " and is all-in" : "";
        if (a.action === "fold") {
          folded.set(a.playerId, a.street);
          out.push(`${who}: folds`);
        } else if (a.action === "check") out.push(`${who}: checks`);
        else if (a.action === "call") out.push(`${who}: calls ${a.amount}${allIn}`);
        else if (a.action === "bet") out.push(`${who}: bets ${a.amount}${allIn}`);
        else {
          const before = a.to - a.amount; // my street bet before acting
          const currentBefore = before + a.facingAmount;
          out.push(`${who}: raises ${a.to - currentBefore} to ${a.to}${allIn}`);
        }
        break;
      }
      case "STREET": {
        printDealt();
        const key = `${event.boardIndex}:${event.street}`;
        if (streetsShown.has(key)) break;
        streetsShown.add(key);
        const prefix = twoBoards ? (event.boardIndex === 0 ? "FIRST " : "SECOND ") : "";
        const title = `${prefix}${STREET_TITLE[event.street]}`;
        if (event.street === "FLOP") out.push(`*** ${title} *** [${event.board.join(" ")}]`);
        else out.push(`*** ${title} *** [${event.board.slice(0, -1).join(" ")}] [${event.board[event.board.length - 1]}]`);
        break;
      }
      case "UNCALLED_RETURN":
        putIn.set(event.playerId, (putIn.get(event.playerId) ?? 0) - event.amount);
        out.push(`Uncalled bet (${event.amount}) returned to ${name(event.playerId)}`);
        break;
      case "SHOWDOWN":
        for (const h of event.hands) {
          shownCards.set(h.playerId, { cards: h.cards, names: h.boards.map((b) => b.name) });
          h.boards.forEach((b) => {
            const lines = showLines[b.boardIndex] ?? showLines[0]!;
            lines.push(`${name(h.playerId)}: shows [${h.cards.join(" ")}] (${b.name})`);
          });
          if (h.boards.length === 0) showLines[0]!.push(`${name(h.playerId)}: shows [${h.cards.join(" ")}]`);
        }
        for (const id of event.order) if (!shownCards.has(id)) showLines[0]!.push(`${name(id)}: mucks hand`);
        break;
      case "SHOW":
        if (!shownCards.has(event.playerId)) {
          shownCards.set(event.playerId, { cards: event.cards, names: [] });
          body.push(`${name(event.playerId)}: shows [${event.cards.join(" ")}]`);
        }
        break;
      case "POT_AWARD":
        for (const w of event.winners) {
          collected.set(w.playerId, (collected.get(w.playerId) ?? 0) + w.amount);
          const potName = view.pots.length > 1 ? (event.potIndex === 0 ? "main pot" : `side pot-${event.potIndex}`) : "pot";
          const line = `${name(w.playerId)} collected ${w.amount} from ${potName}`;
          const lines = showLines[twoBoards ? event.boardIndex : 0] ?? showLines[0]!;
          lines.push(line);
        }
        break;
      default:
        break;
    }
  }
  printDealt();

  const hadShowdown = view.events.some((e) => e.type === "SHOWDOWN");
  if (hadShowdown) {
    if (twoBoards) {
      out.push("*** FIRST SHOW DOWN ***", ...showLines[0]!, "*** SECOND SHOW DOWN ***", ...showLines[1]!);
    } else {
      out.push("*** SHOW DOWN ***", ...showLines[0]!);
    }
  } else {
    out.push(...showLines[0]!, ...showLines[1]!);
  }
  out.push(...body);

  out.push("*** SUMMARY ***");
  out.push(`Total pot ${view.totalPot} | Rake 0`);
  if (twoBoards) {
    out.push(view.runItTwice ? "Hand was run twice" : "Hand was played on two boards");
    view.boards.forEach((b, i) => out.push(`${i === 0 ? "FIRST" : "SECOND"} Board [${b.join(" ")}]`));
  } else if ((view.boards[0] ?? []).length > 0) {
    out.push(`Board [${view.boards[0]!.join(" ")}]`);
  }
  for (const p of view.players) {
    const tag =
      p.seat === view.buttonSeat ? " (button)" : p.position === "SB" ? " (small blind)" : p.position === "BB" ? " (big blind)" : "";
    let line = `Seat ${seatNumber(view, p.seat)}: ${playerName(p)}${tag}`;
    const won = collected.get(p.userId) ?? 0;
    const foldStreet = folded.get(p.userId);
    const shown = shownCards.get(p.userId);
    if (foldStreet) {
      line += foldStreet === "PREFLOP" ? ` folded before Flop${(putIn.get(p.userId) ?? 0) > 0 ? "" : " (didn't bet)"}` : ` folded on the ${STREET_NAME[foldStreet]}`;
    } else if (hadShowdown && shown) {
      const with_ = shown.names[0] ? ` with ${shown.names[0]}` : "";
      line += ` showed [${shown.cards.join(" ")}] and ${won > 0 ? `won (${won})` : "lost"}${with_}`;
    } else if (won > 0) {
      line += ` collected (${won})`;
    } else if (hadShowdown) {
      line += " mucked";
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Several hands separated the way PokerStars writes files (two blank lines). */
export function handsToPokerStars(views: readonly HandView[], options: { siteName?: string } = {}): string {
  return views.map((v) => handToPokerStars(v, options)).join("\n\n\n") + (views.length > 0 ? "\n\n\n" : "");
}
