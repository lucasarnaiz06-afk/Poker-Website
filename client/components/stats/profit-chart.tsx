"use client";

import type { GraphPoint } from "@poker-platform/shared/stats/client";
import { useMemo, useRef, useState } from "react";
import { Segmented } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { pluralize } from "@/lib/format-time";

type Unit = "chips" | "bb";
type SeriesKey = "net" | "ev" | "showdown" | "nonShowdown";

const SERIES: Array<{ key: SeriesKey; label: string; color: string; dash?: string; help: string }> = [
  { key: "net", label: "Net won", color: "rgb(var(--accent))", help: "Your running total" },
  { key: "ev", label: "All-in EV", color: "rgb(var(--gold))", dash: "5 4", help: "Your total with all-in luck removed" },
  { key: "showdown", label: "Showdown", color: "rgb(var(--info))", help: "Won or lost when cards were shown" },
  { key: "nonShowdown", label: "Non-showdown", color: "rgb(var(--warning))", dash: "2 3", help: "Won or lost without a showdown (bluffs, folds)" },
];

function value(p: GraphPoint, key: SeriesKey, unit: Unit): number {
  if (unit === "chips") return key === "net" ? p.net : key === "ev" ? p.ev : key === "showdown" ? p.showdown : p.nonShowdown;
  return key === "net" ? p.netBB : key === "ev" ? p.evBB : key === "showdown" ? p.showdownBB : p.nonShowdownBB;
}

function niceStep(range: number, ticks: number) {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  return (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
}

function fmt(v: number, unit: Unit) {
  const abs = Math.abs(v);
  const body = unit === "bb" ? (abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(abs < 10 ? 1 : 0)) : abs >= 10_000 ? `${(abs / 1000).toFixed(abs >= 100_000 ? 0 : 1)}k` : abs.toLocaleString("en-US");
  return `${v < 0 ? "−" : v > 0 ? "+" : ""}${body}${unit === "bb" ? " BB" : ""}`;
}

export function ProfitChart({ points, hasEv }: { points: GraphPoint[]; hasEv: boolean }) {
  const [unit, setUnit] = useState<Unit>("bb");
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const series = SERIES.filter((s) => s.key !== "ev" || hasEv);
  const shown = series.filter((s) => !hidden.has(s.key));

  const W = 720;
  const H = 260;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const maxN = points[points.length - 1]?.n ?? 1;
  const { min, max, ticks } = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const p of points) for (const s of shown) {
      const v = value(p, s.key, unit);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (hi === lo) hi = lo + 1;
    const step = niceStep(hi - lo, 4);
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let t = min; t <= max + step / 2; t += step) ticks.push(t);
    return { min, max, ticks };
  }, [points, shown, unit]);

  const x = (n: number) => pad.l + ((W - pad.l - pad.r) * n) / Math.max(1, maxN);
  const y = (v: number) => pad.t + ((H - pad.t - pad.b) * (max - v)) / (max - min || 1);
  const path = (key: SeriesKey) => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.n).toFixed(1)},${y(value(p, key, unit)).toFixed(1)}`).join("");

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const n = ((e.clientX - rect.left) / rect.width) * W;
    const hand = ((n - pad.l) / (W - pad.l - pad.r)) * maxN;
    let best = 0;
    for (let i = 0; i < points.length; i++) if (Math.abs(points[i]!.n - hand) < Math.abs(points[best]!.n - hand)) best = i;
    setHover(best);
  };

  const hp = hover !== null ? points[hover] : null;
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxN)).filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Lines">
          {series.map((s) => {
            const off = hidden.has(s.key);
            return (
              <li key={s.key}>
                <button
                  type="button"
                  aria-pressed={!off}
                  title={s.help}
                  onClick={() =>
                    setHidden((h) => {
                      const next = new Set(h);
                      if (next.has(s.key)) next.delete(s.key);
                      else if (shown.length > 1) next.add(s.key);
                      return next;
                    })
                  }
                  className={cn("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-opacity hover:bg-surface-2", off ? "text-subtle opacity-60" : "text-muted")}
                >
                  <svg width="16" height="6" aria-hidden>
                    <line x1="0" y1="3" x2="16" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
                  </svg>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
        <Segmented
          aria-label="Unit"
          size="sm"
          value={unit}
          onValueChange={setUnit}
          options={[
            { value: "bb", label: "Big blinds" },
            { value: "chips", label: "Chips" },
          ]}
        />
      </div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-pan-y select-none"
          role="img"
          aria-label={`Cumulative result over ${pluralize(maxN, "hand")}: ${fmt(value(points[points.length - 1]!, "net", unit), unit)}`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgb(var(--line))" strokeWidth={t === 0 ? 1.5 : 1} strokeDasharray={t === 0 ? undefined : "2 4"} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="fill-subtle text-[11px] tabular">
                {fmt(t, unit)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="fill-subtle text-[11px] tabular">
              {t.toLocaleString("en-US")}
            </text>
          ))}
          {shown.map((s) => (
            <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hp ? (
            <g>
              <line x1={x(hp.n)} x2={x(hp.n)} y1={pad.t} y2={H - pad.b} stroke="rgb(var(--muted))" strokeWidth={1} />
              {shown.map((s) => (
                <circle key={s.key} cx={x(hp.n)} cy={y(value(hp, s.key, unit))} r={4} fill={s.color} stroke="rgb(var(--surface))" strokeWidth={2} />
              ))}
            </g>
          ) : null}
        </svg>
        {hp ? (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[160px] rounded-lg border border-line bg-surface-3 px-3 py-2 text-xs shadow-pop"
            style={{ left: `${Math.min(70, Math.max(2, (x(hp.n) / W) * 100 + 2))}%` }}
          >
            <p className="mb-1 font-medium text-fg">
              After {hp.n.toLocaleString("en-US")} hand{hp.n === 1 ? "" : "s"}
            </p>
            {shown.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-3 text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="tabular text-fg">{fmt(value(hp, s.key, unit), unit)}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-center text-[11px] text-subtle">Hands played</p>
    </div>
  );
}
