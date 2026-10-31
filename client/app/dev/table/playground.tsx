"use client";

import { FIXTURE_CHAT, SCENARIOS } from "@/components/table/fixtures";
import { MockTableProvider, type MockConnection } from "@/components/table/mock-provider";
import { TableScreen } from "@/components/table/table-screen";
import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const GROUPS = ["Lobby", "Betting", "Results", "Side games", "Layouts"] as const;
const CONNECTIONS: MockConnection[] = ["connected", "connecting", "stalled", "reconnecting", "offline", "closed", "unauthorized"];

export function TablePlayground() {
  const [mounted, setMounted] = useState(false);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[3].id);
  const [simulate, setSimulate] = useState(true);
  const [resetCount, setResetCount] = useState(0);
  // ?conn=stalled|closed|… previews the connection states (Retry "succeeds" after a moment).
  const [connection, setConnection] = useState<MockConnection>("connected");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("s");
    if (fromUrl && SCENARIOS.some((s) => s.id === fromUrl)) setScenarioId(fromUrl);
    const conn = new URLSearchParams(window.location.search).get("conn") as MockConnection | null;
    if (conn && CONNECTIONS.includes(conn)) setConnection(conn);
    setMounted(true);
  }, []);

  const choose = (id: string) => {
    setScenarioId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("s", id);
    window.history.replaceState(null, "", url);
  };

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  // Rebuild the fixture (timers are relative to "now") whenever the scenario or reset changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => (mounted ? scenario.build(Date.now()) : null), [mounted, scenario, resetCount]);

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-dashed border-warning/40 bg-warning/5 px-2 text-xs sm:px-3">
        <span className="hidden font-semibold uppercase tracking-wide text-warning sm:inline">Dev</span>
        <label className="sr-only" htmlFor="scenario">
          Scenario
        </label>
        <select
          id="scenario"
          value={scenarioId}
          onChange={(e) => choose(e.target.value)}
          className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 text-xs text-fg sm:max-w-[260px] sm:flex-none"
        >
          {GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {SCENARIOS.filter((s) => s.group === g).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <label className="flex shrink-0 items-center gap-1.5 text-muted">
          <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} className="accent-[rgb(var(--accent))]" />
          <span className="hidden sm:inline">Simulate others</span>
          <span className="sm:hidden">Sim</span>
        </label>
        <button
          type="button"
          onClick={() => setResetCount((n) => n + 1)}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Reset scenario"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">Reset</span>
        </button>
        <span className="ml-auto hidden text-subtle lg:inline">Others start acting after your first action.</span>
      </div>
      <div className="min-h-0 flex-1">
        {view && (
          <MockTableProvider
            key={`${scenario.id}-${resetCount}-${connection}`}
            initialView={view}
            initialChat={FIXTURE_CHAT}
            simulate={simulate}
            connection={connection}
          >
            <TableScreen lobbyHref="/dev/table" className="h-full" />
          </MockTableProvider>
        )}
      </div>
    </div>
  );
}
