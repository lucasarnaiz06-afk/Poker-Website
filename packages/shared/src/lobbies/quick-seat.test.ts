import { describe, expect, it } from "vitest";
import type { LobbyTableSummary } from "../types/table-view";
import { mostCommon, pickQuickSeatTable } from "./quick-seat";

function table(id: string, bigBlind: number, seated: number, extra: Partial<LobbyTableSummary> = {}): LobbyTableSummary {
  return {
    tableId: id,
    name: id,
    variant: "NLHE",
    smallBlind: bigBlind / 2,
    bigBlind,
    minBuyIn: bigBlind * 40,
    maxBuyIn: bigBlind * 100,
    maxPlayers: 6,
    seated,
    visibility: "PUBLIC",
    status: "WAITING",
    features: [],
    avgPot: null,
    handsPerHour: null,
    hasPassword: false,
    ante: 0,
    ...extra,
  };
}

describe("pickQuickSeatTable", () => {
  const tables = [
    table("low-empty", 2, 0),
    table("low-busy", 2, 4),
    table("low-full", 2, 6),
    table("mid", 10, 5),
    table("high", 200, 3),
    table("locked", 2, 5, { hasPassword: true }),
    table("private", 2, 5, { visibility: "PRIVATE" }),
  ];

  it("without history: lowest stakes, best-filled table with a free seat", () => {
    expect(pickQuickSeatTable(tables, { usualBigBlind: null, balance: 10_000 })?.tableId).toBe("low-busy");
  });

  it("with history: the usual stakes, or the closest", () => {
    expect(pickQuickSeatTable(tables, { usualBigBlind: 10, balance: 10_000 })?.tableId).toBe("mid");
    expect(pickQuickSeatTable(tables, { usualBigBlind: 100, balance: 100_000 })?.tableId).toBe("high");
    expect(pickQuickSeatTable(tables, { usualBigBlind: 8, balance: 10_000 })?.tableId).toBe("mid");
  });

  it("skips tables the player can't afford or is excluded from; null when nothing fits", () => {
    expect(pickQuickSeatTable(tables, { usualBigBlind: 100, balance: 1_000 })?.tableId).toBe("mid");
    expect(pickQuickSeatTable(tables, { usualBigBlind: null, balance: 10_000, excludeTableIds: new Set(["low-busy", "low-empty"]) })?.tableId).toBe("mid");
    expect(pickQuickSeatTable(tables, { usualBigBlind: null, balance: 10 })).toBeNull();
    expect(pickQuickSeatTable([], { usualBigBlind: null, balance: 10_000 })).toBeNull();
  });
});

describe("mostCommon", () => {
  it("returns the most frequent value, the lower one on ties", () => {
    expect(mostCommon([10, 2, 10, 2, 50])).toBe(2);
    expect(mostCommon([10, 10, 2])).toBe(10);
    expect(mostCommon([])).toBeNull();
  });
});
