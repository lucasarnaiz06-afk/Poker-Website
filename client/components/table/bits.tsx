"use client";

import { cn } from "@/components/ui/cn";
import type { CSSProperties, ReactNode } from "react";
import { avatarHue, formatAmount, initials } from "./format";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "hidden h-5 min-w-5 items-center justify-center rounded border border-current/25 px-1 font-sans text-[11px] font-medium leading-none opacity-70 sm:inline-flex",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Avatar({
  name,
  id,
  url,
  size,
  className,
}: {
  name: string;
  id: string;
  url: string | null;
  size: number;
  className?: string;
}) {
  const hue = avatarHue(id);
  return (
    <div
      aria-hidden
      className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(145deg, hsl(${hue} 32% 34%), hsl(${hue} 30% 22%))`,
        color: `hsl(${hue} 60% 88%)`,
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        initials(name)
      )}
    </div>
  );
}

/**
 * Circular countdown drawn around the avatar. `fraction` is the share of time left (0..1).
 * Uses JS-driven values (not CSS animation) so reduced-motion settings don't break the timer.
 */
export function TimerRing({ size, fraction, tone }: { size: number; fraction: number; tone: "normal" | "low" | "bank" }) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const color = tone === "bank" ? "rgb(var(--warning))" : tone === "low" ? "rgb(var(--danger))" : "rgb(var(--accent))";
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90"
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(0 0 0 / 0.35)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.max(0, Math.min(1, fraction)))}
        style={{ transition: "stroke-dashoffset 250ms linear, stroke 200ms ease-out" }}
      />
    </svg>
  );
}

/** A small stack of chip discs (purely decorative). */
export function ChipStack({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-block h-3.5 w-3.5 shrink-0", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="absolute left-0 h-3.5 w-3.5 rounded-full border border-black/30"
          style={{
            bottom: i * 2.5,
            background: "radial-gradient(circle at 50% 50%, rgb(var(--gold)) 0 35%, #fff8 36% 44%, rgb(var(--gold)) 45%)",
            boxShadow: "0 1px 0 rgb(0 0 0 / 0.35)",
          }}
        />
      ))}
    </span>
  );
}

/** A player's current-street bet sitting on the felt (or, in gold, what they just won). */
export function BetChip({
  amount,
  bigBlind,
  inBB,
  win = false,
  size = "md",
  className,
}: {
  amount: number;
  bigBlind: number;
  inBB: boolean;
  win?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center whitespace-nowrap rounded-full py-0.5 pl-1 font-semibold shadow-sm ring-1",
        size === "lg" ? "gap-1.5 pr-2 text-[13px]" : size === "sm" ? "gap-1 pr-1.5 text-[11px]" : "gap-1.5 pr-2 text-xs",
        win ? "bg-gold text-black ring-black/20" : "bg-black/45 text-fg ring-white/10",
        className,
      )}
    >
      <ChipStack count={amount >= bigBlind * 10 ? 3 : amount >= bigBlind * 3 ? 2 : 1} />
      <span className="tabular">
        {win ? "+" : ""}
        {formatAmount(amount, bigBlind, inBB)}
      </span>
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
  className,
  style,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "gold" | "danger" | "warning" | "info";
  className?: string;
  style?: CSSProperties;
}) {
  const tones = {
    neutral: "bg-surface-3 text-muted",
    accent: "bg-accent/15 text-accent",
    gold: "bg-gold/15 text-gold",
    danger: "bg-danger/15 text-danger",
    warning: "bg-warning/15 text-warning",
    info: "bg-info/15 text-info",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold leading-none",
        tones[tone],
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}
