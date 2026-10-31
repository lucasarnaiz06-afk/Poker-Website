// Realistic TableView fixtures for the /dev/table playground and component work.
// Every fixture is built relative to "now" so timers and vote countdowns are live.
import {
  DEFAULT_TABLE_SETTINGS,
  type ChatMessage,
  type HandView,
  type LegalActions,
  type PublicCard,
  type TableLogEntry,
  type TableSeatView,
  type TableSettings,
  type TableView,
  type TableVote,
} from "@poker-platform/shared/types";

export const VIEWER_ID = "u-sam";
const TABLE_ID = "dev-table";

type Person = { id: string; name: string; username: string };
const P = (name: string): Person => ({ id: `u-${name.toLowerCase()}`, name, username: name.toLowerCase() });
export const PEOPLE = {
  sam: P("Sam"),
  maya: P("Maya"),
  jonah: P("Jonah"),
  priya: P("Priya"),
  diego: P("Diego"),
  hana: P("Hana"),
  felix: P("Felix"),
  noor: P("Noor"),
  theo: P("Theo"),
} as const;
type Who = keyof typeof PEOPLE;

/** "As" -> { rank: "A", suit: "s" }; "Th" -> ten of hearts. */
export function c(code: string): PublicCard {
  return { rank: code[0] as PublicCard["rank"], suit: code[1] as PublicCard["suit"] };
}
export const cards = (codes: string): PublicCard[] => codes.split(" ").filter(Boolean).map(c);

type SeatInit = Partial<Omit<TableSeatView, "seat" | "userId" | "username" | "displayName">> & {
  who: Who;
  seat: number;
  hole?: string;
};

function seat(init: SeatInit): TableSeatView {
  const p = PEOPLE[init.who];
  const { who: _who, hole, ...rest } = init;
  const holeCards = hole ? cards(hole) : null;
  return {
    userId: p.id,
    username: p.username,
    displayName: p.name,
    avatarUrl: null,
    stack: 1000,
    bet: 0,
    status: "ACTIVE",
    connected: true,
    inHand: true,
    folded: false,
    allIn: false,
    cardCount: holeCards?.length ?? 2,
    holeCards,
    lastAction: null,
    timeBankSec: 30,
    wantsStraddle: false,
    isNit: null,
    handName: null,
    ...rest,
  };
}

function settings(overrides: Partial<TableSettings> = {}): TableSettings {
  return {
    ...DEFAULT_TABLE_SETTINGS,
    maxPlayers: 6,
    bombPot: { ...DEFAULT_TABLE_SETTINGS.bombPot },
    nitGame: { ...DEFAULT_TABLE_SETTINGS.nitGame, enabled: true },
    bountyGame: { ...DEFAULT_TABLE_SETTINGS.bountyGame, enabled: true },
    ...overrides,
  };
}

const iso = (ms: number) => new Date(ms).toISOString();
const COMMIT = "9f2b6c1e0a4d7b3c58e1f0a9d2c4b6e8a1f3c5d7e9b0a2c4e6f8a1b3c5d7e9f0";

function hand(now: number, h: Partial<HandView> & Pick<HandView, "handNumber" | "buttonSeat">): HandView {
  return {
    handId: `h-${h.handNumber}`,
    phase: "PREFLOP",
    isBombPot: false,
    boards: [[]],
    runItTwice: false,
    smallBlindSeat: null,
    bigBlindSeat: null,
    straddleSeat: null,
    toActSeat: null,
    actionDeadline: null,
    usingTimeBank: false,
    currentBet: 0,
    pots: [],
    totalPot: 0,
    result: null,
    deckCommitment: COMMIT,
    revealedDeck: null,
    ...h,
    ...(h.toActSeat && !h.actionDeadline ? { actionDeadline: iso(now + 19_000) } : {}),
  };
}

function legal(l: Partial<LegalActions>): LegalActions {
  return {
    canFold: true,
    canCheck: false,
    callAmount: 0,
    canBetOrRaise: true,
    isBet: false,
    minTo: 0,
    maxTo: 0,
    potTo: 0,
    ...l,
  };
}

function log(now: number, handNumber: number | null, lines: Array<[TableLogEntry["kind"], string]>): TableLogEntry[] {
  return lines.map(([kind, text], i) => ({
    id: `l-${handNumber ?? 0}-${i}`,
    handNumber,
    at: iso(now - (lines.length - i) * 4000),
    kind,
    text,
  }));
}

type VoteInit = Omit<Partial<TableVote>, "yesUserIds" | "noUserIds" | "eligibleUserIds"> & {
  kind: TableVote["kind"];
  proposedBy: Who;
  eligible: Who[];
  yes?: Who[];
  no?: Who[];
};

