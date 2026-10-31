"use client";

import type { LobbyTableSummary } from "@poker-platform/shared/types";
import {
  TABLE_FEATURE_DESCRIPTIONS,
  TABLE_FEATURE_LABELS,
  TABLE_FEATURE_ORDER,
} from "@poker-platform/shared/lobbies/client";
import { Lock, Search, SearchX, Spade, Users } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FeatureBadges } from "./feature-badges";
import { formatBlinds, formatBuyInBB, formatBuyInRange, VARIANT_SHORT } from "./format";
import { JoinTableButton } from "./join-table-button";
import { SeatMeter } from "./seat-meter";
import { useLobbyLive, type LobbyLiveMode } from "./use-lobby-live";

type Feature = LobbyTableSummary["features"][number];
type VariantFilter = "ALL" | LobbyTableSummary["variant"];
type StakesFilter = "ALL" | "micro" | "low" | "mid" | "high";

const STAKES: Record<Exclude<StakesFilter, "ALL">, { label: string; test: (bb: number) => boolean }> = {
  micro: { label: "Micro (BB ≤ 10)", test: (bb) => bb <= 10 },
  low: { label: "Low (BB 11–50)", test: (bb) => bb > 10 && bb <= 50 },
  mid: { label: "Mid (BB 51–200)", test: (bb) => bb > 50 && bb <= 200 },
  high: { label: "High (BB > 200)", test: (bb) => bb > 200 },
};

const STAKES_OPTIONS = [
  { value: "ALL" as const, label: "All stakes" },
  ...(Object.keys(STAKES) as Array<keyof typeof STAKES>).map((key) => ({ value: key, label: STAKES[key].label })),
];

type Filters = {
  query: string;
  variant: VariantFilter;
  stakes: StakesFilter;
  openSeats: boolean;
  features: Feature[];
};

const EMPTY_FILTERS: Filters = { query: "", variant: "ALL", stakes: "ALL", openSeats: false, features: [] };

function applyFilters(tables: LobbyTableSummary[], filters: Filters) {
  const query = filters.query.trim().toLowerCase();

  return tables.filter(
    (table) =>
      (!query || table.name.toLowerCase().includes(query)) &&
      (filters.variant === "ALL" || table.variant === filters.variant) &&
      (filters.stakes === "ALL" || STAKES[filters.stakes].test(table.bigBlind)) &&
      (!filters.openSeats || table.seated < table.maxPlayers) &&
      filters.features.every((feature) => table.features.includes(feature)),
  );
}

