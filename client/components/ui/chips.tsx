import { cn } from "./cn";

const fullFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const bbFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** "12,345" (or "12.3K" when compact). Integers only; never shows decimals for chips. */
export function formatChips(amount: number, options: { compact?: boolean; signed?: boolean } = {}) {
  const abs = Math.abs(Math.trunc(amount));
  const body = options.compact && abs >= 10_000 ? compactFormatter.format(abs) : fullFormatter.format(abs);
  const sign = amount < 0 ? "−" : options.signed && amount > 0 ? "+" : "";

  return `${sign}${body}`;
}

/** Big blinds with at most one decimal: "40 BB", "12.5 BB". */
export function formatBB(amount: number, bigBlind: number) {
  if (bigBlind <= 0) {
    return "";
  }

  return `${bbFormatter.format(amount / bigBlind)} BB`;
}

export function ChipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("h-3.5 w-3.5 shrink-0", className)} aria-hidden>
      <circle cx="8" cy="8" r="7" fill="rgb(var(--gold))" />
      <circle cx="8" cy="8" r="4.25" fill="none" stroke="rgb(var(--bg))" strokeOpacity="0.55" strokeWidth="1.5" />
      <path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15" stroke="rgb(var(--bg))" strokeOpacity="0.55" strokeWidth="1.5" />
    </svg>
  );
}

export type ChipsProps = {
  amount: number;
  /** Big blind; when set with showBB, renders "(40 BB)" next to the amount. */
  bigBlind?: number;
  showBB?: boolean;
  /** Show only BB (falls back to chips when bigBlind is missing). */
  bbOnly?: boolean;
  /** Prefix + for positive; colors positive accent and negative danger. */
  signed?: boolean;
  compact?: boolean;
  icon?: boolean;
  className?: string;
};

/** Chip amount with tabular numerals. Screen readers hear "1,234 chips". */
export function Chips({
  amount,
  bigBlind,
  showBB = false,
  bbOnly = false,
  signed = false,
  compact = false,
  icon = false,
  className,
}: ChipsProps) {
  const tone = signed ? (amount > 0 ? "text-accent" : amount < 0 ? "text-danger" : undefined) : undefined;
  const hasBB = bigBlind !== undefined && bigBlind > 0;
  const chipsText = formatChips(amount, { compact, signed });
  const bbText = hasBB ? formatBB(amount, bigBlind) : "";
  const main = bbOnly && hasBB ? `${signed && amount > 0 ? "+" : ""}${bbText}` : chipsText;

  return (
    <span className={cn("tabular inline-flex items-center gap-1 whitespace-nowrap", tone, className)}>
      {icon ? <ChipIcon /> : null}
      <span aria-hidden>{main}</span>
      {showBB && hasBB && !bbOnly ? (
        <span className="text-subtle" aria-hidden>
          ({bbText})
        </span>
      ) : null}
      <span className="sr-only">
        {bbOnly && hasBB ? bbText.replace("BB", "big blinds") : `${formatChips(amount, { signed })} chips`}
        {showBB && hasBB && !bbOnly ? `, ${bbText.replace("BB", "big blinds")}` : ""}
      </span>
    </span>
  );
}
