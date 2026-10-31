// zod schemas for every client -> server socket payload. Strict: unknown fields are rejected.
import { z } from "zod";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id");
const chips = z.number().int().min(0).max(1_000_000_000);

export const EMOTE_ID_PATTERN = /^(?:[1-9]|[1-4][0-9]|5[0-2])$/;

export const schemas = {
  "table:join": z.strictObject({
    tableId: id,
    password: z.string().max(128).optional(),
    inviteCode: z.string().min(1).max(32).regex(/^[A-Za-z0-9]+$/).optional(),
  }),
  "table:leave": z.strictObject({ tableId: id }),
  "table:sit": z.strictObject({
    tableId: id,
    seat: z.number().int().min(1).max(10),
    buyIn: chips,
    postNow: z.boolean().optional(),
  }),
  "table:stand": z.strictObject({ tableId: id }),
  "table:sitOut": z.strictObject({ tableId: id, sitOut: z.boolean() }),
  "table:rebuy": z.strictObject({ tableId: id, amount: chips }),
  "table:start": z.strictObject({ tableId: id }),
  "table:close": z.strictObject({ tableId: id }),
  "table:action": z.strictObject({
    tableId: id,
    handId: id,
    type: z.enum(["fold", "check", "call", "bet", "raise", "allin"]),
    amount: chips.optional(),
  }),
  "table:straddle": z.strictObject({ tableId: id, enabled: z.boolean() }),
  "table:propose": z.strictObject({
    tableId: id,
    kind: z.enum(["BOMB_POT", "NIT_GAME", "BOUNTY_GAME", "RUN_IT_TWICE"]),
    action: z.enum(["START", "STOP"]),
  }),
  "table:vote": z.strictObject({ tableId: id, voteId: id, yes: z.boolean() }),
  "table:show": z.strictObject({ tableId: id, handId: id }),
  "table:chat": z
    .strictObject({
      tableId: id,
      text: z.string().max(400).optional(),
      emoteId: z.string().regex(EMOTE_ID_PATTERN, "Unknown emote").optional(),
    })
    .refine((p) => (p.text !== undefined && p.text.trim().length > 0) || p.emoteId !== undefined, {
      message: "Message is empty",
    })
    .refine((p) => p.text === undefined || p.text.trim().length <= 200, { message: "Message is too long (200 max)" }),
  "lobby:subscribe": z.strictObject({}),
  "lobby:unsubscribe": z.strictObject({}),
} as const;

export type SocketEventName = keyof typeof schemas;
export type PayloadOf<E extends SocketEventName> = z.output<(typeof schemas)[E]>;
