// A small, deliberately simplified poker simulator used only by the /dev/table playground so the
// table UI can be exercised end to end without the game server. It is NOT the real engine:
// hand strength is random, side pots are not recomputed, and rules are only as strict as the UI
// needs. Everything here operates on the public TableView contract.
import type {
  Ack,
  ActionType,
  HandResultView,
  LegalActions,
  PotView,
  PublicCard,
  TableLogEntry,
  TableSeatView,
  TableView,
  TableVote,
  VoteKind,
} from "@poker-platform/shared/types";
import { formatChips, SUIT_SYMBOL, RANK_LABEL } from "./format";

export type MockState = {
  view: TableView;
  acted: number[];
  lastRaise: number;
  deck: PublicCard[];
  hidden: Record<number, PublicCard[]>;
  turnStartedAt: number;
  turnKey: string;
  resolvedAt: Record<string, number>;
  /** Bots only start acting after the viewer's first command (or when forced on). */
  live: boolean;
};

type Result = { state: MockState; ack: Ack };

const RANKS: PublicCard["rank"][] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS: PublicCard["suit"][] = ["c", "d", "h", "s"];
const HAND_NAMES = [
  "Pair of Aces",
  "Two Pair, Queens and Nines",
  "Three of a Kind, Fives",
  "Straight, Ten high",
  "Flush, King high",
  "Pair of Jacks",
  "Full House, Eights full of Threes",
  "High Card, Ace",
];

const ok: Ack = { ok: true, data: undefined };
const err = (code: string, message: string): Ack => ({ ok: false, code, message });

const key = (card: PublicCard) => `${card.rank}${card.suit}`;
const show = (card: PublicCard) => `${RANK_LABEL[card.rank]}${SUIT_SYMBOL[card.suit]}`;

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function freshDeck(exclude: PublicCard[] = []): PublicCard[] {
  const used = new Set(exclude.map(key));
  const all: PublicCard[] = [];
  for (const rank of RANKS) for (const suit of SUITS) if (!used.has(`${rank}${suit}`)) all.push({ rank, suit });
  return shuffle(all);
}

const holeCount = (view: TableView) => (view.settings.variant === "PLO" ? 4 : 2);
const sorted = (seats: TableSeatView[]) => [...seats].sort((a, b) => a.seat - b.seat);
const canAct = (s: TableSeatView) => s.inHand && !s.folded && !s.allIn;
const contenders = (view: TableView) => view.seats.filter((s) => s.inHand && !s.folded);

/** Seats in clockwise order starting after `from`. */
function after(view: TableView, from: number): TableSeatView[] {
  const list = sorted(view.seats);
  const idx = list.findIndex((s) => s.seat > from);
  return idx < 0 ? list : [...list.slice(idx), ...list.slice(0, idx)];
}

let seq = 0;
function addLog(view: TableView, kind: TableLogEntry["kind"], text: string): TableLogEntry[] {
  seq += 1;
  return [
    ...view.log,
    { id: `m${seq}-${Date.now()}`, handNumber: view.hand?.handNumber ?? null, at: new Date().toISOString(), kind, text },
  ].slice(-120);
}

function nameOf(view: TableView, seat: number) {
  return view.seats.find((s) => s.seat === seat)?.displayName ?? `Seat ${seat}`;
}

export function initMockState(view: TableView): MockState {
  const known: PublicCard[] = [
    ...(view.hand?.boards.flat() ?? []),
    ...view.seats.flatMap((s) => s.holeCards ?? []),
    ...(view.hand?.result?.shown.flatMap((s) => s.cards) ?? []),
  ];
  let deck = freshDeck(known);
  const hidden: Record<number, PublicCard[]> = {};
  for (const s of view.seats) {
    if (s.inHand && !s.holeCards && s.cardCount > 0) {
      hidden[s.seat] = deck.slice(0, s.cardCount);
      deck = deck.slice(s.cardCount);
    }
  }
  const streetActions = new Set(["check", "call", "bet", "raise", "allin"]);
  return {
    view,
    acted: view.seats.filter((s) => s.lastAction && streetActions.has(s.lastAction.type)).map((s) => s.seat),
    // Recover the last raise size from the fixture's legal actions when present.
    lastRaise:
      view.viewer.legalActions && view.hand && view.viewer.legalActions.minTo > view.hand.currentBet
        ? Math.max(view.settings.bigBlind, view.viewer.legalActions.minTo - view.hand.currentBet)
        : view.settings.bigBlind,
    deck,
    hidden,
    turnStartedAt: Date.now(),
    turnKey: turnKeyOf(view),
    resolvedAt: {},
    live: false,
  };
}

