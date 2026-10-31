import { randomInt } from "node:crypto";

import { INVITE_CODE_LENGTH } from "./invite-link";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 10 base62 characters from the CSPRNG (~59.5 bits), uniform via crypto.randomInt. */
export function generateInviteCode(): string {
  let code = "";

  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += BASE62[randomInt(BASE62.length)];
  }

  return code;
}
