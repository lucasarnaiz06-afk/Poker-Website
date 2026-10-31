import { describe, expect, it } from "vitest";
import { DEFAULT_TABLE_SETTINGS, type TableSettings } from "../types/table-settings";
import { extractInviteCode, isValidInviteCode } from "./invite-link";
import { generateInviteCode } from "./invite-codes";
import { TABLE_SETTINGS_PRESETS } from "./presets";
import { createGameInputSchema, parseTableSettings, readStoredTableSettings } from "./settings-schema";
import { getTableFeatures } from "./table-features";

const valid = (patch: Partial<TableSettings> = {}): TableSettings => ({ ...DEFAULT_TABLE_SETTINGS, ...patch });

function issuePaths(input: unknown) {
  const result = parseTableSettings(input);

  return result.ok ? [] : result.issues.map((issue) => issue.path);
}

describe("parseTableSettings", () => {
  it("presets use one vote rule (majority) for every side game", () => {
    for (const preset of TABLE_SETTINGS_PRESETS) {
      const s = preset.settings;
      expect([s.bombPot.voteRule, s.nitGame.voteRule, s.bountyGame.voteRule], preset.id).toEqual(["majority", "majority", "majority"]);
    }
  });

  it("accepts the defaults and every preset", () => {
    expect(parseTableSettings(DEFAULT_TABLE_SETTINGS).ok).toBe(true);

    for (const preset of TABLE_SETTINGS_PRESETS) {
      expect(parseTableSettings(preset.settings), preset.id).toEqual({ ok: true, settings: preset.settings });
    }
  });

  it("requires smallBlind < bigBlind", () => {
    expect(issuePaths(valid({ smallBlind: 10, bigBlind: 10 }))).toContain("smallBlind");
    expect(issuePaths(valid({ smallBlind: 0 }))).toContain("smallBlind");
  });

  it("requires ante <= bigBlind and non-negative", () => {
    expect(issuePaths(valid({ ante: 11 }))).toContain("ante");
    expect(issuePaths(valid({ ante: -1 }))).toContain("ante");
    expect(parseTableSettings(valid({ ante: 10 })).ok).toBe(true);
  });

  it("requires minBuyIn <= maxBuyIn and both within 20-500 BB", () => {
    expect(issuePaths(valid({ minBuyIn: 1500, maxBuyIn: 1000 }))).toContain("minBuyIn");
    expect(issuePaths(valid({ minBuyIn: 190 }))).toContain("minBuyIn");
    expect(issuePaths(valid({ maxBuyIn: 5010 }))).toContain("maxBuyIn");
    expect(parseTableSettings(valid({ minBuyIn: 200, maxBuyIn: 5000 })).ok).toBe(true);
  });

  it("enforces numeric limits and integers", () => {
    expect(issuePaths(valid({ maxPlayers: 10 }))).toContain("maxPlayers");
    expect(issuePaths(valid({ maxPlayers: 1 }))).toContain("maxPlayers");
    expect(issuePaths(valid({ actionTimeSec: 5 }))).toContain("actionTimeSec");
    expect(issuePaths(valid({ timeBankSec: 301 }))).toContain("timeBankSec");
    expect(issuePaths(valid({ bigBlind: 10.5 }))).toContain("bigBlind");
    expect(issuePaths(valid({ bombPot: { ...DEFAULT_TABLE_SETTINGS.bombPot, anteBB: 21 } }))).toContain(
      "bombPot.anteBB",
    );
    expect(issuePaths(valid({ bombPot: { ...DEFAULT_TABLE_SETTINGS.bombPot, everyNHands: 101 } }))).toContain(
      "bombPot.everyNHands",
    );
    expect(issuePaths(valid({ nitGame: { ...DEFAULT_TABLE_SETTINGS.nitGame, penaltyBB: 0 } }))).toContain(
      "nitGame.penaltyBB",
    );
    expect(issuePaths(valid({ bountyGame: { ...DEFAULT_TABLE_SETTINGS.bountyGame, bountyBB: 51 } }))).toContain(
      "bountyGame.bountyBB",
    );
  });

  it("rejects unknown fields and wrong types", () => {
    expect(parseTableSettings({ ...DEFAULT_TABLE_SETTINGS, rake: 5 }).ok).toBe(false);
    expect(parseTableSettings({ ...DEFAULT_TABLE_SETTINGS, variant: "STUD" }).ok).toBe(false);
    expect(parseTableSettings({ ...DEFAULT_TABLE_SETTINGS, bigBlind: "10" }).ok).toBe(false);
    expect(parseTableSettings(null).ok).toBe(false);
  });
});