function mkVote(now: number, v: VoteInit): TableVote {
  const { proposedBy, eligible, yes = [], no = [], ...rest } = v;
  return {
    id: `v-${v.kind.toLowerCase()}`,
    action: "START",
    proposedByUserId: PEOPLE[proposedBy].id,
    proposedByName: PEOPLE[proposedBy].name,
    rule: "majority",
    eligibleUserIds: eligible.map((w) => PEOPLE[w].id),
    yesUserIds: yes.map((w) => PEOPLE[w].id),
    noUserIds: no.map((w) => PEOPLE[w].id),
    status: "OPEN",
    createdAt: iso(now - 6000),
    expiresAt: iso(now + 14_000),
    ...rest,
  };
}

function base(now: number, v: Partial<TableView> & { seats: TableSeatView[] }): TableView {
  const viewerSeat = v.seats.find((s) => s.userId === VIEWER_ID)?.seat ?? null;
  return {
    tableId: TABLE_ID,
    name: "Friday Night Hold'em",
    hostUserId: VIEWER_ID,
    settings: settings(),
    status: "RUNNING",
    hand: null,
    votes: [],
    sideGames: {
      nitGame: { active: false, nitUserIds: [], participantUserIds: [] },
      bountyGame: { active: false },
      bombPotQueued: false,
      handsUntilAutoBombPot: null,
    },
    log: [],
    nextHandAt: null,
    version: 1,
    serverTime: iso(now),
    lastEvent: null,
    ...v,
    viewer: {
      userId: VIEWER_ID,
      seat: viewerSeat,
      legalActions: null,
      canShowCards: false,
      walletBalance: 24_850,
      ...v.viewer,
    },
  };
}

const ALL6: Who[] = ["sam", "maya", "jonah", "priya", "diego", "hana"];

// ---------------------------------------------------------------------------------------------
// Scenarios

function emptyTable(now: number): TableView {
  return base(now, {
    status: "WAITING",
    hostUserId: PEOPLE.maya.id,
    seats: [],
    log: log(now, null, [["system", "Table created by Maya"]]),
  });
}

function waitingForPlayers(now: number): TableView {
  return base(now, {
    status: "WAITING",
    seats: [seat({ who: "sam", seat: 1, stack: 1000, inHand: false, cardCount: 0 })],
    log: log(now, null, [
      ["system", "Table created by Sam"],
      ["seat", "Sam sat down in seat 1 with 1,000"],
    ]),
  });
}

function readyToStart(now: number): TableView {
  return base(now, {
    status: "WAITING",
    settings: settings({ autoStart: false }),
    seats: [
      seat({ who: "sam", seat: 1, stack: 1000, inHand: false, cardCount: 0 }),
      seat({ who: "maya", seat: 4, stack: 1500, inHand: false, cardCount: 0 }),
    ],
    log: log(now, null, [
      ["seat", "Sam sat down in seat 1 with 1,000"],
      ["seat", "Maya sat down in seat 4 with 1,500"],
    ]),
  });
}

function preflopViewerToAct(now: number): TableView {
  const seats = [
    seat({ who: "priya", seat: 1, stack: 1170, bet: 30, lastAction: { type: "raise", amount: 30 } }),
    seat({ who: "diego", seat: 2, stack: 860, folded: true, lastAction: { type: "fold", amount: null } }),
    seat({ who: "hana", seat: 3, stack: 640, bet: 30, lastAction: { type: "call", amount: 30 } }),
    seat({ who: "sam", seat: 4, stack: 1480, hole: "Ah Qs" }),
    seat({ who: "maya", seat: 5, stack: 2195, bet: 5, lastAction: { type: "post", amount: 5 } }),
    seat({ who: "jonah", seat: 6, stack: 990, bet: 10, lastAction: { type: "post", amount: 10 } }),
  ];
  return base(now, {
    seats,
    hand: hand(now, {
      handNumber: 42,
      buttonSeat: 4,
      smallBlindSeat: 5,
      bigBlindSeat: 6,
      toActSeat: 4,
      currentBet: 30,
      totalPot: 75,
    }),
    viewer: {
      userId: VIEWER_ID,
      seat: 4,
      canShowCards: false,
      walletBalance: 24_850,
      legalActions: legal({ callAmount: 30, minTo: 50, maxTo: 1480, potTo: 135 }),
    },
    log: log(now, 42, [
      ["deal", "Hand #42 · Sam has the button"],
      ["action", "Maya posts small blind 5"],
      ["action", "Jonah posts big blind 10"],
      ["action", "Priya raises to 30"],
      ["action", "Diego folds"],
      ["action", "Hana calls 30"],
    ]),
  });
}

