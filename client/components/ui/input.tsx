"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";
import { useFieldControl } from "./field";

export const controlBase =
  "w-full rounded-lg border border-line bg-surface-2 text-sm text-fg placeholder:text-subtle " +
  "transition-[border-color,box-shadow] duration-150 ease-out " +
  "hover:border-subtle/50 focus-visible:outline-none focus-visible:border-accent/70 focus-visible:ring-2 focus-visible:ring-accent/25 " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-[invalid=true]:border-danger/70 aria-[invalid=true]:focus-visible:ring-danger/25";

export type InputSize = "sm" | "md" | "lg";

const heights: Record<InputSize, string> = { sm: "h-8", md: "h-10", lg: "h-12 text-[15px]" };

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: InputSize;
  /** Icon or text inside the left edge. */
  leading?: ReactNode;
  /** Icon or text inside the right edge (e.g. "BB"). */
  trailing?: ReactNode;
  wrapperClassName?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "md", leading, trailing, className, wrapperClassName, ...props },
  ref,
) {
  const field = useFieldControl(props);

  return (
    <div className={cn("relative flex items-center", wrapperClassName)}>
      {leading ? (
        <span className="pointer-events-none absolute left-3 flex items-center text-subtle [&>svg]:h-4 [&>svg]:w-4">
          {leading}
        </span>
      ) : null}
      <input
        ref={ref}
        {...props}
        {...field}
        className={cn(controlBase, heights[size], "px-3", leading && "pl-9", trailing && "pr-12", className)}
      />
      {trailing ? (
        <span className="pointer-events-none absolute right-3 flex items-center text-xs font-medium text-subtle">
          {trailing}
        </span>
      ) : null}
    </div>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 3, ...props },
  ref,
) {
  const field = useFieldControl(props);

  return (
    <textarea
      ref={ref}
      rows={rows}
      {...props}
      {...field}
      className={cn(controlBase, "min-h-[80px] resize-y px-3 py-2.5 leading-6", className)}
    />
  );
});
