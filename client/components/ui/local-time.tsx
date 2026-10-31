"use client";

import { useEffect, useState } from "react";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format-time";

export type LocalTimeProps = {
  value: Date | string | number;
  /** datetime: "Oct 29, 5:27 AM"; relative: "5 min ago" within 24 h, else datetime; date: "Oct 29". */
  format?: "datetime" | "relative" | "date";
  className?: string;
};

const FORMATTERS = { datetime: formatDateTime, relative: formatRelative, date: formatDate } as const;

/**
 * A timestamp in the viewer's own time zone. The server render uses the server's zone; the browser
 * re-formats right after hydration (and keeps relative times fresh every minute).
 */
export function LocalTime({ value, format = "datetime", className }: LocalTimeProps) {
  const date = value instanceof Date ? value : new Date(value);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (format !== "relative") return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [format]);

  const text = FORMATTERS[format](date, now === null ? {} : { now });
  const full = formatDateTime(date, now === null ? {} : { now });

  return (
    <time dateTime={date.toISOString()} title={format === "datetime" ? undefined : full} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
