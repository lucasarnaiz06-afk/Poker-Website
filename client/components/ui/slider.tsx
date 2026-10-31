"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "./cn";

export type SliderProps = {
  value: number;
  onValueChange: (value: number) => void;
  /** Fires once when the user releases the thumb. */
  onValueCommit?: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Human readable value for screen readers, e.g. "40 big blinds". */
  getValueText?: (value: number) => string;
};

export function Slider({
  value,
  onValueChange,
  onValueCommit,
  min,
  max,
  step = 1,
  disabled,
  className,
  id,
  getValueText,
  ...aria
}: SliderProps) {
  return (
    <SliderPrimitive.Root
      value={[value]}
      onValueChange={([next]) => next !== undefined && onValueChange(next)}
      onValueCommit={([next]) => next !== undefined && onValueCommit?.(next)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn(
        "relative flex h-5 w-full touch-none select-none items-center data-[disabled]:opacity-50",
        className,
      )}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-surface-3">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        id={id}
        {...aria}
        aria-valuetext={getValueText?.(value)}
        className={cn(
          "block h-5 w-5 rounded-full border-2 border-accent bg-white shadow transition-shadow",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30",
        )}
      />
    </SliderPrimitive.Root>
  );
}