function multiwaySidePots(now: number): TableView {
  const seats = [
    seat({ who: "priya", seat: 1, stack: 2210 }),
    seat({ who: "diego", seat: 2, stack: 0, allIn: true, lastAction: { type: "allin", amount: 300 } }),
    seat({ who: "hana", seat: 3, stack: 940, bet: 300, lastAction: { type: "bet", amount: 300 } }),
    seat({ who: "sam", seat: 4, stack: 1650, hole: "Kc Js" }),
    seat({ who: "maya", seat: 5, stack: 905 }),
    seat({ who: "jonah", seat: 6, stack: 0, allIn: true, lastAction: { type: "allin", amount: 460 } }),
  ];
  return base(now, {
    seats,
    hand: hand(now, {
      handNumber: 57,
      phase: "TURN",
      boards: [cards("Kh 9d 4c 2s")],
      buttonSeat: 2,
      smallBlindSeat: 3,
      bigBlindSeat: 4,
      toActSeat: 4,
      currentBet: 300,
      pots: [
        { amount: 1200, eligibleSeats: [1, 2, 3, 4, 5, 6] },
        { amount: 800, eligibleSeats: [1, 3, 4, 5, 6] },
        { amount: 240, eligibleSeats: [1, 3, 4, 5] },
      ],
      totalPot: 2540,
    }),
    viewer: {
      userId: VIEWER_ID,
      seat: 4,
      canShowCards: false,
      walletBalance: 12_300,
      legalActions: legal({ callAmount: 300, minTo: 600, maxTo: 1650, potTo: 1650 }),
    },
    log: log(now, 57, [
      ["deal", "Turn: K♥ 9♦ 4♣ 2♠"],
      ["action", "Hana bets 300"],
    ]),
  });
}

function showdownWinners(now: number): TableView {
  const seats = [
    seat({ who: "priya", seat: 1, stack: 1320, folded: true, inHand: true, lastAction: { type: "fold", amount: null } }),
    seat({ who: "jonah", seat: 3, stack: 220, hole: "Kh Qd", handName: "Two Pair, Kings and Sevens" }),
    seat({ who: "sam", seat: 4, stack: 2140, hole: "Ah 7s", handName: "Three of a Kind, Sevens" }),
    seat({ who: "maya", seat: 5, stack: 1200, hole: "Kd Kc", handName: "Full House, Kings full of Sevens" }),
  ];
  return base(now, {
    seats,
    hand: hand(now, {
      handNumber: 61,
      phase: "COMPLETE",
      boards: [cards("Ks 7h 7d 2c Jc")],
      buttonSeat: 1,
      smallBlindSeat: 3,
      bigBlindSeat: 4,
      pots: [
        { amount: 1200, eligibleSeats: [3, 4, 5] },
        { amount: 640, eligibleSeats: [3, 4] },
      ],
      totalPot: 1840,
      result: {
        winners: [
          { seat: 5, userId: PEOPLE.maya.id, amount: 1200, potIndex: 0, boardIndex: 0, handName: "Full House, Kings full of Sevens" },
          { seat: 4, userId: VIEWER_ID, amount: 640, potIndex: 1, boardIndex: 0, handName: "Three of a Kind, Sevens" },
        ],
        shown: [
          { seat: 5, cards: cards("Kd Kc"), handName: "Full House, Kings full of Sevens" },
          { seat: 4, cards: cards("Ah 7s"), handName: "Three of a Kind, Sevens" },
          { seat: 3, cards: cards("Kh Qd"), handName: "Two Pair, Kings and Sevens" },
        ],
        uncalledReturn: null,
        sidePayments: [],
      },
      revealedDeck: "Kd Kc Ah 7s Kh Qd … | salt 4b1e…",
    }),
    nextHandAt: iso(now + 6000),
    log: log(now, 61, [
      ["deal", "River: K♠ 7♥ 7♦ 2♣ J♣"],
      ["action", "Jonah checks"],
      ["action", "Sam bets 320, Jonah calls"],
      ["showdown", "Maya shows K♦ K♣ (Full House, Kings full of Sevens)"],
      ["showdown", "Sam shows A♥ 7♠ (Three of a Kind, Sevens)"],
      ["award", "Maya wins the main pot of 1,200"],
      ["award", "Sam wins side pot 1 of 640"],
    ]),
  });
}

