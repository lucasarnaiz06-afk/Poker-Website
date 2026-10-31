import type { Insight } from "@poker-platform/shared/stats/client";
import { Info, Lightbulb, ThumbsUp } from "lucide-react";
import { cn } from "@/components/ui/cn";

const ICON = { good: ThumbsUp, tip: Lightbulb, info: Info } as const;
const TONE = { good: "text-accent bg-accent/10", tip: "text-gold bg-gold/10", info: "text-info bg-info/10" } as const;

export function Insights({ insights }: { insights: Insight[] }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {insights.map((i) => {
        const Icon = ICON[i.tone];
        return (
          <li key={i.id} className="flex gap-3 rounded-xl border border-line bg-surface p-4">
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONE[i.tone])} aria-hidden>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">{i.title}</p>
              <p className="mt-0.5 text-sm leading-6 text-muted">{i.body}</p>
              <p className="mt-1 text-xs text-subtle">{i.basis}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
