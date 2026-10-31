"use client";

import { Minus, Plus } from "lucide-react";
import { forwardRef, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";
import { useFieldControl } from "./field";
import { controlBase, type InputSize } from "./input";

export type NumberInputProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shown inside the right edge, e.g. "BB" or "sec". */
  suffix?: ReactNode;
  /** Hide the - / + buttons. */
  hideSteppers?: boolean;
  size?: InputSize;
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

const heights: Record<InputSize, string> = { sm: "h-8", md: "h-10", lg: "h-12" };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Integer input with steppers. Typing is free-form; the value is clamped to [min, max] on blur.
 * Arrow keys step, Shift+Arrow steps 10x, PageUp/PageDown step 10x, Home/End jump to min/max.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  {
    value,
    onChange,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
    step = 1,
    suffix,
    hideSteppers = false,
    size = "md",
    id,
    name,
    disabled,
    className,
    ...aria
  },
  ref,
) {
  const field = useFieldControl({ id, ...aria });
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText((current) => (Number(current) === value && current !== "" ? current : String(value)));
  }, [value]);

  function commit(next: number) {
    const clamped = clamp(Math.round(next), min, max);

    setText(String(clamped));
    if (clamped !== value) {
      onChange(clamped);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const big = step * 10;
    const deltas: Record<string, number> = {
      ArrowUp: event.shiftKey ? big : step,
      ArrowDown: event.shiftKey ? -big : -step,
      PageUp: big,
      PageDown: -big,
    };

    if (event.key in deltas) {
      event.preventDefault();
      commit(value + (deltas[event.key] ?? 0));
    } else if (event.key === "Home" && min > Number.MIN_SAFE_INTEGER) {
      event.preventDefault();
      commit(min);
    } else if (event.key === "End" && max < Number.MAX_SAFE_INTEGER) {
      event.preventDefault();
      commit(max);
    } else if (event.key === "Enter") {
      commit(Number(text) || min);
    }
  }

  const stepperClass =
    "flex h-full w-9 shrink-0 items-center justify-center text-muted transition-colors hover:bg-surface-3 hover:text-fg " +
    "disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:bg-surface-3";

  return (
    <div
      className={cn(
        controlBase,
        heights[size],
        "flex items-stretch overflow-hidden p-0 focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/25",
        field["aria-invalid"] && "border-danger/70 focus-within:ring-danger/25",
        disabled && "opacity-50",
        className,
      )}
    >
      {hideSteppers ? null : (
        <button
          type="button"
          tabIndex={-1}
          className={cn(stepperClass, "border-r border-line")}
          onClick={() => commit(value - step)}
          disabled={disabled || value <= min}
          aria-label="Decrease"
        >
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      <div className="relative flex min-w-0 flex-1 items-center">
        <input
          ref={ref}
          {...field}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          role="spinbutton"
          aria-valuenow={value}
          aria-valuemin={min > Number.MIN_SAFE_INTEGER ? min : undefined}
          aria-valuemax={max < Number.MAX_SAFE_INTEGER ? max : undefined}
          disabled={disabled}
          value={text}
          onChange={(event) => {
            const next = event.target.value.replace(/[^\d-]/g, "");

            setText(next);
            const parsed = Number(next);

            if (next !== "" && next !== "-" && Number.isInteger(parsed)) {
              onChange(parsed);
            }
          }}
          onBlur={() => commit(text === "" || text === "-" ? min : Number(text))}
          onKeyDown={handleKeyDown}
          className={cn(
            "tabular h-full w-full min-w-0 bg-transparent px-3 text-sm text-fg outline-none",
            hideSteppers ? "text-left" : "text-center",
            suffix ? "pr-10" : undefined,
          )}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 text-xs font-medium text-subtle">{suffix}</span>
        ) : null}
      </div>
      {hideSteppers ? null : (
        <button
          type="button"
          tabIndex={-1}
          className={cn(stepperClass, "border-l border-line")}
          onClick={() => commit(value + step)}
          disabled={disabled || value >= max}
          aria-label="Increase"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
});
