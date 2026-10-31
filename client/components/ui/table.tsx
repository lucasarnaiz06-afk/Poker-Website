import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

/** Data table. Wraps in a horizontally scrollable container so it never breaks the page at 375px. */
export function Table({
  className,
  wrapperClassName,
  ...props
}: HTMLAttributes<HTMLTableElement> & { wrapperClassName?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto", wrapperClassName)}>
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-line", className)} {...props} />;
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-line", className)} {...props} />;
}

export function TR({
  className,
  interactive,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return <tr className={cn(interactive && "transition-colors hover:bg-surface-2/60", className)} {...props} />;
}

type Align = { align?: "left" | "right" | "center"; numeric?: boolean };

export function TH({ className, align, numeric, ...props }: ThHTMLAttributes<HTMLTableCellElement> & Align) {
  return (
    <th
      scope="col"
      className={cn(
        "h-10 whitespace-nowrap px-4 text-left text-xs font-medium text-muted",
        (align === "right" || numeric) && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, align, numeric, ...props }: TdHTMLAttributes<HTMLTableCellElement> & Align) {
  return (
    <td
      className={cn(
        "h-14 px-4 align-middle text-fg",
        (align === "right" || numeric) && "text-right",
        numeric && "tabular",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    />
  );
}
