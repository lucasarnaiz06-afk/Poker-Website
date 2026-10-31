import { STAT_DEFINITIONS, type StatKey } from "@poker-platform/shared/stats/client";
import type { ReactNode } from "react";
import { InfoTip } from "@/components/ui";
import { cn } from "@/components/ui/cn";

/** One headline number with a one-sentence explanation behind the (i). */
export function StatTile({ stat, value, sub, tone }: { stat: StatKey; value: ReactNode; sub?: ReactNode; tone?: "positive" | "negative" | null }) {
  const def = STAT_DEFINITIONS[stat];
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3">
      <dt className="flex items-center gap-1 text-xs font-medium text-muted">
        <span className="truncate">{def.label}</span>
        <InfoTip label={`What is ${def.label}?`} title={def.label}>
          {def.explain}
        </InfoTip>
      </dt>
      <dd className={cn("tabular mt-1 truncate text-xl font-semibold tracking-tight text-fg", tone === "positive" && "text-accent", tone === "negative" && "text-danger")}>{value}</dd>
      {sub ? <dd className="mt-0.5 truncate text-xs text-subtle">{sub}</dd> : null}
    </div>
  );
}
