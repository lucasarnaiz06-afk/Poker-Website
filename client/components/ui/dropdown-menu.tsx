"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "./cn";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export const DropdownMenuContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof Menu.Content>>(
  function DropdownMenuContent({ className, sideOffset = 6, align = "end", ...props }, ref) {
    return (
      <Menu.Portal>
        <Menu.Content
          ref={ref}
          sideOffset={sideOffset}
          align={align}
          className={cn(
            "z-50 min-w-[200px] overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-pop animate-scale-in",
            className,
          )}
          {...props}
        />
      </Menu.Portal>
    );
  },
);

const itemClass =
  "relative flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-sm text-fg outline-none " +
  "transition-colors data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 " +
  "[&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 [&>svg]:text-muted";

export type DropdownMenuItemProps = ComponentPropsWithoutRef<typeof Menu.Item> & {
  icon?: ReactNode;
  shortcut?: ReactNode;
  tone?: "default" | "danger";
};

export const DropdownMenuItem = forwardRef<HTMLDivElement, DropdownMenuItemProps>(function DropdownMenuItem(
  { className, icon, shortcut, tone = "default", children, asChild, ...props },
  ref,
) {
  const classes = cn(itemClass, tone === "danger" && "text-danger [&>svg]:text-danger", className);

  // With asChild (e.g. a Next <Link>), the child is rendered as the item; put the icon inside the child.
  if (asChild) {
    return (
      <Menu.Item ref={ref} asChild className={classes} {...props}>
        {children}
      </Menu.Item>
    );
  }

  return (
    <Menu.Item ref={ref} className={classes} {...props}>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut ? <span className="ml-auto text-xs text-subtle">{shortcut}</span> : null}
    </Menu.Item>
  );
});

export const DropdownMenuCheckboxItem = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof Menu.CheckboxItem>>(
  function DropdownMenuCheckboxItem({ className, children, ...props }, ref) {
    return (
      <Menu.CheckboxItem ref={ref} className={cn(itemClass, "pl-8", className)} {...props}>
        <Menu.ItemIndicator className="absolute left-2.5 inline-flex">
          <Check className="h-4 w-4 text-accent" aria-hidden />
        </Menu.ItemIndicator>
        {children}
      </Menu.CheckboxItem>
    );
  },
);

export const DropdownMenuRadioGroup = Menu.RadioGroup;

export const DropdownMenuRadioItem = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof Menu.RadioItem>>(
  function DropdownMenuRadioItem({ className, children, ...props }, ref) {
    return (
      <Menu.RadioItem ref={ref} className={cn(itemClass, "pl-8", className)} {...props}>
        <Menu.ItemIndicator className="absolute left-2.5 inline-flex">
          <Check className="h-4 w-4 text-accent" aria-hidden />
        </Menu.ItemIndicator>
        {children}
      </Menu.RadioItem>
    );
  },
);

export function DropdownMenuLabel({ className, children }: { className?: string; children: ReactNode }) {
  return <Menu.Label className={cn("px-2.5 py-2 text-xs text-muted", className)}>{children}</Menu.Label>;
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-line", className)} />;
}