function ToggleChip({
  pressed,
  onPressedChange,
  children,
  title,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        pressed
          ? "border-accent/50 bg-accent/10 text-fg"
          : "border-line bg-surface-2 text-muted hover:bg-surface-3 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function LiveIndicator({ mode }: { mode: LobbyLiveMode }) {
  const label = mode === "live" ? "Live" : mode === "polling" ? "Auto-refresh" : "Connecting";

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted"
      title={mode === "polling" ? "Updates every 10 seconds" : undefined}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          mode === "live" ? "animate-pulse bg-accent" : mode === "polling" ? "bg-info" : "bg-subtle",
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}

export type LobbyTablesProps = {
  initialTables: LobbyTableSummary[];
  /** Table ids the viewer already sits at ("Open" instead of "Join"). */
  memberTableIds: string[];
  /** Rendered in the empty state (usually the Create game button). */
  createAction?: ReactNode;
};

export function LobbyTables({ initialTables, memberTableIds, createAction }: LobbyTablesProps) {
  const { tables, mode } = useLobbyLive(initialTables);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const members = useMemo(() => new Set(memberTableIds), [memberTableIds]);
  // Live feeds may include private tables; the public list never shows them. Tables already listed under
  // "Your tables" aren't repeated here.
  const publicTables = useMemo(
    () =>
      tables.filter(
        (table) => table.visibility === "PUBLIC" && table.status !== "CLOSED" && !members.has(table.tableId),
      ),
    [tables, members],
  );
  const visible = useMemo(() => applyFilters(publicTables, filters), [publicTables, filters]);
  const filtersActive =
    filters.query !== "" ||
    filters.variant !== "ALL" ||
    filters.stakes !== "ALL" ||
    filters.openSeats ||
    filters.features.length > 0;

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <section aria-labelledby="open-tables-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="open-tables-heading" className="text-[15px] font-semibold text-fg">
          Open tables
          <span className="tabular ml-2 font-normal text-muted">{publicTables.length}</span>
        </h2>
        <LiveIndicator mode={mode} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            type="search"
            aria-label="Search tables by name"
            placeholder="Search tables"
            leading={<Search aria-hidden />}
            value={filters.query}
            onChange={(event) => update("query", event.target.value)}
            wrapperClassName="sm:max-w-xs sm:flex-1"
          />
          <div className="flex items-center gap-2">
            <Segmented
              aria-label="Game"
              value={filters.variant}
              onValueChange={(value) => update("variant", value)}
              options={[
                { value: "ALL", label: "All" },
                { value: "NLHE", label: "Hold'em" },
                { value: "PLO", label: "Omaha" },
              ]}
            />
            <Select
              aria-label="Stakes"
              value={filters.stakes}
              onValueChange={(value) => update("stakes", value)}
              options={STAKES_OPTIONS}
              className="w-[150px]"
            />
          </div>
        </div>
        <div
          className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
          role="group"
          aria-label="Filter by seats and features"
        >
          <ToggleChip pressed={filters.openSeats} onPressedChange={(pressed) => update("openSeats", pressed)}>
            <Users className="h-3.5 w-3.5" aria-hidden />
            Open seats
          </ToggleChip>
          <span className="h-5 w-px shrink-0 bg-line" aria-hidden />
          {TABLE_FEATURE_ORDER.map((feature) => (
            <ToggleChip
              key={feature}
              title={TABLE_FEATURE_DESCRIPTIONS[feature]}
              pressed={filters.features.includes(feature)}
              onPressedChange={(pressed) =>
                update(
                  "features",
                  pressed ? [...filters.features, feature] : filters.features.filter((item) => item !== feature),
                )
              }
            >
              {TABLE_FEATURE_LABELS[feature]}
            </ToggleChip>
          ))}
          {filtersActive ? (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {visible.length} {visible.length === 1 ? "table" : "tables"} shown
      </p>

      <Card className="overflow-hidden">
        {publicTables.length === 0 ? (
          <EmptyState
            icon={<Spade />}
            title="No open tables right now"
            description="Start one and invite your friends. It takes about ten seconds."
            action={createAction}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title="No tables match your filters"
            description="Try fewer filters or a different stake."
            action={
              <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <Table wrapperClassName="hidden md:block">
              <THead>
                <tr>
                  <TH className="pl-5">Table</TH>
                  <TH>Game</TH>
                  <TH numeric>Blinds</TH>
                  <TH numeric>Buy-in</TH>
                  <TH>Players</TH>
                  <TH className="pr-5">
                    <span className="sr-only">Action</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {visible.map((table) => (
                  <TR key={table.tableId} interactive>
                    <TD className="max-w-[320px] py-3 pl-5">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{table.name}</span>
                        {table.hasPassword ? (
                          <Lock className="h-3.5 w-3.5 shrink-0 text-subtle" aria-label="Password required" />
                        ) : null}
                      </div>
                      <FeatureBadges features={table.features} className="mt-1.5 flex flex-wrap gap-1" />
                    </TD>
                    <TD className="text-muted">{VARIANT_SHORT[table.variant]}</TD>
                    <TD numeric>{formatBlinds(table)}</TD>
                    <TD numeric>
                      <div className="flex flex-col items-end">
                        <span className="tabular text-fg">{formatBuyInRange(table)}</span>
                        <span className="text-xs text-subtle">{formatBuyInBB(table)}</span>
                      </div>
                    </TD>
                    <TD>
                      <SeatMeter seated={table.seated} max={table.maxPlayers} />
                    </TD>
                    <TD align="right" className="pr-5">
                      <JoinTableButton
                        tableId={table.tableId}
                        tableName={table.name}
                        hasPassword={Boolean(table.hasPassword)}
                        isFull={table.seated >= table.maxPlayers}
                        isMember={members.has(table.tableId)}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            <ul className="divide-y divide-line md:hidden">
              {visible.map((table) => (
                <li key={table.tableId} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-medium text-fg">
                        <span className="truncate">{table.name}</span>
                        {table.hasPassword ? (
                          <Lock className="h-3.5 w-3.5 shrink-0 text-subtle" aria-label="Password required" />
                        ) : null}
                      </p>
                      <p className="tabular mt-0.5 text-[13px] text-muted">
                        {VARIANT_SHORT[table.variant]} · {formatBlinds(table)} · {formatBuyInBB(table)}
                      </p>
                    </div>
                    <SeatMeter seated={table.seated} max={table.maxPlayers} className="shrink-0" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <FeatureBadges features={table.features} className="flex min-w-0 flex-wrap gap-1" />
                    <div className="ml-auto shrink-0">
                      <JoinTableButton
                        tableId={table.tableId}
                        tableName={table.name}
                        hasPassword={Boolean(table.hasPassword)}
                        isFull={table.seated >= table.maxPlayers}
                        isMember={members.has(table.tableId)}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </section>
  );
}