function bombPotDoubleBoard(now: number): TableView {
  const s = settings({ bombPot: { enabled: true, anteBB: 2, doubleBoard: true, voteRule: "majority", everyNHands: 0 } });
  const seats = [
    seat({ who: "priya", seat: 1, stack: 1180 }),
    seat({ who: "hana", seat: 3, stack: 760, lastAction: { type: "check", amount: null } }),
    seat({ who: "sam", seat: 4, stack: 1460, hole: "Qh Jh" }),
    seat({ who: "maya", seat: 5, stack: 2010 }),
    seat({ who: "jonah", seat: 6, stack: 880 }),
  ];
  return base(now, {
    settings: s,
    seats,
    hand: hand(now, {
      handNumber: 70,
      phase: "FLOP",
      isBombPot: true,
      boards: [cards("Ah 8c 3d"), cards("Qs Qd 6h")],
      buttonSeat: 1,
      toActSeat: 4,
      pots: [{ amount: 100, eligibleSeats: [1, 3, 4, 5, 6] }],
      totalPot: 100,
    }),
    viewer: {
      userId: VIEWER_ID,
      seat: 4,
      canShowCards: false,
      walletBalance: 8_420,
      legalActions: legal({ canCheck: true, isBet: true, minTo: 10, maxTo: 1460, potTo: 100 }),
    },
    log: log(now, 70, [
      ["side_game", "Bomb pot! Everyone antes 20"],
      ["deal", "Board 1: A♥ 8♣ 3♦ · Board 2: Q♠ Q♦ 6♥"],
      ["action", "Hana checks"],
    ]),
  });
}

function runItTwiceBoards(now: number): TableView {
  const seats = [
    seat({ who: "diego", seat: 2, stack: 1200, allIn: false, hole: "9h 9c", handName: "Three of a Kind, Nines" }),
    seat({ who: "maya", seat: 3, stack: 1500, folded: true }),
    seat({ who: "sam", seat: 4, stack: 1200, hole: "Ac Kc", handName: "Full House, Kings full of Aces" }),
    seat({ who: "jonah", seat: 6, stack: 720, folded: true }),
  ];
  return base(now, {
    seats,
    hand: hand(now, {
      handNumber: 77,
      phase: "COMPLETE",
      runItTwice: true,
      boards: [cards("Kd 9s 4h 2c Jd"), cards("Kd 9s 4h Ah Ks")],
      buttonSeat: 2,
      smallBlindSeat: 3,
      bigBlindSeat: 4,
      pots: [{ amount: 2400, eligibleSeats: [2, 4] }],
      totalPot: 2400,
      result: {
        winners: [
          { seat: 2, userId: PEOPLE.diego.id, amount: 1200, potIndex: 0, boardIndex: 0, handName: "Three of a Kind, Nines" },
          { seat: 4, userId: VIEWER_ID, amount: 1200, potIndex: 0, boardIndex: 1, handName: "Full House, Kings full of Aces" },
        ],
        shown: [
          { seat: 2, cards: cards("9h 9c"), handName: "Three of a Kind, Nines" },
          { seat: 4, cards: cards("Ac Kc"), handName: "Full House, Kings full of Aces" },
        ],
        uncalledReturn: { seat: 4, amount: 140 },
        sidePayments: [],
      },
    }),
    nextHandAt: iso(now + 5000),
    log: log(now, 77, [
      ["action", "Sam goes all-in for 1,200, Diego calls"],
      ["vote", "Both players agreed to run it twice"],
      ["deal", "Run 1: 2♣ J♦ · Run 2: A♥ K♠"],
      ["award", "Diego wins run 1 (1,200) with Three of a Kind, Nines"],
      ["award", "Sam wins run 2 (1,200) with Full House, Kings full of Aces"],
    ]),
  });
}

function runItTwicePrompt(now: number): TableView {
  const seats = [
    seat({ who: "diego", seat: 2, stack: 0, allIn: true, hole: "9h 9c", lastAction: { type: "call", amount: 1060 } }),
    seat({ who: "maya", seat: 3, stack: 1500, folded: true }),
    seat({ who: "sam", seat: 4, stack: 0, allIn: true, hole: "Ac Kc", lastAction: { type: "allin", amount: 1060 } }),
  ];
  return base(now, {
    seats,
    hand: hand(now, {
      handNumber: 77,
      phase: "FLOP",
      boards: [cards("Kd 9s 4h")],
      buttonSeat: 2,
      smallBlindSeat: 3,
      bigBlindSeat: 4,
      pots: [{ amount: 2260, eligibleSeats: [2, 4] }],
      totalPot: 2260,
    }),
    votes: [
      mkVote(now, {
        kind: "RUN_IT_TWICE",
        proposedBy: "diego",
        rule: "unanimous",
        eligible: ["diego", "sam"],
        yes: ["diego"],
        expiresAt: iso(now + 9000),
      }),
    ],
    log: log(now, 77, [
      ["action", "Sam goes all-in for 1,060"],
      ["action", "Diego calls 1,060"],
      ["vote", "Run it twice? Waiting for Sam and Diego"],
    ]),
  });
}

