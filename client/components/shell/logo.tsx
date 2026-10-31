import Link from "next/link";
import { cn } from "@/components/ui/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-6 w-6", className)} aria-hidden>
      <rect width="24" height="24" rx="7" fill="rgb(var(--accent))" />
      <path
        d="M12 5.5c2.6 2.3 5 4.1 5 6.6a2.9 2.9 0 0 1-4.6 2.3l.8 3.1h-2.4l.8-3.1A2.9 2.9 0 0 1 7 12.1c0-2.5 2.4-4.3 5-6.6Z"
        fill="rgb(var(--accent-fg))"
      />
    </svg>
  );
}

/** Wordmark: spade mark + "Felt". Links home. */
export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg text-[15px] font-semibold tracking-tight text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    >
      <LogoMark />
      <span>Felt</span>
      <span className="sr-only">home</span>
    </Link>
  );
}
