"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "./cn";

export type ToastTone = "default" | "success" | "error" | "warning";

export type ToastOptions = {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** ms; default 5000. */
  duration?: number;
  action?: { label: string; onClick: () => void; altText?: string };
};

type ToastItem = ToastOptions & { id: number; open: boolean };

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  for (const listener of listeners) {
    listener(items);
  }
}

/** Show a toast from anywhere on the client: toast({ title: "Copied" }). Returns a dismiss function. */
export function toast(options: ToastOptions) {
  const id = nextId++;

  items = [...items.slice(-3), { ...options, id, open: true }];
  emit();

  return () => dismissToast(id);
}

export function dismissToast(id: number) {
  items = items.map((item) => (item.id === id ? { ...item, open: false } : item));
  emit();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, 200);
}

const icons: Record<ToastTone, ReactNode> = {
  default: <Info className="text-info" aria-hidden />,
  success: <CheckCircle2 className="text-accent" aria-hidden />,
  error: <XCircle className="text-danger" aria-hidden />,
  warning: <AlertTriangle className="text-warning" aria-hidden />,
};

/** Mount once (Providers does this). */
export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);

  useEffect(() => {
    listeners.add(setList);

    return () => {
      listeners.delete(setList);
    };
  }, []);

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {list.map((item) => {
        const tone = item.tone ?? "default";

        return (
          <ToastPrimitive.Root
            key={item.id}
            open={item.open}
            duration={item.duration ?? 5000}
            type={tone === "error" ? "foreground" : "background"}
            onOpenChange={(open) => {
              if (!open) {
                dismissToast(item.id);
              }
            }}
            className={cn(
              "pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-pop",
              "data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out",
              "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=end]:animate-toast-out",
            )}
          >
            <span className="mt-0.5 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icons[tone]}</span>
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-sm font-medium text-fg">{item.title}</ToastPrimitive.Title>
              {item.description ? (
                <ToastPrimitive.Description className="mt-0.5 text-[13px] text-muted">
                  {item.description}
                </ToastPrimitive.Description>
              ) : null}
              {item.action ? (
                <ToastPrimitive.Action
                  altText={item.action.altText ?? item.action.label}
                  onClick={item.action.onClick}
                  className="mt-2 text-[13px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:underline"
                >
                  {item.action.label}
                </ToastPrimitive.Action>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label="Dismiss"
              className="-m-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex w-full max-w-[400px] flex-col gap-2 p-4 outline-none sm:bottom-2 sm:right-2" />
    </ToastPrimitive.Provider>
  );
}
