// Pure helpers (safe for the browser): no node or database imports.

export const INVITE_CODE_LENGTH = 10;

const INVITE_CODE_PATTERN = new RegExp(`^[0-9A-Za-z]{${INVITE_CODE_LENGTH}}$`);

export function isValidInviteCode(value: string): boolean {
  return INVITE_CODE_PATTERN.test(value);
}

/**
 * Accepts a bare code or anything containing an invite link (".../lobby/join/<code>" or "?invite=<code>")
 * and returns the code, or null when nothing valid is found.
 */
export function extractInviteCode(input: string): string | null {
  const trimmed = input.trim();

  if (isValidInviteCode(trimmed)) {
    return trimmed;
  }

  const match = /\/join\/([0-9A-Za-z]+)(?:[/?#]|$)/.exec(trimmed) ?? /[?&]invite=([0-9A-Za-z]+)/.exec(trimmed);
  const candidate = match?.[1];

  return candidate && isValidInviteCode(candidate) ? candidate : null;
}

export function inviteLinkPath(code: string): string {
  return `/lobby/join/${code}`;
}
