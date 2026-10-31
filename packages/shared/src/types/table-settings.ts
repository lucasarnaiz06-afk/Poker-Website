// Table settings chosen by the host when a game is created. Stored as JSON on Lobby.settings.
// All chip amounts are integers (play-money chips). "BB" fields are multiples of the big blind.

export type GameVariant = "NLHE" | "PLO";

// majority: more than half of the eligible players vote yes before the vote expires.
// unanimous: every eligible player votes yes; any "no" fails it immediately.
export type VoteRule = "majority" | "unanimous";

export type BombPotSettings = {
  enabled: boolean;
  anteBB: number; // every dealt-in player antes this many BB; no preflop betting, flop dealt immediately
  doubleBoard: boolean; // two boards, each pot split half per board
  voteRule: VoteRule;
  everyNHands: number; // 0 = only by vote; N > 0 = also automatically every N hands
};

export type NitGameSettings = {
  enabled: boolean;
  penaltyBB: number; // the last remaining nit pays this to every other participant
  voteRule: VoteRule;
};

export type BountyGameSettings = {
  enabled: boolean;
  bountyBB: number; // winning a pot with 7-2 (shown) collects this from every other dealt-in player
  voteRule: VoteRule;
};

export type TableSettings = {
  variant: GameVariant;
  smallBlind: number;
  bigBlind: number;
  ante: number; // regular per-hand ante, 0 = none
  minBuyIn: number;
  maxBuyIn: number;
  maxPlayers: number;
  actionTimeSec: number;
  timeBankSec: number;
  straddle: boolean; // players may opt in to a UTG straddle (2x BB)
  runItTwice: boolean; // all-in players may agree to run the remaining board twice
  allowSpectators: boolean;
  chatEnabled: boolean;
  autoStart: boolean; // deal automatically when >= 2 players are seated (else the host presses Start)
  bombPot: BombPotSettings;
  nitGame: NitGameSettings;
  bountyGame: BountyGameSettings;
};

export const TABLE_SETTINGS_LIMITS = {
  maxPlayers: { min: 2, max: 9 },
  bigBlind: { min: 2, max: 1_000_000 },
  ante: { min: 0 }, // ante <= bigBlind
  buyInBB: { min: 20, max: 500 }, // minBuyIn/maxBuyIn expressed in BB must stay in this range
  actionTimeSec: { min: 10, max: 120 },
  timeBankSec: { min: 0, max: 300 },
  bombPotAnteBB: { min: 1, max: 20 },
  bombPotEveryNHands: { min: 0, max: 100 },
  nitPenaltyBB: { min: 1, max: 50 },
  bountyBB: { min: 1, max: 50 },
} as const;

export const DEFAULT_TABLE_SETTINGS: TableSettings = {
  variant: "NLHE",
  smallBlind: 5,
  bigBlind: 10,
  ante: 0,
  minBuyIn: 400,
  maxBuyIn: 2000,
  maxPlayers: 9,
  actionTimeSec: 25,
  timeBankSec: 30,
  straddle: false,
  runItTwice: true,
  allowSpectators: true,
  chatEnabled: true,
  autoStart: true,
  bombPot: { enabled: true, anteBB: 2, doubleBoard: false, voteRule: "majority", everyNHands: 0 },
  nitGame: { enabled: false, penaltyBB: 5, voteRule: "unanimous" },
  bountyGame: { enabled: false, bountyBB: 2, voteRule: "unanimous" },
};
