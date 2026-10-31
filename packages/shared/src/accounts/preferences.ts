import { z } from "zod";

/**
 * User preferences stored in User.preferences (JSON). Client-safe (zod only).
 *
 * - Read with `parsePreferences(json)`: never throws, fills defaults, drops unknown/invalid values.
 * - Write with `preferencesUpdateSchema` (strict partial) then merge.
 */

export const DECK_STYLES = ["clean", "four-color", "pixel"] as const;
export type DeckStyle = (typeof DECK_STYLES)[number];

export const THEMES = ["dark", "light"] as const;
export type ThemePreference = (typeof THEMES)[number];

/** Preflop presets are big-blind multiples (UI hints, e.g. 2.5 = 2.5 BB); runtime rounds to whole chips. */
const preflopPresetSchema = z.number().min(1).max(100).multipleOf(0.5);
/** Postflop presets are integer percentages of the pot (33 = 33% pot). */
const postflopPresetSchema = z.number().int().min(1).max(500);

export const betPresetsSchema = z
  .object({
    preflopBB: z.array(preflopPresetSchema).min(1).max(4),
    postflopPotPct: z.array(postflopPresetSchema).min(1).max(4),
  })
  .strict();

export type BetPresets = z.infer<typeof betPresetsSchema>;

export const DEFAULT_PREFERENCES = {
  deckStyle: "clean" as DeckStyle,
  sounds: true,
  autoMuckLosingHands: true,
  confirmFoldWhenCheckFree: true,
  betPresets: { preflopBB: [2.5, 3, 4], postflopPotPct: [33, 50, 75, 100] } as BetPresets,
  theme: "dark" as ThemePreference,
};

export const preferencesSchema = z
  .object({
    deckStyle: z.enum(DECK_STYLES),
    sounds: z.boolean(),
    autoMuckLosingHands: z.boolean(),
    confirmFoldWhenCheckFree: z.boolean(),
    betPresets: betPresetsSchema,
    theme: z.enum(THEMES),
  })
  .strict();

export type Preferences = z.infer<typeof preferencesSchema>;

/** For writes: any subset of fields, unknown keys rejected. */
export const preferencesUpdateSchema = preferencesSchema.partial().strict();
export type PreferencesUpdate = z.infer<typeof preferencesUpdateSchema>;

/** Lenient read: each field falls back to its default if missing or invalid. */
export function parsePreferences(raw: unknown): Preferences {
  const source = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const result = { ...DEFAULT_PREFERENCES, betPresets: { ...DEFAULT_PREFERENCES.betPresets } } as Preferences;
  const shape = preferencesSchema.shape;

  for (const key of Object.keys(shape) as Array<keyof Preferences>) {
    const parsed = shape[key].safeParse(source[key]);

    if (parsed.success) {
      (result as Record<keyof Preferences, unknown>)[key] = parsed.data;
    }
  }

  return result;
}

export function mergePreferences(current: unknown, update: PreferencesUpdate): Preferences {
  return preferencesSchema.parse({ ...parsePreferences(current), ...update });
}
