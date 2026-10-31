/**
 * Optional sign-up allow-list. ALLOWED_EMAIL_DOMAINS empty or unset = anyone can sign up.
 * Entries are domains ("example.edu") or full addresses ("someone@example.com").
 */
export const DEFAULT_ALLOWED_EMAIL_DOMAINS = [] as const;

export function parseAllowedEmailDomains(
  rawDomains?: string | readonly string[] | null,
): string[] {
  const domains: readonly string[] =
    typeof rawDomains === "string" ? rawDomains.split(",") : rawDomains ?? [];

  return domains
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function resolveAllowedEmailDomains(): string[] {
  const configuredDomains = parseAllowedEmailDomains(
    process.env.ALLOWED_EMAIL_DOMAINS,
  );

  return configuredDomains.length > 0
    ? configuredDomains
    : resolvePublicAllowedEmailDomains();
}

export function resolvePublicAllowedEmailDomains(): string[] {
  const configuredDomains = parseAllowedEmailDomains(
    process.env.ALLOWED_EMAIL_DOMAINS ??
      process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS,
  );

  return configuredDomains.length > 0
    ? configuredDomains
    : [...DEFAULT_ALLOWED_EMAIL_DOMAINS];
}

export function getEmailDomain(email?: string | null): string | null {
  if (!email) {
    return null;
  }

  const atIndex = email.lastIndexOf("@");

  if (atIndex < 0 || atIndex === email.length - 1) {
    return null;
  }

  return email.slice(atIndex + 1).toLowerCase();
}

/** Returns true when `allowedDomains` is empty (open sign-up) or the email matches an entry. */
export function isAllowedEmailDomain(
  email: string | null | undefined,
  allowedDomains: readonly string[],
): boolean {
  const normalizedEmail = email?.trim().toLowerCase();
  const emailDomain = getEmailDomain(email);

  if (!normalizedEmail || !emailDomain) {
    return false;
  }

  if (allowedDomains.length === 0) {
    return true;
  }

  return allowedDomains.some((allowedDomain) => {
    const normalized = allowedDomain.trim().toLowerCase().replace(/^@/, "");

    if (!normalized) {
      return false;
    }

    if (normalized.includes("@")) {
      return normalizedEmail === normalized;
    }

    return emailDomain === normalized;
  });
}
