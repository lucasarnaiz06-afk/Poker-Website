"use client";

import type { GridCell } from "@poker-platform/shared/stats/client";
import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { pluralize } from "@/lib/format-time";

function signed(v: number, digits = 1) {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
}

/** 13x13 starting-hand heatmap: green = won, red = lost (big blinds), grey = not played. */
export function HandGrid({ cells }: { cells: GridCell[] }) {
  const [selected, setSelected] = useState<GridCell | null>(null);
  const maxAbs = Math.max(1, ...cells.map((c) => Math.abs(c.netBB)));
  const played = cells.filter((c) => c.hands > 0);
  const best = [...played].sort((a, b) => b.netBB - a.netBB).slice(0, 3);
  const worst = [...played].sort((a, b) => a.netBB - b.netBB).filter((c) => c.netBB < 0).slice(0, 3);
  const detail = selected ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div>
        <div className="grid gap-[2px] rounded-lg" role="grid" aria-label="Results by starting hand" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
          {cells.map((c) => {
            const strength = Math.min(1, Math.sqrt(Math.abs(c.netBB) / maxAbs));
            const bg =
              c.hands === 0
                ? "rgb(var(--surface-2))"
                : c.netBB >= 0
                  ? `rgb(var(--accent) / ${0.15 + 0.75 * strength})`
                  : `rgb(var(--danger) / ${0.15 + 0.75 * strength})`;
            return (
              <button
                key={c.label}
                type="button"
                role="gridcell"
                onClick={() => setSelected(c)}
                onMouseEnter={() => setSelected(c)}
                aria-label={`${c.label}: ${c.hands === 0 ? "not played" : `${pluralize(c.hands, "hand")}, ${signed(c.netBB)} big blinds`}`}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-[3px] text-[8px] font-semibold leading-none sm:text-[11px]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg",
                  c.hands === 0 ? "text-subtle" : "text-fg",
                  detail?.label === c.label && "ring-2 ring-fg",
                )}
                style={{ background: bg }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-subtle">
          <span>Suited above the diagonal, offsuit below</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-danger/80" /> lost
            <span className="h-2 w-2 rounded-sm bg-surface-3" /> not played
            <span className="h-2 w-2 rounded-sm bg-accent/80" /> won
          </span>
        </div>
      </div>
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-line bg-surface-2 p-3" aria-live="polite">
          {detail ? (
            <>
              <p className="text-base font-semibold text-fg">{detail.label}</p>
              {detail.hands === 0 ? (
                <p className="text-muted">You haven&apos;t been dealt this hand yet.</p>
              ) : (
                <dl className="mt-1 grid grid-cols-2 gap-y-1 text-muted">
                  <dt>Hands</dt>
                  <dd className="tabular text-right text-fg">{detail.hands}</dd>
                  <dt>Net</dt>
                  <dd className={cn("tabular text-right", detail.netBB >= 0 ? "text-accent" : "text-danger")}>{signed(detail.netBB)} BB</dd>
                  <dt>Per hand</dt>
                  <dd className="tabular text-right text-fg">{signed(detail.netBB / detail.hands, 2)} BB</dd>
                </dl>
              )}
            </>
          ) : (
            <p className="text-muted">Tap a hand to see how it has done for you.</p>
          )}
        </div>
        {best.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Best hands</p>
            <ul className="space-y-0.5">
              {best.map((c) => (
                <li key={c.label} className="flex justify-between">
                  <span className="font-medium text-fg">{c.label}</span>
                  <span className="tabular text-accent">{signed(c.netBB)} BB</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {worst.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Costliest hands</p>
            <ul className="space-y-0.5">
              {worst.map((c) => (
                <li key={c.label} className="flex justify-between">
                  <span className="font-medium text-fg">{c.label}</span>
                  <span className="tabular text-danger">{signed(c.netBB)} BB</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
