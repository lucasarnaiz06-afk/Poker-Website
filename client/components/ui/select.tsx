"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { useFieldControl } from "./field";
import { controlBase, type InputSize } from "./input";

export type SelectOption<T extends string = string> = {
  value: T;
  label: ReactNode;
  /** Secondary line shown in the menu only. */
  description?: ReactNode;
  disabled?: boolean;
};

export type SelectProps<T extends string = string> = {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  size?: InputSize;
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

const heights: Record<InputSize, string> = { sm: "h-8", md: "h-10", lg: "h-12" };

export function Select<T extends string = string>({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder = "Select…",
  size = "md",
  id,
  name,
  disabled,
  className,
  ...aria
}: SelectProps<T>) {
  const field = useFieldControl({ id, ...aria });

  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => onValueChange?.(next as T)}
      name={name}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        {...field}
        aria-label={aria["aria-label"]}
        className={cn(
          controlBase,
          heights[size],
          "flex items-center justify-between gap-2 px-3 text-left data-[placeholder]:text-subtle",
          className,
        )}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "z-50 max-h-[min(var(--radix-select-content-available-height),320px)] min-w-[var(--radix-select-trigger-width)]",
            "overflow-hidden rounded-xl border border-line bg-surface shadow-pop animate-scale-in",
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  "relative flex cursor-pointer select-none items-start gap-2 rounded-lg py-2 pl-8 pr-3 text-sm text-fg outline-none",
                  "data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                )}
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2.5 top-2.5">
                  <Check className="h-3.5 w-3.5 text-accent" aria-hidden />
                </SelectPrimitive.ItemIndicator>
                <div className="flex min-w-0 flex-col">
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.description ? <span className="text-xs text-muted">{option.description}</span> : null}
                </div>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