export function legalFor(state: MockState, seatNo: number): LegalActions | null {
  const { view } = state;
  const hand = view.hand;
  const s = view.seats.find((x) => x.seat === seatNo);
  if (!hand || !s || hand.toActSeat !== seatNo || hand.phase === "COMPLETE" || !canAct(s)) return null;
  const toCall = Math.min(Math.max(0, hand.currentBet - s.bet), s.stack);
  const maxStack = s.stack + s.bet;
  const othersCanAct = view.seats.some((x) => x.seat !== seatNo && canAct(x));
  const potAfterCall = hand.totalPot + toCall;
  const potTo = Math.min(hand.currentBet + potAfterCall, maxStack);
  const isPlo = view.settings.variant === "PLO";
  const maxTo = isPlo ? potTo : maxStack;
  const minTo = Math.min(hand.currentBet + Math.max(state.lastRaise, view.settings.bigBlind), maxStack);
  return {
    canFold: true,
    canCheck: toCall === 0,
    callAmount: toCall,
    canBetOrRaise: maxStack > hand.currentBet && othersCanAct,
    isBet: hand.currentBet === 0,
    minTo: Math.min(minTo, maxTo),
    maxTo,
    potTo: Math.min(potTo, maxTo),
  };
}

function turnKeyOf(view: TableView): string {
  const h = view.hand;
  return h ? `${h.handId}:${h.phase}:${h.toActSeat ?? "-"}:${h.currentBet}` : "-";
}

/** Recomputes viewer-derived fields and bumps version; call after every mutation. */
function finalize(state: MockState, ev?: TableView["lastEvent"]): MockState {
  const v = state.view;
  const viewerSeat = v.seats.find((s) => s.userId === v.viewer.userId) ?? null;
  const view: TableView = {
    ...v,
    version: v.version + 1,
    serverTime: new Date().toISOString(),
    lastEvent: ev ?? v.lastEvent,
    viewer: {
      ...v.viewer,
      seat: viewerSeat?.seat ?? null,
      legalActions: viewerSeat ? legalFor(state, viewerSeat.seat) : null,
    },
  };
  const turnKey = turnKeyOf(view);
  return { ...state, view, turnKey, turnStartedAt: turnKey === state.turnKey ? state.turnStartedAt : Date.now() };
}

function setSeat(view: TableView, seatNo: number, patch: Partial<TableSeatView>): TableView {
  return { ...view, seats: view.seats.map((s) => (s.seat === seatNo ? { ...s, ...patch } : s)) };
}

function deadline(view: TableView, seconds?: number) {
  return new Date(Date.now() + (seconds ?? view.settings.actionTimeSec) * 1000).toISOString();
}

// ---------------------------------------------------------------------------------------------
// Betting

export function applyAction(state: MockState, seatNo: number, type: ActionType, amount?: number): Result {
  const legal = legalFor(state, seatNo);
  if (!legal) return { state, ack: err("NOT_YOUR_TURN", "It's not your turn.") };
  let view = state.view;
  const hand = view.hand!;
  const s = view.seats.find((x) => x.seat === seatNo)!;
  let acted = [...state.acted, seatNo];
  let lastRaise = state.lastRaise;
  let currentBet = hand.currentBet;
  let label: string;

  if (type === "fold") {
    view = setSeat(view, seatNo, { folded: true, lastAction: { type: "fold", amount: null } });
    label = `${s.displayName} folds`;
  } else if (type === "check") {
    if (!legal.canCheck) return { state, ack: err("ILLEGAL", "You can't check, there's a bet to call.") };
    view = setSeat(view, seatNo, { lastAction: { type: "check", amount: null } });
    label = `${s.displayName} checks`;
  } else if (type === "call") {
    const pay = legal.callAmount;
    const allIn = pay >= s.stack;
    view = setSeat(view, seatNo, {
      stack: s.stack - pay,
      bet: s.bet + pay,
      allIn,
      lastAction: { type: allIn ? "allin" : "call", amount: s.bet + pay },
    });
    label = `${s.displayName} ${allIn ? "calls all-in" : "calls"} ${formatChips(pay)}`;
  } else {
    const target = type === "allin" ? s.stack + s.bet : Math.round(amount ?? 0);
    if (!legal.canBetOrRaise && type !== "allin") return { state, ack: err("ILLEGAL", "You can't raise here.") };
    if (target > legal.maxTo || (target < legal.minTo && target < s.stack + s.bet)) {
      return {
        state,
        ack: err("BAD_AMOUNT", `Amount must be between ${formatChips(legal.minTo)} and ${formatChips(legal.maxTo)}.`),
      };
    }
    const pay = target - s.bet;
    const allIn = pay >= s.stack;
    const kind: ActionType = allIn ? "allin" : legal.isBet ? "bet" : "raise";
    view = setSeat(view, seatNo, { stack: s.stack - pay, bet: target, allIn, lastAction: { type: kind, amount: target } });
    if (target > currentBet) {
      lastRaise = Math.max(lastRaise, target - currentBet);
      currentBet = target;
      acted = [seatNo];
    }
    label = `${s.displayName} ${allIn ? "goes all-in for" : legal.isBet ? "bets" : "raises to"} ${formatChips(target)}`;
  }

  const added = view.seats.find((x) => x.seat === seatNo)!.bet - s.bet;
  view = {
    ...view,
    hand: { ...hand, currentBet, totalPot: hand.totalPot + added, usingTimeBank: false },
    log: addLog(view, "action", label),
  };
  // Time bank bookkeeping: whatever was left of the bank when acting is kept.
  if (hand.usingTimeBank && hand.actionDeadline) {
    const left = Math.max(0, Math.round((Date.parse(hand.actionDeadline) - Date.now()) / 1000));
    view = setSeat(view, seatNo, { timeBankSec: left });
  }
  let next: MockState = { ...state, view, acted, lastRaise };
  next = advance(next, seatNo);
  return { state: finalize(next, { type: "ACTION", seat: seatNo, action: type, amount: amount ?? null }), ack: ok };
}

