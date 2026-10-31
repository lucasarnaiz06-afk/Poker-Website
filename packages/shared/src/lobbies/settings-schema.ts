import { z } from "zod";
import { DEFAULT_TABLE_SETTINGS, TABLE_SETTINGS_LIMITS as LIMITS, type TableSettings } from "../types/table-settings";

const int = (min: number, max: number = Number.MAX_SAFE_INTEGER) =>
  z.number().int("Must be a whole number.").min(min).max(max);

const voteRuleSchema = z.enum(["majority", "unanimous"]);

const bombPotSchema = z
  .object({
    enabled: z.boolean(),
    anteBB: int(LIMITS.bombPotAnteBB.min, LIMITS.bombPotAnteBB.max),
    doubleBoard: z.boolean(),
    voteRule: voteRuleSchema,
    everyNHands: int(LIMITS.bombPotEveryNHands.min, LIMITS.bombPotEveryNHands.max),
  })
  .strict();

const nitGameSchema = z
  .object({
    enabled: z.boolean(),
    penaltyBB: int(LIMITS.nitPenaltyBB.min, LIMITS.nitPenaltyBB.max),
    voteRule: voteRuleSchema,
  })
  .strict();

const bountyGameSchema = z
  .object({
    enabled: z.boolean(),
    bountyBB: int(LIMITS.bountyBB.min, LIMITS.bountyBB.max),
    voteRule: voteRuleSchema,
  })
  .strict();

/**
 * Validates a full TableSettings object (all fields required, unknown fields rejected).
 * Enforces TABLE_SETTINGS_LIMITS plus the cross-field rules:
 * smallBlind < bigBlind, ante <= bigBlind, minBuyIn <= maxBuyIn and both buy-ins within the BB range.
 */
export const tableSettingsSchema = z
  .object({
    variant: z.enum(["NLHE", "PLO"]),
    smallBlind: int(1, LIMITS.bigBlind.max),
    bigBlind: int(LIMITS.bigBlind.min, LIMITS.bigBlind.max),
    ante: int(LIMITS.ante.min, LIMITS.bigBlind.max),
    minBuyIn: int(1),
    maxBuyIn: int(1),
    maxPlayers: int(LIMITS.maxPlayers.min, LIMITS.maxPlayers.max),
    actionTimeSec: int(LIMITS.actionTimeSec.min, LIMITS.actionTimeSec.max),
    timeBankSec: int(LIMITS.timeBankSec.min, LIMITS.timeBankSec.max),
    straddle: z.boolean(),
    runItTwice: z.boolean(),
    allowSpectators: z.boolean(),
    chatEnabled: z.boolean(),
    autoStart: z.boolean(),
    bombPot: bombPotSchema,
    nitGame: nitGameSchema,
    bountyGame: bountyGameSchema,
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.smallBlind >= s.bigBlind) {
      ctx.addIssue({
        code: "custom",
        path: ["smallBlind"],
        message: "Small blind must be less than the big blind.",
      });
    }

    if (s.ante > s.bigBlind) {
      ctx.addIssue({
        code: "custom",
        path: ["ante"],
        message: "Ante can't be larger than the big blind.",
      });
    }

    if (s.minBuyIn > s.maxBuyIn) {
      ctx.addIssue({
        code: "custom",
        path: ["minBuyIn"],
        message: "Minimum buy-in can't be larger than the maximum.",
      });
    }

    const minAllowed = s.bigBlind * LIMITS.buyInBB.min;
    const maxAllowed = s.bigBlind * LIMITS.buyInBB.max;

    for (const key of ["minBuyIn", "maxBuyIn"] as const) {
      if (s[key] < minAllowed || s[key] > maxAllowed) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `Buy-ins must be between ${LIMITS.buyInBB.min} and ${LIMITS.buyInBB.max} big blinds.`,
        });
      }
    }
  }) satisfies z.ZodType<TableSettings>;

export type TableSettingsIssue = { path: string; message: string };

export type ParseTableSettingsResult =
  { ok: true; settings: TableSettings } | { ok: false; issues: TableSettingsIssue[] };

function toIssues(error: z.ZodError): TableSettingsIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/** Safe-parses untrusted input into TableSettings. Never throws. */
export function parseTableSettings(input: unknown): ParseTableSettingsResult {
  const result = tableSettingsSchema.safeParse(input);

  return result.success ? { ok: true, settings: result.data } : { ok: false, issues: toIssues(result.error) };
}

/** Legacy columns kept on Lobby for older readers; settings JSON is the source of truth. */
export type LegacyLobbyColumns = {
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxPlayers: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads Lobby.settings JSON from the database. Lobbies created before settings existed store `{}`;
 * those get DEFAULT_TABLE_SETTINGS with the legacy columns applied. Never throws.
 */
export function readStoredTableSettings(stored: unknown, legacy: LegacyLobbyColumns): TableSettings {
  if (isRecord(stored)) {
    const merged = {
      ...DEFAULT_TABLE_SETTINGS,
      ...stored,
      bombPot: { ...DEFAULT_TABLE_SETTINGS.bombPot, ...(isRecord(stored.bombPot) ? stored.bombPot : {}) },
      nitGame: { ...DEFAULT_TABLE_SETTINGS.nitGame, ...(isRecord(stored.nitGame) ? stored.nitGame : {}) },
      bountyGame: {
        ...DEFAULT_TABLE_SETTINGS.bountyGame,
        ...(isRecord(stored.bountyGame) ? stored.bountyGame : {}),
      },
    };
    const parsed = tableSettingsSchema.safeParse(merged);

    if (parsed.success && Object.keys(stored).length > 0) {
      return parsed.data;
    }
  }

  // Legacy lobby: the old columns are authoritative. Side games off to preserve old behaviour.
  return {
    ...DEFAULT_TABLE_SETTINGS,
    smallBlind: legacy.smallBlind,
    bigBlind: legacy.bigBlind,
    minBuyIn: legacy.minBuyIn,
    maxBuyIn: legacy.maxBuyIn,
    maxPlayers: legacy.maxPlayers,
    bombPot: { ...DEFAULT_TABLE_SETTINGS.bombPot, enabled: false },
  };
}

export const LOBBY_NAME_LIMITS = { min: 3, max: 40 } as const;
export const LOBBY_PASSWORD_LIMITS = { min: 4, max: 64 } as const;

/** Input for "Create game" (server action / route handler). Unknown fields rejected. */
export const createGameInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(LOBBY_NAME_LIMITS.min, `Name must be at least ${LOBBY_NAME_LIMITS.min} characters.`)
      .max(LOBBY_NAME_LIMITS.max, `Name must be at most ${LOBBY_NAME_LIMITS.max} characters.`),
    visibility: z.enum(["PUBLIC", "PRIVATE"]),
    password: z
      .string()
      .max(LOBBY_PASSWORD_LIMITS.max)
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined))
      .refine((value) => value === undefined || value.length >= LOBBY_PASSWORD_LIMITS.min, {
        message: `Password must be at least ${LOBBY_PASSWORD_LIMITS.min} characters.`,
      }),
    settings: tableSettingsSchema,
  })
  .strict();

export type CreateGameInput = z.output<typeof createGameInputSchema>;
