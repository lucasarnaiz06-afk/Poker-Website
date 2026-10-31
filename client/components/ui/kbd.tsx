import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** Keyboard key hint, e.g. <Kbd>F</Kbd>. */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1",
        "font-mono text-[11px] font-medium leading-none text-muted shadow-[inset_0_-1px_0_rgb(var(--line))]",
        className,
      )}
      {...props}
    />
  );
}