function advance(state: MockState, fromSeat: number): MockState {
  const { view } = state;
  const hand = view.hand!;
  if (contenders(view).length <= 1) return awardUncontested(state);
  const next = after(view, fromSeat).find(
    (s) => canAct(s) && (!state.acted.includes(s.seat) || s.bet < hand.currentBet),
  );
  if (next) {
    return { ...state, view: { ...view, hand: { ...hand, toActSeat: next.seat, actionDeadline: deadline(view) } } };
  }
  return endStreet(state);
}

function collectBets(view: TableView): TableView {
  const hand = view.hand!;
  const sum = view.seats.reduce((n, s) => n + s.bet, 0);
  const eligible = contenders(view).map((s) => s.seat);
  const pots = hand.pots.length === 0 ? [{ amount: sum, eligibleSeats: eligible }] : hand.pots.map((p, i) =>
    i === hand.pots.length - 1 ? { ...p, amount: p.amount + sum, eligibleSeats: p.eligibleSeats.filter((x) => eligible.includes(x)) } : p,
  );
  return {
    ...view,
    seats: view.seats.map((s) => ({
      ...s,
      bet: 0,
      lastAction: s.folded || s.allIn ? s.lastAction : null,
    })),
    hand: { ...hand, pots: sum > 0 || hand.pots.length > 0 ? pots : hand.pots, currentBet: 0 },
  };
}

function dealStreet(state: MockState): MockState {
  const view = state.view;
  const hand = view.hand!;
  const n = hand.phase === "PREFLOP" ? 3 : 1;
  let deck = state.deck;
  const boards = hand.boards.map((b) => {
    const add = deck.slice(0, n);
    deck = deck.slice(n);
    return [...b, ...add];
  });
  const phase = hand.phase === "PREFLOP" ? "FLOP" : hand.phase === "FLOP" ? "TURN" : "RIVER";
  const street = phase === "FLOP" ? "Flop" : phase === "TURN" ? "Turn" : "River";
  const text = boards.length > 1
    ? boards.map((b, i) => `${hand.runItTwice ? "Run" : "Board"} ${i + 1}: ${b.map(show).join(" ")}`).join(" · ")
    : `${street}: ${boards[0].map(show).join(" ")}`;
  const next: TableView = { ...view, hand: { ...hand, boards, phase }, log: addLog(view, "deal", text) };
  return { ...state, view: next, deck };
}

function endStreet(state: MockState): MockState {
  let s: MockState = { ...state, view: collectBets(state.view), acted: [], lastRaise: state.view.settings.bigBlind };
  const hand = s.view.hand!;
  if (hand.phase === "RIVER") return showdown(s);
  s = dealStreet(s);
  const actors = s.view.seats.filter(canAct);
  if (actors.length <= 1) {
    // Everyone is all-in: wait for a run-it-twice vote if allowed, else run out.
    const allInPlayers = contenders(s.view);
    if (s.view.settings.runItTwice && s.view.hand!.phase !== "RIVER" && allInPlayers.length >= 2 && !s.view.hand!.runItTwice) {
      const vote = makeVote(s.view, "RUN_IT_TWICE", "START", allInPlayers[0].userId, allInPlayers[0].displayName, allInPlayers.map((p) => p.userId));
      return { ...s, view: { ...s.view, hand: { ...s.view.hand!, toActSeat: null, actionDeadline: null }, votes: [...s.view.votes, vote] } };
    }
    return runOut(s);
  }
  const first = after(s.view, hand.buttonSeat).find(canAct)!;
  return { ...s, view: { ...s.view, hand: { ...s.view.hand!, toActSeat: first.seat, actionDeadline: deadline(s.view) } } };
}

export function runOut(state: MockState): MockState {
  let s = state;
  s = { ...s, view: { ...s.view, hand: { ...s.view.hand!, toActSeat: null, actionDeadline: null } } };
  if (s.view.hand!.runItTwice && s.view.hand!.boards.length === 1) {
    s = { ...s, view: { ...s.view, hand: { ...s.view.hand!, boards: [s.view.hand!.boards[0], [...s.view.hand!.boards[0]]] } } };
  }
  while (s.view.hand!.phase !== "RIVER") s = dealStreet(s);
  return showdown(s);
}

