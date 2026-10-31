import { cn } from "@/components/ui/cn";

/** "4/6" with a small fill bar. */
export function SeatMeter({ seated, max, className }: { seated: number; max: number; className?: string }) {
  const full = seated >= max;

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="tabular text-sm text-fg">
        {seated}
        <span className="text-subtle">/{max}</span>
        <span className="sr-only"> players{full ? ", full" : ""}</span>
      </span>
      <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-surface-3 sm:block" aria-hidden>
        <span
          className={cn("block h-full rounded-full", full ? "bg-subtle" : "bg-accent")}
          style={{ width: `${Math.min(100, (seated / Math.max(1, max)) * 100)}%` }}
        />
      </span>
    </span>
  );
}
