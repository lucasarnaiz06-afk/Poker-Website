import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "accent" | "gold" | "danger" | "warning" | "info" | "outline";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-3 text-muted",
  accent: "bg-accent/10 text-accent ring-1 ring-inset ring-accent/20",
  gold: "bg-gold/10 text-gold ring-1 ring-inset ring-gold/20",
  danger: "bg-danger/10 text-danger ring-1 ring-inset ring-danger/20",
  warning: "bg-warning/10 text-warning ring-1 ring-inset ring-warning/20",
  info: "bg-info/10 text-info ring-1 ring-inset ring-info/20",
  outline: "text-muted ring-1 ring-inset ring-line",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  size?: "sm" | "md";
  icon?: ReactNode;
};

export function Badge({ tone = "neutral", size = "sm", icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md font-medium [&>svg]:shrink-0",
        size === "sm"
          ? "h-5 px-1.5 text-[11px] [&>svg]:h-3 [&>svg]:w-3"
          : "h-6 px-2 text-xs [&>svg]:h-3.5 [&>svg]:w-3.5",
        tones[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}