function nitGameRunning(now: number): TableView {
  const nits: Who[] = ["jonah", "priya", "sam"];
  const seats = ALL6.map((who, i) =>
    seat({
      who,
      seat: i + 1,
      stack: [1320, 980, 1105, 760, 1440, 890][i],
      isNit: nits.includes(who),
      hole: who === "sam" ? "Td 9d" : undefined,
      bet: who === "maya" || who === "jonah" ? 40 : 0,
      lastAction:
        who === "maya"
          ? { type: "bet", amount: 40 }
          : who === "jonah"
            ? { type: "call", amount: 40 }
            : who === "sam"
              ? { type: "check", amount: null }
              : null,
      folded: who === "diego",
    }),
  );
  return base(now, {
    settings: settings({ nitGame: { enabled: true, penaltyBB: 5, voteRule: "unanimous" } }),
    seats,
    sideGames: {
      nitGame: { active: true, nitUserIds: nits.map((w) => PEOPLE[w].id), participantUserIds: ALL6.map((w) => PEOPLE[w].id) },
      bountyGame: { active: false },
      bombPotQueued: false,
      handsUntilAutoBombPot: null,
    },
    hand: hand(now, {
      handNumber: 88,
      phase: "FLOP",
      boards: [cards("Jc 8d 2h")],
      buttonSeat: 6,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      toActSeat: 4,
      currentBet: 40,
      pots: [{ amount: 120, eligibleSeats: [1, 2, 3, 4, 6] }],
      totalPot: 200,
    }),
    viewer: {
      userId: VIEWER_ID,
      seat: 1,
      canShowCards: false,
      walletBalance: 5_000,
      legalActions: null,
    },
    votes: [
      mkVote(now, {
        kind: "NIT_GAME",
        action: "STOP",
        rule: "unanimous",
        proposedBy: "diego",
        eligible: ALL6,
        yes: ["diego", "hana"],
      }),
    ],
    log: log(now, 88, [
      ["side_game", "Nit game started. 6 players are nits."],
      ["side_game", "Maya won a pot and is safe"],
      ["side_game", "Diego won a pot and is safe"],
      ["side_game", "Hana won a pot and is safe"],
      ["deal", "Flop: J♣ 8♦ 2♥"],
      ["action", "Sam checks"],
      ["action", "Maya bets 40"],
      ["action", "Jonah calls 40"],
      ["vote", "Diego proposed stopping the nit game"],
    ]),
  });
}

function nitGamePenalty(now: number): TableView {
  const v = nitGameRunning(now);
  const penalty = 50;
  const others: Who[] = ["sam", "maya", "jonah", "diego", "hana"];
  return {
    ...v,
    votes: [],
    seats: v.seats.map((s) => ({
      ...s,
      bet: 0,
      lastAction: null,
      folded: s.userId !== PEOPLE.jonah.id && s.userId !== PEOPLE.priya.id,
      isNit: s.userId === PEOPLE.priya.id,
      holeCards: s.userId === PEOPLE.jonah.id ? cards("Js Jd") : s.holeCards,
      handName: s.userId === PEOPLE.jonah.id ? "Three of a Kind, Jacks" : null,
    })),
    sideGames: { ...v.sideGames, nitGame: { ...v.sideGames.nitGame, nitUserIds: [PEOPLE.priya.id] } },
    hand: {
      ...v.hand!,
      handNumber: 91,
      handId: "h-91",
      phase: "COMPLETE",
      toActSeat: null,
      actionDeadline: null,
      currentBet: 0,
      boards: [cards("Jc 8d 2h 5s Kd")],
      pots: [{ amount: 460, eligibleSeats: [3, 4] }],
      totalPot: 460,
      result: {
        winners: [{ seat: 3, userId: PEOPLE.jonah.id, amount: 460, potIndex: 0, boardIndex: 0, handName: "Three of a Kind, Jacks" }],
        shown: [{ seat: 3, cards: cards("Js Jd"), handName: "Three of a Kind, Jacks" }],
        uncalledReturn: null,
        sidePayments: others.map((who) => ({
          fromSeat: 4,
          toSeat: ALL6.indexOf(who) + 1,
          amount: penalty,
          reason: "NIT_GAME" as const,
        })),
      },
    },
    viewer: { ...v.viewer, legalActions: null, canShowCards: true },
    nextHandAt: iso(now + 8000),
    log: [
      ...v.log,
      ...log(now, 91, [
        ["award", "Jonah wins 460 with Three of a Kind, Jacks"],
        ["side_game", "Jonah won a pot and is safe"],
        ["side_game", "Priya is the last nit and pays 50 to each player (250)"],
      ]),
    ],
  };
}

