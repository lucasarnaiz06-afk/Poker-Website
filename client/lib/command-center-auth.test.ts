import { describe, expect, it } from "vitest";
import {
  COMMAND_CENTER_SESSION_TTL_MS,
  createCommandCenterToken,
  isCommandCenterLoginLocked,
  recordCommandCenterLoginFailure,
  verifyCommandCenterToken,
} from "./command-center-auth";

const secret = "test-secret-value";
const password = "letmein";

describe("command center session tokens", () => {
  it("are random, verify with the right secret/password, and expire after 8h", () => {
    const now = 1_800_000_000_000;
    const token = createCommandCenterToken({ secret, password, now })!;
    expect(token).not.toBe(createCommandCenterToken({ secret, password, now }));
    expect(verifyCommandCenterToken(token, { secret, password, now: now + 1_000 })).not.toBeNull();
    expect(verifyCommandCenterToken(token, { secret, password, now: now + COMMAND_CENTER_SESSION_TTL_MS })).toBeNull();
    expect(verifyCommandCenterToken(token, { secret: "other", password, now })).toBeNull();
    expect(verifyCommandCenterToken(token, { secret, password: "rotated", now })).toBeNull();
    expect(verifyCommandCenterToken(token.slice(0, -2) + "AA", { secret, password, now })).toBeNull();
    expect(verifyCommandCenterToken(token.replace(`.${now}.`, `.${now + 1}.`), { secret, password, now })).toBeNull();
  });

  it("refuses to issue or accept tokens without NEXTAUTH_SECRET", () => {
    expect(createCommandCenterToken({ secret: null, password })).toBeNull();
    const token = createCommandCenterToken({ secret, password })!;
    expect(verifyCommandCenterToken(token, { secret: null, password })).toBeNull();
  });

  it("throttles password guesses globally even without a client IP", () => {
    const now = 1_900_000_000_000;
    expect(isCommandCenterLoginLocked(null, now)).toBe(false);
    for (let i = 0; i < 10; i += 1) recordCommandCenterLoginFailure("198.51.100.1", now);
    expect(isCommandCenterLoginLocked("198.51.100.1", now)).toBe(true);
    expect(isCommandCenterLoginLocked("198.51.100.2", now)).toBe(false);
    for (let i = 0; i < 20; i += 1) recordCommandCenterLoginFailure(null, now);
    expect(isCommandCenterLoginLocked("198.51.100.2", now)).toBe(true);
    expect(isCommandCenterLoginLocked(null, now + 15 * 60 * 1000)).toBe(false);
  });
});
