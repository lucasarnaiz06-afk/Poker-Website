import type { PublicCard, TableSettings, TableView, VoteKind } from "@poker-platform/shared/types";

const chipFormatter = new Intl.NumberFormat("en-US");
const bbFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function formatChips(amount: number): string {
  return chipFormatter.format(Math.round(amount));
}

export function formatBB(amount: number, bigBlind: number): string {
  if (bigBlind <= 0) return "0 BB";
  return `${bbFormatter.format(amount / bigBlind)} BB`;
}

/** Chips or BB depending on the viewer preference. */
export function formatAmount(amount: number, bigBlind: number, inBB: boolean): string {
  return inBB ? formatBB(amount, bigBlind) : formatChips(amount);
}

export function formatSigned(amount: number): string {
  return `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${formatChips(Math.abs(amount))}`;
}

export function formatBlinds(settings: TableSettings): string {
  const base = `${formatChips(settings.smallBlind)}/${formatChips(settings.bigBlind)}`;
  return settings.ante > 0 ? `${base} (ante ${formatChips(settings.ante)})` : base;
}

export function variantLabel(variant: TableSettings["variant"]): string {
  return variant === "PLO" ? "Pot-Limit Omaha" : "No-Limit Hold'em";
}

export function variantShort(variant: TableSettings["variant"]): string {
  return variant === "PLO" ? "PLO" : "NLH";
}

export const RANK_LABEL: Record<PublicCard["rank"], string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  T: "10",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A",
};

// U+FE0E forces text (not emoji) presentation on iOS/Android.
export const SUIT_SYMBOL: Record<PublicCard["suit"], string> = { c: "♣\uFE0E", d: "♦\uFE0E", h: "♥\uFE0E", s: "♠\uFE0E" };
export const SUIT_NAME: Record<PublicCard["suit"], string> = {
  c: "clubs",
  d: "diamonds",
  h: "hearts",
  s: "spades",
};
const RANK_NAME: Record<PublicCard["rank"], string> = {
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  T: "Ten",
  J: "Jack",
  Q: "Queen",
  K: "King",
  A: "Ace",
};

export function cardLabel(card: PublicCard): string {
  return `${RANK_NAME[card.rank]} of ${SUIT_NAME[card.suit]}`;
}

export function cardsLabel(cards: PublicCard[]): string {
  return cards.map(cardLabel).join(", ");
}

export function sameCard(a: PublicCard | undefined, b: PublicCard | undefined): boolean {
  return Boolean(a && b && a.rank === b.rank && a.suit === b.suit);
}

export const VOTE_KIND_LABEL: Record<VoteKind, string> = {
  BOMB_POT: "Bomb pot",
  NIT_GAME: "Nit game",
  BOUNTY_GAME: "7-2 bounty",
  RUN_IT_TWICE: "Run it twice",
};

export function voteTitle(kind: VoteKind, action: "START" | "STOP"): string {
  switch (kind) {
    case "BOMB_POT":
      return "Bomb pot next hand?";
    case "NIT_GAME":
      return action === "START" ? "Start a nit game?" : "Stop the nit game?";
    case "BOUNTY_GAME":
      return action === "START" ? "Start 7-2 bounty?" : "Stop 7-2 bounty?";
    case "RUN_IT_TWICE":
      return "Run it twice?";
  }
}

/** One-line plain-language explanations used in the Info tab, vote cards and the games menu. */
export function sideGameExplainer(kind: VoteKind, settings: TableSettings): string {
  const bb = settings.bigBlind;
  switch (kind) {
    case "BOMB_POT":
      return `Everyone antes ${formatChips(settings.bombPot.anteBB * bb)} (${settings.bombPot.anteBB} BB), no preflop betting, the flop comes straight away${
        settings.bombPot.doubleBoard ? " on two boards, each worth half the pot" : ""
      }.`;
    case "NIT_GAME":
      return `Everyone must win a pot. The last player who hasn't pays ${formatChips(
        settings.nitGame.penaltyBB * bb,
      )} (${settings.nitGame.penaltyBB} BB) to each other player.`;
    case "BOUNTY_GAME":
      return `Win a pot with 7-2 and show it to collect ${formatChips(
        settings.bountyGame.bountyBB * bb,
      )} (${settings.bountyGame.bountyBB} BB) from every other player in the hand.`;
    case "RUN_IT_TWICE":
      return "When players are all-in before the river, they can agree to deal the rest of the board twice and split each pot.";
  }
}

export function voteRuleLabel(rule: "majority" | "unanimous"): string {
  return rule === "majority" ? "Majority wins" : "Everyone must agree";
}

export function seatName(view: TableView, seat: number): string {
  return view.seats.find((s) => s.seat === seat)?.displayName ?? `Seat ${seat}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_HUES = [158, 200, 230, 262, 290, 330, 18, 38, 96];
export function avatarHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
