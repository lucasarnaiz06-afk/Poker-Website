import { DEFAULT_TABLE_SETTINGS, type TableSettings } from "../types/table-settings";

export type TableSettingsPresetId = "casual" | "six-max" | "heads-up";

export type TableSettingsPreset = {
  id: TableSettingsPresetId;
  label: string;
  description: string;
  suggestedName: string;
  settings: TableSettings;
};

/**
 * Every preset uses the same vote rule for every side game (majority), so turning one on later behaves the
 * same whichever preset you started from.
 */
const sideGamesOff: Pick<TableSettings, "bombPot" | "nitGame" | "bountyGame"> = {
  bombPot: { ...DEFAULT_TABLE_SETTINGS.bombPot, enabled: false, voteRule: "majority" },
  nitGame: { ...DEFAULT_TABLE_SETTINGS.nitGame, enabled: false, voteRule: "majority" },
  bountyGame: { ...DEFAULT_TABLE_SETTINGS.bountyGame, enabled: false, voteRule: "majority" },
};

export const TABLE_SETTINGS_PRESETS: readonly TableSettingsPreset[] = [
  {
    id: "casual",
    label: "Casual home game",
    description: "8 seats, deep stacks, straddles and every side game on.",
    suggestedName: "Home game",
    settings: {
      ...DEFAULT_TABLE_SETTINGS,
      maxPlayers: 8,
      smallBlind: 5,
      bigBlind: 10,
      minBuyIn: 500,
      maxBuyIn: 2000,
      actionTimeSec: 30,
      timeBankSec: 60,
      straddle: true,
      runItTwice: true,
      bombPot: { enabled: true, anteBB: 2, doubleBoard: true, voteRule: "majority", everyNHands: 0 },
      nitGame: { enabled: true, penaltyBB: 5, voteRule: "majority" },
      bountyGame: { enabled: true, bountyBB: 2, voteRule: "majority" },
    },
  },
  {
    id: "six-max",
    label: "Standard 6-max",
    description: "6 seats, 40-100 BB buy-ins, no side games.",
    suggestedName: "6-max",
    settings: {
      ...DEFAULT_TABLE_SETTINGS,
      ...sideGamesOff,
      maxPlayers: 6,
      smallBlind: 5,
      bigBlind: 10,
      minBuyIn: 400,
      maxBuyIn: 1000,
      actionTimeSec: 25,
      timeBankSec: 30,
      straddle: false,
      runItTwice: true,
    },
  },
  {
    id: "heads-up",
    label: "Heads-up",
    description: "2 seats, one on one, quick decisions.",
    suggestedName: "Heads-up",
    settings: {
      ...DEFAULT_TABLE_SETTINGS,
      ...sideGamesOff,
      maxPlayers: 2,
      smallBlind: 5,
      bigBlind: 10,
      minBuyIn: 500,
      maxBuyIn: 2000,
      actionTimeSec: 20,
      timeBankSec: 30,
      straddle: false,
      runItTwice: true,
    },
  },
];
