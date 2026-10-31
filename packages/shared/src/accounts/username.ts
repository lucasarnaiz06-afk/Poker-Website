import { z } from "zod";

/** Username rules. Client-safe. Stored lowercase; DB has a matching CHECK constraint. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;

export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "help",
  "mod",
  "mods",
  "moderator",
  "staff",
  "official",
  "dealer",
  "house",
  "bank",
  "cashier",
  "security",
  "anonymous",
  "null",
  "undefined",
  "deleted",
  "account",
  "settings",
  "api",
  "auth",
  "login",
  "logout",
  "signin",
  "signup",
  "register",
  "me",
  "you",
  "everyone",
  "here",
  "poker",
  "pokerplatform",
]);

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, "Use 3-20 characters: letters, numbers and underscores.")
  .refine((value) => !RESERVED_USERNAMES.has(value) && !value.startsWith("deleted_"), {
    message: "That username is reserved.",
  });

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name is required.")
  .max(32, "Use at most 32 characters.")
  .refine((value) => !/[\u0000-\u001f\u007f<>]/.test(value), "Display name contains invalid characters.");

export const bioSchema = z.string().trim().max(280, "Use at most 280 characters.");