function showdown(state: MockState): MockState {
  let view = collectBets(state.view);
  const hand = view.hand!;
  const alive = contenders(view);
  // Reveal cards of everyone still in.
  view = {
    ...view,
    seats: view.seats.map((s) =>
      alive.some((a) => a.seat === s.seat) ? { ...s, holeCards: s.holeCards ?? state.hidden[s.seat] ?? null } : s,
    ),
  };
  const names: Record<number, string> = {};
  for (const a of alive) names[a.seat] = HAND_NAMES[Math.floor(Math.random() * HAND_NAMES.length)];
  const winners: HandResultView["winners"] = [];
  const boardCount = hand.boards.length;
  hand.pots.forEach((pot, potIndex) => {
    const share = Math.floor(pot.amount / boardCount);
    for (let b = 0; b < boardCount; b += 1) {
      const eligible = alive.filter((a) => pot.eligibleSeats.includes(a.seat));
      if (eligible.length === 0) continue;
      const w = eligible[Math.floor(Math.random() * eligible.length)];
      const amount = b === 0 ? pot.amount - share * (boardCount - 1) : share;
      winners.push({ seat: w.seat, userId: w.userId, amount, potIndex, boardIndex: b, handName: names[w.seat] });
    }
  });
  const shown = alive.map((a) => ({
    seat: a.seat,
    cards: view.seats.find((s) => s.seat === a.seat)!.holeCards ?? [],
    handName: names[a.seat],
  }));
  view = { ...view, seats: view.seats.map((s) => (names[s.seat] ? { ...s, handName: names[s.seat] } : s)) };
  return complete({ ...state, view }, { winners, shown, uncalledReturn: null, sidePayments: [] });
}

function awardUncontested(state: MockState): MockState {
  const view = collectBets(state.view);
  const winner = contenders(view)[0];
  const total = view.hand!.pots.reduce((n, p) => n + p.amount, 0);
  return complete(
    { ...state, view },
    {
      winners: [{ seat: winner.seat, userId: winner.userId, amount: total, potIndex: 0, boardIndex: 0, handName: null }],
      shown: [],
      uncalledReturn: null,
      sidePayments: [],
    },
  );
}

function complete(state: MockState, result: HandResultView): MockState {
  let view = state.view;
  const hand = view.hand!;
  let log = view.log;
  for (const w of result.winners) {
    view = setSeat(view, w.seat, { stack: view.seats.find((s) => s.seat === w.seat)!.stack + w.amount });
    seq += 1;
    log = [...log, {
      id: `m${seq}`,
      handNumber: hand.handNumber,
      at: new Date().toISOString(),
      kind: "award" as const,
      text: `${nameOf(view, w.seat)} wins ${formatChips(w.amount)}${w.handName ? ` with ${w.handName}` : ""}`,
    }];
  }
  // Nit game: winners become safe; when one nit remains they pay everyone else.
  const sidePayments = [...result.sidePayments];
  const nit = view.sideGames.nitGame;
  if (nit.active) {
    const winnerIds = new Set(result.winners.map((w) => w.userId));
    let nitIds = nit.nitUserIds.filter((id) => !winnerIds.has(id));
    let active: boolean = true;
    if (nitIds.length === 1) {
      const loser = view.seats.find((s) => s.userId === nitIds[0]);
      const penalty = view.settings.nitGame.penaltyBB * view.settings.bigBlind;
      if (loser) {
        let left = loser.stack;
        for (const other of view.seats) {
          if (other.userId === loser.userId || !nit.participantUserIds.includes(other.userId) || left <= 0) continue;
          const amount = Math.min(penalty, left);
          left -= amount;
          sidePayments.push({ fromSeat: loser.seat, toSeat: other.seat, amount, reason: "NIT_GAME" });
          view = setSeat(view, other.seat, { stack: other.stack + amount });
        }
        view = setSeat(view, loser.seat, { stack: left });
        log = [...log, { id: `m${(seq += 1)}`, handNumber: hand.handNumber, at: new Date().toISOString(), kind: "side_game", text: `${loser.displayName} is the last nit and pays ${formatChips(penalty)} to each player` }];
      }
      nitIds = [];
      active = false;
    }
    view = {
      ...view,
      sideGames: { ...view.sideGames, nitGame: { ...nit, active, nitUserIds: nitIds, participantUserIds: active ? nit.participantUserIds : [] } },
      seats: view.seats.map((s) => ({ ...s, isNit: active ? nitIds.includes(s.userId) : null })),
    };
  }
  const viewerSeat = view.seats.find((s) => s.userId === view.viewer.userId);
  const viewerShown = result.shown.some((x) => x.seat === viewerSeat?.seat);
  view = {
    ...view,
    log,
    hand: { ...hand, phase: "COMPLETE", toActSeat: null, actionDeadline: null, result: { ...result, sidePayments }, revealedDeck: "mock-deck | salt" },
    nextHandAt: new Date(Date.now() + 6000).toISOString(),
    viewer: { ...view.viewer, canShowCards: Boolean(viewerSeat?.inHand && viewerSeat.holeCards && !viewerShown) },
  };
  return { ...state, view };
}

// ---------------------------------------------------------------------------------------------
// Hands

