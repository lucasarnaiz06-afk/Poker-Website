/**
 * The one date/time format for the site: local time, short month, no seconds ("Oct 29, 5:27 AM"), with the
 * year only when it isn't this year. `relative` variants say "5 min ago" for the last 24 hours.
 * Pure functions (timeZone is injectable for tests); components use <LocalTime>, which formats in the
 * browser's time zone.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Options = { now?: number; timeZone?: string };

function toDate(value: Date | string | number) {
  return value instanceof Date ? value : new Date(value);
}

function yearOf(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(date);
}

/** "Oct 29, 5:27 AM" (or "Oct 29, 2025, 5:27 AM" for another year). */
export function formatDateTime(value: Date | string | number, { now = Date.now(), timeZone }: Options = {}): string {
  const date = toDate(value);
  const sameYear = yearOf(date, timeZone) === yearOf(new Date(now), timeZone);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

/** "Oct 29" (or "Oct 29, 2025"). */
export function formatDate(value: Date | string | number, { now = Date.now(), timeZone }: Options = {}): string {
  const date = toDate(value);
  const sameYear = yearOf(date, timeZone) === yearOf(new Date(now), timeZone);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone,
  }).format(date);
}

/** "October 2026" (member since / joined). */
export function formatMonthYear(value: Date | string | number, { timeZone }: Options = {}): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone }).format(toDate(value));
}

/** "just now", "5 min ago", "3 h ago" within 24 hours; otherwise formatDateTime. */
export function formatRelative(value: Date | string | number, options: Options = {}): string {
  const now = options.now ?? Date.now();
  const diff = now - toDate(value).getTime();

  if (diff >= 0 && diff < DAY) {
    if (diff < MINUTE) return "just now";
    if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
    return `${Math.floor(diff / HOUR)} h ago`;
  }

  return formatDateTime(value, options);
}

/** A duration as "5h 12m", "12m" or "under a minute". */
export function formatDuration(ms: number): string {
  if (ms < MINUTE) return "under a minute";
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** "1 hand", "2 hands"; `plural` defaults to singular + "s". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}