function bountyPayout(now: number): TableView {
  const seats = ALL6.map((who, i) =>
    seat({
      who,
      seat: i + 1,
      stack: [1180, 1450, 905, 1615, 700, 1010][i],
      folded: who !== "priya" && who !== "sam",
      hole: who === "priya" ? "7d 2s" : who === "sam" ? "Kc Ts" : undefined,
      handName: who === "priya" ? "Two Pair, Sevens and Twos" : null,
    }),
  );
  const payers: Who[] = ["sam", "maya", "jonah", "diego", "hana"];
  return base(now, {
    seats,
    sideGames: {
      nitGame: { active: false, nitUserIds: [], participantUserIds: [] },
      bountyGame: { active: true },
      bombPotQueued: false,
      handsUntilAutoBombPot: null,
    },
    hand: hand(now, {
      handNumber: 95,
      phase: "COMPLETE",
      boards: [cards("7h 2c Kd 9s 3h")],
      buttonSeat: 3,
      smallBlindSeat: 4,
      bigBlindSeat: 5,
      pots: [{ amount: 640, eligibleSeats: [1, 4] }],
      totalPot: 640,
      result: {
        winners: [{ seat: 4, userId: PEOPLE.priya.id, amount: 640, potIndex: 0, boardIndex: 0, handName: "Two Pair, Sevens and Twos" }],
        shown: [{ seat: 4, cards: cards("7d 2s"), handName: "Two Pair, Sevens and Twos" }],
        uncalledReturn: null,
        sidePayments: payers.map((who) => ({
          fromSeat: ALL6.indexOf(who) + 1,
          toSeat: 4,
          amount: 20,
          reason: "BOUNTY_7_2" as const,
        })),
      },
    }),
    viewer: { userId: VIEWER_ID, seat: 1, legalActions: null, canShowCards: true, walletBalance: 9_100 },
    nextHandAt: iso(now + 7000),
    log: log(now, 95, [
      ["action", "Priya bets 200, Sam calls"],
      ["showdown", "Priya shows 7♦ 2♠ (Two Pair, Sevens and Twos)"],
      ["award", "Priya wins 640"],
      ["side_game", "7-2 bounty! Priya collects 20 from 5 players (100)"],
    ]),
  });
}

function bombPotVote(now: number): TableView {
  const v = preflopViewerToAct(now);
  return {
    ...v,
    viewer: { ...v.viewer, legalActions: null },
    hand: { ...v.hand!, toActSeat: 5 },
    votes: [
      mkVote(now, {
        kind: "BOMB_POT",
        proposedBy: "maya",
        rule: "majority",
        eligible: ALL6,
        yes: ["maya", "hana"],
        no: ["diego"],
      }),
    ],
    log: [...v.log, ...log(now, 42, [["vote", "Maya proposed a bomb pot for the next hand"]])],
  };
}

function spectator(now: number): TableView {
  const seats = [
    seat({ who: "priya", seat: 1, stack: 1170, bet: 30, lastAction: { type: "raise", amount: 30 } }),
    seat({ who: "diego", seat: 2, stack: 860, folded: true, lastAction: { type: "fold", amount: null } }),
    seat({ who: "maya", seat: 5, stack: 2195, bet: 5, lastAction: { type: "post", amount: 5 } }),
    seat({ who: "jonah", seat: 6, stack: 990, bet: 10, lastAction: { type: "post", amount: 10 }, connected: false }),
  ];
  return base(now, {
    hostUserId: PEOPLE.maya.id,
    seats,
    hand: hand(now, {
      handNumber: 42,
      buttonSeat: 2,
      smallBlindSeat: 5,
      bigBlindSeat: 6,
      toActSeat: 5,
      currentBet: 30,
      totalPot: 45,
    }),
    log: log(now, 42, [
      ["action", "Maya posts small blind 5"],
      ["action", "Jonah posts big blind 10"],
      ["action", "Priya raises to 30"],
      ["action", "Diego folds"],
    ]),
  });
}

function viewerSittingOut(now: number): TableView {
  const v = spectator(now);
  return {
    ...v,
    hostUserId: VIEWER_ID,
    seats: [
      ...v.seats,
      seat({ who: "sam", seat: 3, stack: 1240, status: "SITTING_OUT", inHand: false, cardCount: 0 }),
    ].sort((a, b) => a.seat - b.seat),
    viewer: { ...v.viewer, seat: 3 },
  };
}