export function startNextHand(state: MockState): MockState {
  let view = state.view;
  const s = view.settings;
  const players = sorted(view.seats).filter((x) => (x.status === "ACTIVE" || x.status === "WAITING_BB") && x.stack > 0);
  if (players.length < 2) {
    return finalize({
      ...state,
      view: {
        ...view,
        status: "WAITING",
        hand: null,
        nextHandAt: null,
        seats: view.seats.map((x) => ({ ...x, inHand: false, cardCount: 0, holeCards: null, bet: 0, lastAction: null, folded: false, allIn: false, handName: null })),
      },
    });
  }
  const ids = new Set(players.map((p) => p.seat));
  const prevButton = view.hand?.buttonSeat ?? 0;
  const ring = after({ ...view, seats: players }, prevButton);
  const button = ring[0].seat;
  const fromButton = after({ ...view, seats: players }, button);
  const headsUp = players.length === 2;
  const sb = headsUp ? button : fromButton[0].seat;
  const bb = headsUp ? fromButton[0].seat : fromButton[1].seat;
  let deck = freshDeck();
  const hidden: Record<number, PublicCard[]> = {};
  const n = holeCount(view);
  const bomb = view.sideGames.bombPotQueued || (view.sideGames.handsUntilAutoBombPot === 1);
  const handNumber = (view.hand?.handNumber ?? 0) + 1;
  const viewerId = view.viewer.userId;

  let seats: TableSeatView[] = view.seats.map((x) => {
    const dealt = ids.has(x.seat);
    const cardsFor = dealt ? deck.slice(0, n) : [];
    if (dealt) {
      deck = deck.slice(n);
      hidden[x.seat] = cardsFor;
    }
    return {
      ...x,
      status: x.status === "WAITING_BB" ? ("ACTIVE" as const) : x.status,
      inHand: dealt,
      folded: false,
      allIn: false,
      bet: 0,
      lastAction: null,
      handName: null,
      cardCount: dealt ? n : 0,
      holeCards: dealt && x.userId === viewerId ? cardsFor : null,
    };
  });

  let log = addLog(view, "deal", `Hand #${handNumber} · ${nameOf(view, button)} has the button`);
  let pots: PotView[] = [];
  let currentBet = 0;
  let totalPot = 0;
  let straddleSeat: number | null = null;
  const post = (seatNo: number, amount: number, type: "post" | "straddle" | "ante") => {
    seats = seats.map((x) => {
      if (x.seat !== seatNo) return x;
      const pay = Math.min(amount, x.stack);
      totalPot += pay;
      return {
        ...x,
        stack: x.stack - pay,
        bet: type === "ante" ? x.bet : x.bet + pay,
        allIn: x.stack - pay === 0,
        lastAction: { type, amount: pay },
      };
    });
  };

  if (bomb) {
    const ante = s.bombPot.anteBB * s.bigBlind;
    for (const p of players) post(p.seat, ante, "ante");
    pots = [{ amount: totalPot, eligibleSeats: players.map((p) => p.seat) }];
    log = [...log, { id: `m${(seq += 1)}`, handNumber, at: new Date().toISOString(), kind: "side_game", text: `Bomb pot! Everyone antes ${formatChips(ante)}` }];
  } else {
    post(sb, s.smallBlind, "post");
    post(bb, s.bigBlind, "post");
    currentBet = s.bigBlind;
    const utg = after({ ...view, seats: players }, bb)[0];
    if (s.straddle && !headsUp && utg.wantsStraddle) {
      post(utg.seat, s.bigBlind * 2, "straddle");
      currentBet = s.bigBlind * 2;
      straddleSeat = utg.seat;
    }
  }

  view = {
    ...view,
    status: "RUNNING",
    seats,
    log,
    nextHandAt: null,
    votes: view.votes.filter((v) => v.status === "OPEN" && v.kind !== "RUN_IT_TWICE"),
    sideGames: {
      ...view.sideGames,
      bombPotQueued: false,
      handsUntilAutoBombPot:
        s.bombPot.everyNHands > 0 ? (bomb ? s.bombPot.everyNHands : Math.max(1, (view.sideGames.handsUntilAutoBombPot ?? s.bombPot.everyNHands) - 1)) : null,
    },
    viewer: { ...view.viewer, canShowCards: false },
    hand: {
      handId: `mock-${handNumber}-${Date.now()}`,
      handNumber,
      phase: "PREFLOP",
      isBombPot: bomb,
      boards: bomb && s.bombPot.doubleBoard ? [[], []] : [[]],
      runItTwice: false,
      buttonSeat: button,
      smallBlindSeat: bomb ? null : sb,
      bigBlindSeat: bomb ? null : bb,
      straddleSeat,
      toActSeat: null,
      actionDeadline: null,
      usingTimeBank: false,
      currentBet,
      pots,
      totalPot,
      result: null,
      deckCommitment: Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""),
      revealedDeck: null,
    },
  };
  let next: MockState = { ...state, view, hidden, deck, acted: [], lastRaise: s.bigBlind };
  if (bomb) {
    next = dealStreet(next);
    const first = after(next.view, button).find(canAct);
    next = { ...next, view: { ...next.view, hand: { ...next.view.hand!, toActSeat: first?.seat ?? null, actionDeadline: deadline(next.view) } } };
  } else {
    const first = after(view, straddleSeat ?? bb).find(canAct);
    next = { ...next, view: { ...next.view, hand: { ...next.view.hand!, toActSeat: first?.seat ?? null, actionDeadline: deadline(next.view) } } };
  }
  return finalize(next, { type: "HAND_START", seat: null, action: null, amount: null });
}

