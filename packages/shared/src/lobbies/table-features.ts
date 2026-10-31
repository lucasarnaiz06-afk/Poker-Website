import type { TableSettings } from "../types/table-settings";
import type { LobbyTableSummary } from "../types/table-view";

export type TableFeature = LobbyTableSummary["features"][number];

/** Display order used everywhere a table's features are listed. */
export const TABLE_FEATURE_ORDER: readonly TableFeature[] = [
  "BOMB_POT",
  "NIT_GAME",
  "BOUNTY_GAME",
  "STRADDLE",
  "RUN_IT_TWICE",
];

export const TABLE_FEATURE_LABELS: Record<TableFeature, string> = {
  BOMB_POT: "Bomb pots",
  NIT_GAME: "Nit game",
  BOUNTY_GAME: "7-2",
  STRADDLE: "Straddle",
  RUN_IT_TWICE: "RIT",
};

/** One-line, plain-English explanations (same copy as the Create game dialog and the table's Games menu). */
export const TABLE_FEATURE_DESCRIPTIONS: Record<TableFeature, string> = {
  BOMB_POT: "Everyone antes, no preflop betting, and the flop comes right away.",
  NIT_GAME: "The last player who hasn't won a pot pays everyone else.",
  BOUNTY_GAME: "Win a pot with 7-2 and show it to collect from everyone in the hand.",
  STRADDLE: "Players may post a 2x big blind straddle under the gun.",
  RUN_IT_TWICE: "All-in players can agree to deal the rest of the board twice.",
};

export function getTableFeatures(settings: TableSettings): TableFeature[] {
  const enabled: Record<TableFeature, boolean> = {
    BOMB_POT: settings.bombPot.enabled,
    NIT_GAME: settings.nitGame.enabled,
    BOUNTY_GAME: settings.bountyGame.enabled,
    STRADDLE: settings.straddle,
    RUN_IT_TWICE: settings.runItTwice,
  };

  return TABLE_FEATURE_ORDER.filter((feature) => enabled[feature]);
}

export const GAME_VARIANT_LABELS: Record<TableSettings["variant"], { short: string; long: string }> = {
  NLHE: { short: "Hold'em", long: "No-Limit Hold'em" },
  PLO: { short: "PLO", long: "Pot-Limit Omaha" },
};
