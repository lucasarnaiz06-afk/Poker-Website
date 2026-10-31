// Basic profanity masking for table chat. Deliberately small; whole words only.
const BLOCKED = ["fuck", "fucking", "shit", "cunt", "bitch", "asshole", "bastard", "dick", "faggot", "nigger", "retard", "whore", "slut"];
const PATTERN = new RegExp(`\\b(${BLOCKED.join("|")})\\b`, "gi");

export function maskProfanity(text: string) {
  return text.replace(PATTERN, (word) => `${word[0]}${"*".repeat(word.length - 1)}`);
}

/** Strips control characters (keeps normal whitespace collapsed). */
export function cleanChatText(text: string) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, "").replace(/\s+/g, " ").trim();
}
