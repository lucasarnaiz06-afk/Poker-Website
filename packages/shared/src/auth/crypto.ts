import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Server-only crypto helpers for accounts.
 *
 * AUTH_ENCRYPTION_KEY is a 32-byte key (base64 or 64 hex chars). Sub-keys are derived with HKDF so the
 * same master key is never used for two purposes.
 */

const ENCRYPTION_VERSION = "v1";

let cachedMaster: { raw: string; key: Buffer } | null = null;

function readMasterKey(): Buffer {
  const raw = process.env.AUTH_ENCRYPTION_KEY?.trim();

  if (!raw) {
    throw new Error(
      "AUTH_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to .env.",
    );
  }

  if (cachedMaster?.raw === raw) {
    return cachedMaster.key;
  }

  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error("AUTH_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }

  cachedMaster = { raw, key };
  return key;
}

const derivedKeys = new Map<string, Buffer>();

function deriveKey(purpose: string): Buffer {
  const master = readMasterKey();
  const cacheKey = `${master.toString("hex")}:${purpose}`;
  const cached = derivedKeys.get(cacheKey);

  if (cached) {
    return cached;
  }

  const derived = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `poker-platform:${purpose}`, 32));
  derivedKeys.set(cacheKey, derived);
  return derived;
}

/** AES-256-GCM. Output: "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("secret-encryption"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [ENCRYPTION_VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");

  if (version !== ENCRYPTION_VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error("Unsupported encrypted payload.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey("secret-encryption"),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Keyed hash for values we want to look up but never store in clear (IPs, identifiers, recovery codes). */
export function hmacDigest(purpose: string, value: string): string {
  return createHmac("sha256", deriveKey(`hmac:${purpose}`)).update(value).digest("hex");
}

/** SHA-256 for high-entropy random tokens (email links). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time string comparison (lengths are hidden by hashing first). */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();

  return timingSafeEqual(left, right) && a.length === b.length;
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) {
    return null;
  }

  return hmacDigest("ip", ip.trim().toLowerCase()).slice(0, 32);
}

/**
 * Short-lived signed value (e.g. the pending-2FA cookie). Format: "<payload>.<expiresMs>.<sig>".
 * The payload must not contain dots.
 */
export function signValue(payload: string, ttlMs: number, now = Date.now()): string {
  if (payload.includes(".")) {
    throw new Error("Signed payload must not contain '.'");
  }

  const expires = String(now + ttlMs);
  const signature = createHmac("sha256", deriveKey("signed-value"))
    .update(`${payload}.${expires}`)
    .digest("base64url");

  return `${payload}.${expires}.${signature}`;
}

export function verifySignedValue(token: string | null | undefined, now = Date.now()): string | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [payload, expires, signature] = parts as [string, string, string];
  const expected = createHmac("sha256", deriveKey("signed-value"))
    .update(`${payload}.${expires}`)
    .digest("base64url");

  if (!constantTimeEqual(signature, expected)) {
    return null;
  }

  const expiresAt = Number(expires);

  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return null;
  }

  return payload;
}
