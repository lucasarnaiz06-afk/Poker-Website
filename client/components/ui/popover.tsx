"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Info } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "./cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>>(
  function PopoverContent({ className, sideOffset = 6, collisionPadding = 12, ...props }, ref) {
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          className={cn(
            "z-50 w-72 rounded-xl border border-line bg-surface p-4 text-sm text-fg shadow-pop animate-scale-in focus:outline-none",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Portal>
    );
  },
);

export type InfoTipProps = {
  /** The explanation. */
  children: ReactNode;
  /** Accessible name of the trigger, e.g. "About bomb pots". */
  label: string;
  title?: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
};

/** Small (i) button that opens an explanation on click, tap or Enter (works on touch, unlike tooltips). */
export function InfoTip({ children, label, title, side = "top", className }: InfoTipProps) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-subtle transition-colors",
          "hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:text-fg",
          className,
        )}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent side={side} className="w-64 p-3 text-[13px] leading-5 text-muted">
        {title ? <p className="mb-1 font-medium text-fg">{title}</p> : null}
        {children}
      </PopoverContent>
    </Popover>
  );
}
