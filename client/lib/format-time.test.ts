import { describe, expect, it } from "vitest";
import { formatDateTime, formatDuration, formatRelative, pluralize } from "./format-time";

const tz = { timeZone: "UTC" };
const now = Date.parse("2026-10-29T12:00:00Z");

describe("format-time", () => {
  it("formats local date + time, with the year only for other years", () => {
    expect(formatDateTime("2026-10-29T05:27:00Z", { ...tz, now })).toBe("Oct 29, 5:27 AM");
    expect(formatDateTime("2025-12-31T17:05:00Z", { ...tz, now })).toBe("Dec 31, 2025, 5:05 PM");
  });

  it("is relative within 24 hours", () => {
    expect(formatRelative(now - 20_000, { ...tz, now })).toBe("just now");
    expect(formatRelative(now - 5 * 60_000, { ...tz, now })).toBe("5 min ago");
    expect(formatRelative(now - 3 * 3_600_000, { ...tz, now })).toBe("3 h ago");
    expect(formatRelative(now - 30 * 3_600_000, { ...tz, now })).toBe("Oct 28, 6:00 AM");
  });

  it("durations and plurals", () => {
    expect(formatDuration(5 * 3_600_000 + 12 * 60_000 + 5_000)).toBe("5h 12m");
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration(10_000)).toBe("under a minute");
    expect(pluralize(1, "hand")).toBe("1 hand");
    expect(pluralize(1200, "hand")).toBe("1,200 hands");
  });
});
