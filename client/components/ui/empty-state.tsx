import type { ReactNode } from "react";
import { cn } from "./cn";

export type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Usually one Button. */
  action?: ReactNode;
  className?: string;
  /** Tone for error states. */
  tone?: "neutral" | "danger";
};

export function EmptyState({ icon, title, description, action, className, tone = "neutral" }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon ? (
        <div
          className={cn(
            "mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-2 [&>svg]:h-5 [&>svg]:w-5",
            tone === "danger" ? "text-danger" : "text-muted",
          )}
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <p className="text-[15px] font-semibold text-fg">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm leading-6 text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
