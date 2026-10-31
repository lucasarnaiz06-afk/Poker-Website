import { randomInt } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { hmacDigest } from "./crypto";

const PERIOD_SECONDS = 30;
const ISSUER = "Poker Platform";

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function buildTotp(secretBase32: string, label = "account") {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
}

export function buildTotpUri(secretBase32: string, label: string): string {
  return buildTotp(secretBase32, label).toString();
}

/**
 * Validates a 6-digit code within +/-1 step. Returns the accepted time step (counter) or null.
 * Codes at or before `lastCounter` are rejected so a code can't be replayed.
 */
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  lastCounter: number | null | undefined,
  now = Date.now(),
): number | null {
  const token = code.replace(/\s+/g, "");

  if (!/^\d{6}$/.test(token)) {
    return null;
  }

  const delta = buildTotp(secretBase32).validate({ token, timestamp: now, window: 1 });

  if (delta === null) {
    return null;
  }

  const counter = Math.floor(now / 1000 / PERIOD_SECONDS) + delta;

  if (lastCounter !== null && lastCounter !== undefined && counter <= lastCounter) {
    return null;
  }

  return counter;
}

/** Test/helper: current code for a secret. */
export function generateTotpCode(secretBase32: string, now = Date.now()): string {
  return buildTotp(secretBase32).generate({ timestamp: now });
}

const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]);
    return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
  });
}

export function normalizeRecoveryCode(code: string) {
  return code.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashRecoveryCode(code: string) {
  return hmacDigest("recovery-code", normalizeRecoveryCode(code));
}
