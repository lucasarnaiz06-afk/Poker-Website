import { hash, verify } from "@node-rs/argon2";
import { COMMON_PASSWORD_BASES, COMMON_PASSWORDS } from "./common-passwords";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * argon2id (the library default algorithm) with OWASP-recommended parameters:
 * 19 MiB memory, 2 iterations, 1 lane.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function hashUserPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

// Hash of a random string, used to spend the same time verifying when an account doesn't exist.
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash() {
  dummyHashPromise ??= hash(`dummy-${Math.random()}-${Date.now()}`, ARGON2_OPTIONS);
  return dummyHashPromise;
}

/**
 * Verifies a password. When `passwordHash` is null (unknown account or passwordless account) a dummy hash
 * is verified anyway so response timing does not reveal whether the account exists.
 */
export async function verifyUserPassword(
  password: string,
  passwordHash: string | null | undefined,
): Promise<boolean> {
  if (!passwordHash || !passwordHash.startsWith("$argon2")) {
    await verify(await getDummyHash(), password).catch(() => false);
    return false;
  }

  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export type PasswordCheck = { ok: true } | { ok: false; error: string };

/** Strength rules: length 10-128, not a common password, not built from the username/email. */
export function checkPasswordStrength(
  password: string,
  context: { username?: string | null; email?: string | null } = {},
): PasswordCheck {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: `Use at most ${PASSWORD_MAX_LENGTH} characters.` };
  }

  const lower = password.toLowerCase();

  if (/^(.)\1+$/.test(lower) || new Set(lower).size < 4) {
    return { ok: false, error: "Use a less repetitive password." };
  }

  const base = lower.replace(/[^a-z]/g, "");

  if (
    COMMON_PASSWORDS.has(lower) ||
    COMMON_PASSWORD_BASES.has(base) ||
    COMMON_PASSWORD_BASES.has(lower.replace(/[\d\W_]+$/g, "")) ||
    isSequential(lower)
  ) {
    return { ok: false, error: "That password is too common. Try a longer phrase." };
  }

  const identifiers = [context.username, context.email?.split("@")[0]]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value && value.length >= 3));

  if (identifiers.some((identifier) => lower.includes(identifier))) {
    return { ok: false, error: "Don't include your username or email in your password." };
  }

  return { ok: true };
}

function isSequential(value: string) {
  const sequences = ["0123456789012345678901234567890", "abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm"];
  return sequences.some((sequence) => sequence.includes(value) || sequence.split("").reverse().join("").includes(value));
}
