import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type AlertTone = "info" | "success" | "warning" | "danger";

const tones: Record<AlertTone, { box: string; icon: ReactNode }> = {
  info: { box: "border-info/30 bg-info/10", icon: <Info className="text-info" aria-hidden /> },
  success: { box: "border-accent/30 bg-accent/10", icon: <CheckCircle2 className="text-accent" aria-hidden /> },
  warning: { box: "border-warning/30 bg-warning/10", icon: <AlertTriangle className="text-warning" aria-hidden /> },
  danger: { box: "border-danger/30 bg-danger/10", icon: <XCircle className="text-danger" aria-hidden /> },
};

/** Inline message box. Danger/warning alerts are announced (role="alert"). */
export function Alert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", tones[tone].box, className)}
    >
      <span className="mt-0.5 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{tones[tone].icon}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium text-fg">{title}</p> : null}
        {children ? <div className={cn("text-muted", title && "mt-0.5")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