function headsUp(now: number): TableView {
  const seats = [
    seat({ who: "sam", seat: 1, stack: 995, bet: 5, hole: "8s 8c", lastAction: { type: "post", amount: 5 } }),
    seat({ who: "maya", seat: 2, stack: 1490, bet: 10, lastAction: { type: "post", amount: 10 } }),
  ];
  return base(now, {
    settings: settings({ maxPlayers: 2 }),
    name: "Heads-up duel",
    seats,
    hand: hand(now, {
      handNumber: 12,
      buttonSeat: 1,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      toActSeat: 1,
      currentBet: 10,
      totalPot: 15,
    }),
    viewer: {
      userId: VIEWER_ID,
      seat: 1,
      canShowCards: false,
      walletBalance: 3_200,
      legalActions: legal({ callAmount: 5, minTo: 20, maxTo: 1000, potTo: 30 }),
    },
    log: log(now, 12, [
      ["deal", "Hand #12 · Sam has the button"],
      ["action", "Sam posts small blind 5"],
      ["action", "Maya posts big blind 10"],
    ]),
  });
}

function nineHanded(now: number): TableView {
  const order: Who[] = ["sam", "maya", "jonah", "priya", "diego", "hana", "felix", "noor", "theo"];
  const bets: Partial<Record<Who, number>> = { noor: 0, theo: 60, maya: 60, felix: 0 };
  const actions: Partial<Record<Who, TableSeatView["lastAction"]>> = {
    theo: { type: "bet", amount: 60 },
    maya: { type: "call", amount: 60 },
    jonah: { type: "fold", amount: null },
    priya: { type: "fold", amount: null },
    felix: { type: "check", amount: null },
  };
  const seats = order.map((who, i) =>
    seat({
      who,
      seat: i + 1,
      stack: [1840, 1325, 975, 2210, 640, 1400, 1115, 3020, 860][i],
      bet: bets[who] ?? 0,
      lastAction: actions[who] ?? null,
      folded: who === "jonah" || who === "priya" || who === "diego",
      hole: who === "sam" ? "Jh Th" : undefined,
      status: who === "hana" ? "SITTING_OUT" : "ACTIVE",
      inHand: who !== "hana",
      cardCount: who === "hana" ? 0 : 2,
    }),
  );
  return base(now, {
    settings: settings({ maxPlayers: 9 }),
    name: "Full Ring",
    seats,
    hand: hand(now, {
      handNumber: 133,
      phase: "FLOP",
      boards: [cards("Th 7c 3h")],
      buttonSeat: 5,
      smallBlindSeat: 7,
      bigBlindSeat: 8,
      toActSeat: 1,
      currentBet: 60,
      pots: [{ amount: 270, eligibleSeats: [1, 2, 7, 8, 9] }],
      totalPot: 390,
    }),
    viewer: {
      userId: VIEWER_ID,
      seat: 1,
      canShowCards: false,
      walletBalance: 18_000,
      legalActions: legal({ callAmount: 60, minTo: 120, maxTo: 1840, potTo: 570 }),
    },
    log: log(now, 133, [
      ["deal", "Flop: T♥ 7♣ 3♥"],
      ["action", "Felix checks"],
      ["action", "Noor checks"],
      ["action", "Theo bets 60"],
      ["action", "Maya calls 60"],
    ]),
  });
}

function plo(now: number): TableView {
  const seats = [
    seat({ who: "priya", seat: 1, stack: 965, bet: 35, cardCount: 4, lastAction: { type: "raise", amount: 35 } }),
    seat({ who: "diego", seat: 2, stack: 1010, cardCount: 4, folded: true, lastAction: { type: "fold", amount: null } }),
    seat({ who: "sam", seat: 4, stack: 1500, hole: "Ah Kh Jd Td" }),
    seat({ who: "maya", seat: 5, stack: 1200, bet: 5, cardCount: 4, lastAction: { type: "post", amount: 5 } }),
    seat({ who: "jonah", seat: 6, stack: 870, bet: 10, cardCount: 4, lastAction: { type: "post", amount: 10 } }),
  ];
  return base(now, {
    name: "PLO Thursdays",
    settings: settings({ variant: "PLO" }),
    seats,
    hand: hand(now, {
      handNumber: 8,
      buttonSeat: 4,
      smallBlindSeat: 5,
      bigBlindSeat: 6,
      toActSeat: 4,
      currentBet: 35,
      totalPot: 50,
    }),
    viewer: {
      userId: VIEWER_ID,
      seat: 4,
      canShowCards: false,
      walletBalance: 7_250,
      legalActions: legal({ callAmount: 35, minTo: 60, maxTo: 120, potTo: 120 }),
    },
    log: log(now, 8, [
      ["action", "Maya posts small blind 5"],
      ["action", "Jonah posts big blind 10"],
      ["action", "Priya raises pot to 35"],
      ["action", "Diego folds"],
    ]),
  });
}