describe("createGameInputSchema", () => {
  const base = { name: "Friday game", visibility: "PRIVATE", settings: DEFAULT_TABLE_SETTINGS };

  it("treats an empty password as none and enforces a minimum length", () => {
    expect(createGameInputSchema.parse({ ...base, password: "" }).password).toBeUndefined();
    expect(createGameInputSchema.safeParse({ ...base, password: "abc" }).success).toBe(false);
    expect(createGameInputSchema.parse({ ...base, password: "abcd" }).password).toBe("abcd");
  });

  it("trims and bounds the name", () => {
    expect(createGameInputSchema.parse({ ...base, name: "  Hi there  " }).name).toBe("Hi there");
    expect(createGameInputSchema.safeParse({ ...base, name: "  a " }).success).toBe(false);
  });
});

describe("readStoredTableSettings", () => {
  const legacy = { smallBlind: 1, bigBlind: 2, minBuyIn: 100, maxBuyIn: 400, maxPlayers: 6 };

  it("falls back to legacy columns for empty or invalid JSON", () => {
    for (const stored of [{}, null, "x", { bigBlind: -1 }]) {
      const settings = readStoredTableSettings(stored, legacy);

      expect(settings).toMatchObject(legacy);
      expect(settings.bombPot.enabled).toBe(false);
    }
  });

  it("returns stored settings when valid", () => {
    const stored = valid({ maxPlayers: 4, straddle: true });

    expect(readStoredTableSettings(stored, legacy)).toEqual(stored);
  });
});

describe("invite codes", () => {
  it("generates 10-char base62 codes", () => {
    const codes = new Set(Array.from({ length: 200 }, generateInviteCode));

    expect(codes.size).toBe(200);
    for (const code of codes) {
      expect(isValidInviteCode(code)).toBe(true);
    }
  });

  it("extracts codes from links and bare input", () => {
    expect(extractInviteCode(" Ab3dE6gH9k ")).toBe("Ab3dE6gH9k");
    expect(extractInviteCode("https://poker.example/lobby/join/Ab3dE6gH9k")).toBe("Ab3dE6gH9k");
    expect(extractInviteCode("https://poker.example/lobby/join/Ab3dE6gH9k?x=1")).toBe("Ab3dE6gH9k");
    expect(extractInviteCode("https://poker.example/lobby?invite=Ab3dE6gH9k")).toBe("Ab3dE6gH9k");
    expect(extractInviteCode("short")).toBeNull();
    expect(extractInviteCode("https://x/lobby/join/Ab3dE6gH9k-evil")).toBeNull();
  });
});

describe("getTableFeatures", () => {
  it("lists enabled features in display order", () => {
    expect(
      getTableFeatures(
        valid({
          straddle: true,
          runItTwice: true,
          bombPot: { ...DEFAULT_TABLE_SETTINGS.bombPot, enabled: true },
          nitGame: { ...DEFAULT_TABLE_SETTINGS.nitGame, enabled: false },
          bountyGame: { ...DEFAULT_TABLE_SETTINGS.bountyGame, enabled: true },
        }),
      ),
    ).toEqual(["BOMB_POT", "BOUNTY_GAME", "STRADDLE", "RUN_IT_TWICE"]);
  });
});