// ---------------------------------------------------------------------------------------------
// Votes

function makeVote(view: TableView, kind: VoteKind, action: "START" | "STOP", userId: string, name: string, eligible?: string[]): TableVote {
  const rule =
    kind === "BOMB_POT" ? view.settings.bombPot.voteRule
      : kind === "NIT_GAME" ? view.settings.nitGame.voteRule
        : kind === "BOUNTY_GAME" ? view.settings.bountyGame.voteRule
          : "unanimous";
  const now = Date.now();
  return {
    id: `mv-${kind}-${now}`,
    kind,
    action,
    proposedByUserId: userId,
    proposedByName: name,
    rule,
    eligibleUserIds: eligible ?? view.seats.filter((s) => s.status !== "SITTING_OUT").map((s) => s.userId),
    yesUserIds: [userId],
    noUserIds: [],
    status: "OPEN",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 20_000).toISOString(),
  };
}

function resolveVote(state: MockState, vote: TableVote): MockState {
  if (vote.status !== "OPEN") return state;
  const eligible = vote.eligibleUserIds.length;
  const yes = vote.yesUserIds.length;
  let status: TableVote["status"] = "OPEN";
  if (vote.rule === "unanimous") {
    if (vote.noUserIds.length > 0) status = "FAILED";
    else if (yes >= eligible) status = "PASSED";
  } else if (yes * 2 > eligible) status = "PASSED";
  else if (vote.noUserIds.length * 2 >= eligible) status = "FAILED";
  if (Date.now() >= Date.parse(vote.expiresAt) && status === "OPEN") status = "FAILED";
  if (status === "OPEN") return state;

  let view: TableView = { ...state.view, votes: state.view.votes.map((v) => (v.id === vote.id ? { ...v, status } : v)) };
  const label = vote.kind === "RUN_IT_TWICE" ? "Run it twice" : vote.kind === "BOMB_POT" ? "Bomb pot" : vote.kind === "NIT_GAME" ? "Nit game" : "7-2 bounty";
  view = { ...view, log: addLog(view, "vote", `${label} vote ${status === "PASSED" ? "passed" : "failed"}`) };
  if (status === "PASSED") {
    if (vote.kind === "BOMB_POT") view = { ...view, sideGames: { ...view.sideGames, bombPotQueued: true } };
    if (vote.kind === "BOUNTY_GAME") view = { ...view, sideGames: { ...view.sideGames, bountyGame: { active: vote.action === "START" } } };
    if (vote.kind === "NIT_GAME") {
      const start = vote.action === "START";
      const ids = view.seats.filter((s) => s.status === "ACTIVE").map((s) => s.userId);
      view = {
        ...view,
        sideGames: { ...view.sideGames, nitGame: { active: start, nitUserIds: start ? ids : [], participantUserIds: start ? ids : [] } },
        seats: view.seats.map((s) => ({ ...s, isNit: start ? ids.includes(s.userId) : null })),
      };
    }
    if (vote.kind === "RUN_IT_TWICE" && view.hand) view = { ...view, hand: { ...view.hand, runItTwice: true } };
  }
  return { ...state, view, resolvedAt: { ...state.resolvedAt, [vote.id]: Date.now() } };
}

export function propose(state: MockState, kind: VoteKind, action: "START" | "STOP"): Result {
  const v = state.view;
  const me = v.seats.find((s) => s.userId === v.viewer.userId);
  if (!me) return { state, ack: err("NOT_SEATED", "Take a seat to propose a game.") };
  if (v.votes.some((x) => x.kind === kind && x.status === "OPEN")) return { state, ack: err("VOTE_OPEN", "There's already a vote for that.") };
  const vote = makeVote(v, kind, action, me.userId, me.displayName);
  let next: MockState = { ...state, view: { ...v, votes: [...v.votes, vote], log: addLog(v, "vote", `${me.displayName} proposed: ${kind.replace(/_/g, " ").toLowerCase()} ${action.toLowerCase()}`) } };
  next = resolveVote(next, vote);
  return { state: finalize(next, { type: "VOTE", seat: me.seat, action: null, amount: null }), ack: ok };
}

export function castVote(state: MockState, userId: string, voteId: string, yes: boolean): Result {
  const vote = state.view.votes.find((x) => x.id === voteId);
  if (!vote || vote.status !== "OPEN") return { state, ack: err("VOTE_CLOSED", "This vote has ended.") };
  if (!vote.eligibleUserIds.includes(userId)) return { state, ack: err("NOT_ELIGIBLE", "You can't vote on this.") };
  const updated: TableVote = {
    ...vote,
    yesUserIds: yes ? [...new Set([...vote.yesUserIds, userId])] : vote.yesUserIds.filter((x) => x !== userId),
    noUserIds: !yes ? [...new Set([...vote.noUserIds, userId])] : vote.noUserIds.filter((x) => x !== userId),
  };
  let next: MockState = { ...state, view: { ...state.view, votes: state.view.votes.map((x) => (x.id === voteId ? updated : x)) } };
  next = resolveVote(next, updated);
  return { state: finalize(next), ack: ok };
}