function timeBankRunning(now: number): TableView {
  const seats = [
    seat({ who: "priya", seat: 1, stack: 1170, bet: 120, lastAction: { type: "bet", amount: 120 } }),
    seat({ who: "hana", seat: 3, stack: 640, folded: true, lastAction: { type: "fold", amount: null } }),
    seat({ who: "sam", seat: 4, stack: 1480, hole: "9c 9s" }),
    seat({ who: "jonah", seat: 6, stack: 990, timeBankSec: 18 }),
  ];
  return base(now, {
    seats,
    hand: hand(now, {
      handNumber: 46,
      phase: "TURN",
      boards: [cards("Qd 9h 5c 5d")],
      buttonSeat: 4,
      smallBlindSeat: 6,
      bigBlindSeat: 1,
      toActSeat: 6,
      currentBet: 120,
      usingTimeBank: true,
      actionDeadline: iso(now + 18_000),
      pots: [{ amount: 340, eligibleSeats: [1, 4, 6] }],
      totalPot: 460,
    }),
    log: log(now, 46, [
      ["deal", "Turn: Q♦ 9♥ 5♣ 5♦"],
      ["action", "Priya bets 120"],
      ["action", "Hana folds"],
      ["system", "Jonah is using their time bank"],
    ]),
  });
}

export const FIXTURE_CHAT: ChatMessage[] = [
  { id: "c1", tableId: TABLE_ID, userId: PEOPLE.maya.id, displayName: "Maya", text: "gl everyone", emoteId: null, sentAt: "" },
  { id: "c2", tableId: TABLE_ID, userId: PEOPLE.jonah.id, displayName: "Jonah", text: null, emoteId: "14", sentAt: "" },
  { id: "c3", tableId: TABLE_ID, userId: PEOPLE.priya.id, displayName: "Priya", text: "bomb pot next?", emoteId: null, sentAt: "" },
  { id: "c4", tableId: TABLE_ID, userId: VIEWER_ID, displayName: "Sam", text: "I'm in", emoteId: null, sentAt: "" },
];

export type Scenario = {
  id: string;
  label: string;
  group: "Lobby" | "Betting" | "Results" | "Side games" | "Layouts";
  build: (now: number) => TableView;
};

export const SCENARIOS: Scenario[] = [
  { id: "empty", label: "Empty table, open seats", group: "Lobby", build: emptyTable },
  { id: "waiting", label: "Waiting for players", group: "Lobby", build: waitingForPlayers },
  { id: "ready", label: "Host can start", group: "Lobby", build: readyToStart },
  { id: "preflop", label: "Preflop, you to act", group: "Betting", build: preflopViewerToAct },
  { id: "multiway", label: "Multiway, side pots + all-ins", group: "Betting", build: multiwaySidePots },
  { id: "timebank", label: "Timer with time bank", group: "Betting", build: timeBankRunning },
  { id: "showdown", label: "Showdown, winners", group: "Results", build: showdownWinners },
  { id: "rit-board", label: "Run it twice, two boards", group: "Results", build: runItTwiceBoards },
  { id: "bounty", label: "7-2 bounty payout", group: "Results", build: bountyPayout },
  { id: "nit-penalty", label: "Nit game penalty", group: "Results", build: nitGamePenalty },
  { id: "bomb", label: "Bomb pot, double board", group: "Side games", build: bombPotDoubleBoard },
  { id: "bomb-vote", label: "Bomb pot vote open", group: "Side games", build: bombPotVote },
  { id: "nit", label: "Nit game + open vote", group: "Side games", build: nitGameRunning },
  { id: "rit-vote", label: "Run it twice prompt", group: "Side games", build: runItTwicePrompt },
  { id: "spectator", label: "Spectator", group: "Layouts", build: spectator },
  { id: "sitting-out", label: "You are sitting out", group: "Layouts", build: viewerSittingOut },
  { id: "heads-up", label: "Heads-up", group: "Layouts", build: headsUp },
  { id: "nine", label: "9-handed", group: "Layouts", build: nineHanded },
  { id: "plo", label: "PLO (4 cards)", group: "Layouts", build: plo },
];
