import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Page widths. Use one of these instead of ad-hoc max-w-* classes so pages line up:
 * - default: lists and dashboards (lobby, hands, stats, account)
 * - narrow: single-column reading pages (profiles, leaderboard, tools, not-found / error pages)
 * - wide: the hand replayer
 */
export const PAGE_WIDTHS = {
  default: "max-w-6xl",
  narrow: "max-w-3xl",
  wide: "max-w-7xl",
} as const;

export type PageWidth = keyof typeof PAGE_WIDTHS;

/** Standard page width + gutters (16px on phones). */
export function PageContainer({
  className,
  width = "default",
  children,
}: {
  className?: string;
  width?: PageWidth;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full px-4 py-8 sm:px-6 sm:py-10", PAGE_WIDTHS[width], className)}>{children}</div>
  );
}

/** Page title row: title + description on the left, actions on the right (stacked on phones). */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
