"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "./cn";

export type SwitchProps = ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & { size?: "sm" | "md" };

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { className, size = "md", ...props },
  ref,
) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-150",
        "bg-surface-3 data-[state=checked]:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "h-6 w-10" : "h-5 w-8",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-sm ring-0 transition-transform duration-150 ease-out",
          size === "md"
            ? "h-5 w-5 translate-x-0.5 data-[state=checked]:translate-x-[18px]"
            : "h-4 w-4 translate-x-0.5 data-[state=checked]:translate-x-[14px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
});

export type SwitchFieldProps = Omit<SwitchProps, "children"> & {
  label: ReactNode;
  description?: ReactNode;
  /** Element rendered after the label (e.g. an InfoTip). */
  labelAside?: ReactNode;
};

/** A labelled switch row: label + optional one-line description on the left, switch on the right. */
export function SwitchField({ label, description, labelAside, id, className, ...props }: SwitchFieldProps) {
  const autoId = useId();
  const switchId = id ?? `switch-${autoId}`;
  const descriptionId = description ? `${switchId}-description` : undefined;

  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <label htmlFor={switchId} className="cursor-pointer text-sm font-medium text-fg">
            {label}
          </label>
          {labelAside}
        </div>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-[13px] leading-5 text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <Switch id={switchId} aria-describedby={descriptionId} className="mt-0.5" {...props} />
    </div>
  );
}