// ---------------------------------------------------------------------------------------------
// Seats

export function sit(state: MockState, seatNo: number, buyIn: number): Result {
  const v = state.view;
  const me = v.seats.find((s) => s.userId === v.viewer.userId);
  if (me) return { state, ack: err("ALREADY_SEATED", "You're already seated.") };
  if (v.seats.some((s) => s.seat === seatNo)) return { state, ack: err("SEAT_TAKEN", "That seat was just taken.") };
  if (buyIn < v.settings.minBuyIn || buyIn > v.settings.maxBuyIn) return { state, ack: err("BAD_AMOUNT", "Buy-in is outside the table limits.") };
  if (buyIn > v.viewer.walletBalance) return { state, ack: err("INSUFFICIENT_FUNDS", "You don't have enough chips.") };
  const seat: TableSeatView = {
    seat: seatNo,
    userId: v.viewer.userId,
    username: "sam",
    displayName: "Sam",
    avatarUrl: null,
    stack: buyIn,
    bet: 0,
    status: v.hand && v.hand.phase !== "COMPLETE" ? "WAITING_BB" : "ACTIVE",
    connected: true,
    inHand: false,
    folded: false,
    allIn: false,
    cardCount: 0,
    holeCards: null,
    lastAction: null,
    timeBankSec: v.settings.timeBankSec,
    wantsStraddle: false,
    isNit: v.sideGames.nitGame.active ? false : null,
    handName: null,
  };
  const view: TableView = {
    ...v,
    seats: sorted([...v.seats, seat]),
    viewer: { ...v.viewer, walletBalance: v.viewer.walletBalance - buyIn },
    log: addLog(v, "seat", `Sam sat down in seat ${seatNo} with ${formatChips(buyIn)}`),
  };
  return { state: finalize({ ...state, view, live: true }, { type: "SEAT", seat: seatNo, action: null, amount: null }), ack: ok };
}

export function stand(state: MockState): Result {
  const v = state.view;
  const me = v.seats.find((s) => s.userId === v.viewer.userId);
  if (!me) return { state, ack: err("NOT_SEATED", "You're not seated.") };
  let s = state;
  if (v.hand?.toActSeat === me.seat) s = applyAction(s, me.seat, "fold").state;
  const view: TableView = {
    ...s.view,
    seats: s.view.seats.filter((x) => x.seat !== me.seat),
    viewer: { ...s.view.viewer, walletBalance: s.view.viewer.walletBalance + me.stack, canShowCards: false },
    log: addLog(s.view, "seat", `${me.displayName} stood up`),
  };
  return { state: finalize({ ...s, view }, { type: "SEAT", seat: me.seat, action: null, amount: null }), ack: ok };
}

export function sitOut(state: MockState, out: boolean): Result {
  const v = state.view;
  const me = v.seats.find((s) => s.userId === v.viewer.userId);
  if (!me) return { state, ack: err("NOT_SEATED", "You're not seated.") };
  const view = {
    ...setSeat(v, me.seat, { status: out ? "SITTING_OUT" : "ACTIVE" }),
    log: addLog(v, "seat", `${me.displayName} ${out ? "is sitting out" : "is back"}`),
  };
  return { state: finalize({ ...state, view, live: true }), ack: ok };
}

export function rebuy(state: MockState, amount: number): Result {
  const v = state.view;
  const me = v.seats.find((s) => s.userId === v.viewer.userId);
  if (!me) return { state, ack: err("NOT_SEATED", "You're not seated.") };
  if (amount <= 0 || me.stack + amount > v.settings.maxBuyIn) return { state, ack: err("BAD_AMOUNT", "That would exceed the max buy-in.") };
  if (amount > v.viewer.walletBalance) return { state, ack: err("INSUFFICIENT_FUNDS", "You don't have enough chips.") };
  const view = {
    ...setSeat(v, me.seat, { stack: me.stack + amount }),
    viewer: { ...v.viewer, walletBalance: v.viewer.walletBalance - amount },
    log: addLog(v, "seat", `${me.displayName} added ${formatChips(amount)} chips`),
  };
  return { state: finalize({ ...state, view }), ack: ok };
}

export function setStraddle(state: MockState, enabled: boolean): Result {
  const v = state.view;
  const me = v.seats.find((s) => s.userId === v.viewer.userId);
  if (!me) return { state, ack: err("NOT_SEATED", "You're not seated.") };
  return { state: finalize({ ...state, view: setSeat(v, me.seat, { wantsStraddle: enabled }) }), ack: ok };
}

