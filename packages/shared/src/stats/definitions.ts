// Stat names, one-sentence explanations and formatting helpers shared by every stats screen. Browser-safe.

export type StatKey =
  | "hands"
  | "net"
  | "netBB"
  | "bb100"
  | "vpip"
  | "pfr"
  | "threeBet"
  | "foldToThreeBet"
  | "limp"
  | "af"
  | "wtsd"
  | "wsd"
  | "cbet"
  | "foldToCbet"
  | "biggestPot"
  | "showdownWins"
  | "allInEv";

export type StatDefinition = { key: StatKey; label: string; short: string; explain: string };

export const STAT_DEFINITIONS: Record<StatKey, StatDefinition> = {
  hands: { key: "hands", label: "Hands", short: "Hands", explain: "How many hands you were dealt into." },
  net: { key: "net", label: "Net won", short: "Net", explain: "Chips won minus chips lost, including side-game payments." },
  netBB: {
    key: "netBB",
    label: "Net won (BB)",
    short: "BB",
    explain: "Your net result measured in big blinds, so results at different stakes add up fairly.",
  },
  bb100: {
    key: "bb100",
    label: "bb/100",
    short: "bb/100",
    explain: "Big blinds won per 100 hands: the standard win rate (above 0 means you are winning).",
  },
  vpip: {
    key: "vpip",
    label: "VPIP",
    short: "VPIP",
    explain: "How often you put money in the pot by choice before the flop (blinds don't count).",
  },
  pfr: { key: "pfr", label: "PFR", short: "PFR", explain: "How often you raised before the flop." },
  threeBet: {
    key: "threeBet",
    label: "3-bet",
    short: "3B",
    explain: "When someone raised before the flop and you could re-raise, how often you did.",
  },
  foldToThreeBet: {
    key: "foldToThreeBet",
    label: "Fold to 3-bet",
    short: "F3B",
    explain: "When you raised first and someone re-raised, how often you folded.",
  },
  limp: { key: "limp", label: "Limp", short: "Limp", explain: "How often you just called the big blind as your first move instead of raising." },
  af: {
    key: "af",
    label: "AF",
    short: "AF",
    explain: "Aggression factor: your bets and raises divided by your calls after the flop (higher = more aggressive).",
  },
  wtsd: {
    key: "wtsd",
    label: "WTSD",
    short: "WTSD",
    explain: "Went to showdown: of the flops you saw, how often you stayed until the cards were turned over.",
  },
  wsd: { key: "wsd", label: "W$SD", short: "W$SD", explain: "Won money at showdown: how often you won when the cards were turned over." },
  cbet: {
    key: "cbet",
    label: "C-bet",
    short: "CB",
    explain: "Continuation bet: when you raised before the flop and could bet first on the flop, how often you did.",
  },
  foldToCbet: {
    key: "foldToCbet",
    label: "Fold to c-bet",
    short: "FCB",
    explain: "When the preflop raiser bet the flop into you, how often you folded.",
  },
  biggestPot: { key: "biggestPot", label: "Biggest pot", short: "Biggest", explain: "The most chips you collected in a single hand." },
  showdownWins: { key: "showdownWins", label: "Showdown wins", short: "SD wins", explain: "Hands you won when the cards were turned over." },
  allInEv: {
    key: "allInEv",
    label: "All-in EV",
    short: "EV",
    explain: "What you would have won on average in all-in hands given everyone's cards: luck removed.",
  },
};

/** A frequency stat: hits out of opportunities. value is a percentage (0-100) or null without opportunities. */
export type Ratio = { hits: number; n: number; value: number | null };

export function ratio(hits: number, n: number): Ratio {
  return { hits, n, value: n > 0 ? (100 * hits) / n : null };
}

export function bbPer100(netBB: number, hands: number): number | null {
  return hands > 0 ? (100 * netBB) / hands : null;
}

export function formatPct(value: number | null, digits = 0): string {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}

export function formatNumber(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

export function formatSignedNumber(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const body = formatNumber(Math.abs(value), digits);
  return value > 0 ? `+${body}` : value < 0 ? `−${body}` : body;
}

/** Colour tags for private player notes. */
export const NOTE_COLORS = ["none", "red", "orange", "yellow", "green", "blue", "purple"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const NOTE_COLOR_LABEL: Record<NoteColor, string> = {
  none: "No tag",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
};

/** Minimum hands for the bb/100 leaderboard. */
export const BB100_MIN_HANDS = 500;
/** New session after this many minutes without a hand. */
export const SESSION_GAP_MINUTES = 30;

export type PlayerNoteView = { subjectId: string; text: string; color: NoteColor; updatedAt: string | null };
