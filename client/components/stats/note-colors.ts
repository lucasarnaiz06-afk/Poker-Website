import type { NoteColor } from "@poker-platform/shared/stats/client";

/** Swatch classes for note colour tags. */
export const NOTE_SWATCH: Record<NoteColor, string> = {
  none: "bg-transparent ring-1 ring-inset ring-line",
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  green: "bg-emerald-500",
  blue: "bg-sky-500",
  purple: "bg-violet-500",
};
