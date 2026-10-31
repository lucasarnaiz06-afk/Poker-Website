"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "./cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlayClass = "fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-fade-in";

const closeButtonClass =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export type DialogSize = "sm" | "md" | "lg" | "xl";

const widths: Record<DialogSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-2xl",
};

export type DialogContentProps = Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  /** Sticky footer (actions). */
  footer?: ReactNode;
  size?: DialogSize;
  hideClose?: boolean;
  bodyClassName?: string;
};

/**
 * Centered dialog on desktop; on phones it becomes a bottom sheet with a scrollable body.
 * Title and description are wired to aria-labelledby/aria-describedby.
 */
export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent(
  { title, description, footer, size = "md", hideClose, className, bodyClassName, children, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        ref={ref}
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border border-line bg-surface shadow-pop focus:outline-none",
          "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl data-[state=open]:animate-sheet-in-bottom",
          "sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[min(88dvh,820px)] sm:w-[calc(100vw-2rem)] sm:rounded-2xl sm:data-[state=open]:animate-scale-in",
          widths[size],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-base font-semibold text-fg">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {hideClose ? null : (
            <DialogPrimitive.Close className={cn(closeButtonClass, "-mr-1.5 -mt-1")} aria-label="Close">
              <X className="h-4 w-4" aria-hidden />
            </DialogPrimitive.Close>
          )}
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-5", bodyClassName)}>{children}</div>
        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-line bg-surface px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-end sm:pb-4">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export type SheetContentProps = Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title"> & {
  side?: "left" | "right" | "bottom";
  title: ReactNode;
  /** Visually hide the title (it stays available to screen readers). */
  hideTitle?: boolean;
  description?: ReactNode;
};

const sheetSides = {
  left: "inset-y-0 left-0 h-full w-[min(320px,86vw)] border-r data-[state=open]:animate-sheet-in-left",
  right: "inset-y-0 right-0 h-full w-[min(360px,90vw)] border-l data-[state=open]:animate-sheet-in-right",
  bottom: "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t data-[state=open]:animate-sheet-in-bottom",
} as const;

export const SheetContent = forwardRef<HTMLDivElement, SheetContentProps>(function SheetContent(
  { side = "right", title, hideTitle, description, className, children, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed z-50 flex flex-col border-line bg-surface shadow-pop focus:outline-none",
          sheetSides[side],
          className,
        )}
        {...props}
      >
        <div className={cn("flex items-center justify-between gap-4 px-4 py-3", hideTitle && "justify-end")}>
          <DialogPrimitive.Title className={cn("text-base font-semibold text-fg", hideTitle && "sr-only")}>
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close className={closeButtonClass} aria-label="Close">
            <X className="h-4 w-4" aria-hidden />
          </DialogPrimitive.Close>
        </div>
        {description ? (
          <DialogPrimitive.Description className="px-4 text-sm text-muted">{description}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