export function showCards(state: MockState): Result {
  const v = state.view;
  const me = v.seats.find((s) => s.userId === v.viewer.userId);
  if (!me || !v.hand?.result || !v.viewer.canShowCards || !me.holeCards) return { state, ack: err("CANNOT_SHOW", "Nothing to show.") };
  const shown = [...v.hand.result.shown, { seat: me.seat, cards: me.holeCards, handName: null }];
  const view: TableView = {
    ...v,
    hand: { ...v.hand, result: { ...v.hand.result, shown } },
    viewer: { ...v.viewer, canShowCards: false },
    log: addLog(v, "showdown", `${me.displayName} shows ${me.holeCards.map(show).join(" ")}`),
  };
  return { state: finalize({ ...state, view }), ack: ok };
}

// ---------------------------------------------------------------------------------------------
// Clock: bots, timeouts, vote expiry, next hand. Returns null when nothing changed.

export function tick(state: MockState, simulate: boolean): MockState | null {
  const now = Date.now();
  let s = state;
  let changed = false;
  const v = s.view;

  // Drop resolved votes after a few seconds; expire open ones; bots vote.
  for (const vote of v.votes) {
    if (vote.status !== "OPEN") continue;
    const age = now - Date.parse(vote.createdAt);
    let current = s.view.votes.find((x) => x.id === vote.id)!;
    if (simulate && s.live && age > 2500) {
      for (const id of current.eligibleUserIds) {
        if (id === v.viewer.userId || current.yesUserIds.includes(id) || current.noUserIds.includes(id)) continue;
        const r = castVote(s, id, vote.id, Math.random() < 0.8);
        s = r.state;
        changed = true;
        current = s.view.votes.find((x) => x.id === vote.id)!;
        break; // one bot vote per tick looks natural
      }
    }
    if (now >= Date.parse(current.expiresAt)) {
      s = resolveVote(s, current);
      changed = true;
    }
  }
  const stale = s.view.votes.filter((x) => x.status !== "OPEN" && now - (s.resolvedAt[x.id] ?? now) > 4000);
  if (stale.length) {
    s = { ...s, view: { ...s.view, votes: s.view.votes.filter((x) => !stale.includes(x)) } };
    changed = true;
  }

  const hand = s.view.hand;
  // All-in with no one to act and no pending RIT vote: run the board out.
  if (hand && hand.phase !== "COMPLETE" && hand.toActSeat === null && !s.view.votes.some((x) => x.kind === "RUN_IT_TWICE" && x.status === "OPEN")) {
    if (simulate || s.live) {
      s = runOut(s);
      return finalize(s, { type: "SHOWDOWN", seat: null, action: null, amount: null });
    }
  }

  if (hand && hand.toActSeat !== null && hand.phase !== "COMPLETE" && hand.actionDeadline) {
    const actor = s.view.seats.find((x) => x.seat === hand.toActSeat);
    const isViewer = actor?.userId === s.view.viewer.userId;
    const late = now >= Date.parse(hand.actionDeadline);
    if (late && actor && !hand.usingTimeBank && actor.timeBankSec > 0 && (isViewer || s.live)) {
      s = { ...s, view: { ...s.view, hand: { ...hand, usingTimeBank: true, actionDeadline: new Date(now + actor.timeBankSec * 1000).toISOString() } } };
      return finalize(s, { type: "TIMEOUT", seat: actor.seat, action: null, amount: null });
    }
    if (late && actor && (isViewer || s.live)) {
      const legal = legalFor(s, actor.seat);
      const r = applyAction(s, actor.seat, legal?.canCheck ? "check" : "fold");
      return r.state;
    }
    if (actor && !isViewer && simulate && s.live && now - s.turnStartedAt > 1100 + (actor.seat % 3) * 350 && !hand.usingTimeBank) {
      const legal = legalFor(s, actor.seat);
      if (legal) {
        const roll = Math.random();
        let r: Result;
        if (legal.canCheck) r = roll < 0.15 && legal.canBetOrRaise ? applyAction(s, actor.seat, legal.isBet ? "bet" : "raise", legal.minTo) : applyAction(s, actor.seat, "check");
        else if (roll < 0.15) r = applyAction(s, actor.seat, "fold");
        else if (roll < 0.25 && legal.canBetOrRaise) r = applyAction(s, actor.seat, "raise", legal.minTo);
        else r = applyAction(s, actor.seat, "call");
        return r.state;
      }
    }
  }

  // Next hand (frozen fixtures just drop the countdown instead).
  if (hand?.phase === "COMPLETE" && s.view.nextHandAt && now >= Date.parse(s.view.nextHandAt)) {
    if (simulate && s.live) return startNextHand(s);
    return finalize({ ...s, view: { ...s.view, nextHandAt: null } });
  }
  if (s.view.status === "WAITING" && s.view.settings.autoStart && s.live && s.view.seats.filter((x) => x.status === "ACTIVE").length >= 2) {
    return startNextHand(s);
  }
  return changed ? finalize(s) : null;
}

export function viewerSeatNo(state: MockState): number | null {
  return state.view.seats.find((s) => s.userId === state.view.viewer.userId)?.seat ?? null;
}
