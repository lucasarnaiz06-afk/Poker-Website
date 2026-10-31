import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Rng } from "./ports";

/** Production randomness: CSPRNG shuffle (Fisher-Yates in the engine), salts and ids. */
export const cryptoRng: Rng = {
  randomInt: (maxExclusive) => randomInt(maxExclusive),
  randomHex: (bytes) => randomBytes(bytes).toString("hex"),
  uuid: () => randomUUID(),
};
