"use client";

import * as ToggleGroup from "@radix-ui/react-toggle-group";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
};

export type SegmentedProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Accessible name for the group. */
  "aria-label": string;
  size?: "sm" | "md";
  fullWidth?: boolean;
  className?: string;
  id?: string;
};

/** Single-choice segmented control (one option always selected). Arrow keys move between options. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  fullWidth = false,
  className,
  id,
  ...aria
}: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      id={id}
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) {
          onValueChange(next as T);
        }
      }}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5",
        fullWidth && "flex w-full",
        className,
      )}
      {...aria}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium text-muted",
            "transition-colors duration-150 hover:text-fg",
            "data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-line",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            "disabled:pointer-events-none disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4",
            size === "md" ? "h-8 px-3 text-sm" : "h-7 px-2.5 text-[13px]",
            fullWidth && "flex-1",
          )}
        >
          {option.icon}
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
