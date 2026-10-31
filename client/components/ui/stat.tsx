import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatProps = {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** Change indicator; sign decides the color. */
  delta?: { value: ReactNode; direction: "up" | "down" | "flat" };
  className?: string;
};

export function Stat({ label, value, hint, delta, className }: StatProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <dt className="truncate text-xs font-medium text-muted">{label}</dt>
      <dd className="flex items-baseline gap-2">
        <span className="tabular truncate text-xl font-semibold tracking-tight text-fg">{value}</span>
        {delta ? (
          <span
            className={cn(
              "tabular text-xs font-medium",
              delta.direction === "up" && "text-accent",
              delta.direction === "down" && "text-danger",
              delta.direction === "flat" && "text-muted",
            )}
          >
            {delta.value}
          </span>
        ) : null}
      </dd>
      {hint ? <dd className="text-xs text-subtle">{hint}</dd> : null}
    </div>
  );
}

/** Wraps Stats in a <dl> grid. */
export function StatGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-2 gap-4 sm:grid-cols-4", className)}>{children}</dl>;
}
