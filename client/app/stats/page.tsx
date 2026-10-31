import {
  formatNumber,
  formatPct,
  getMoneyFlow,
  getMyStats,
  getPlayerNotes,
  listPlayerNotes,
  parseStatsFilters,
  parseStatsRange,
  rangeStart,
  type Ratio,
  type StatsReport,
} from "@poker-platform/shared/stats";
import { POSITION_GROUP_LABEL, POSITION_GROUPS } from "@poker-platform/shared/hands/client";
import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { pluralize } from "@/lib/format-time";
import { HandGrid } from "@/components/stats/hand-grid";
import { Insights } from "@/components/stats/insights";
import { MoneyFlowLists } from "@/components/stats/opponents";
import { NoteColorDot, PlayerNoteButton } from "@/components/stats/player-note-editor";
import { ProfitChart } from "@/components/stats/profit-chart";
import { RangeFilter } from "@/components/stats/range-filter";
import { ResultsTable } from "@/components/stats/results-table";
import { StatTile } from "@/components/stats/stat-tile";
import { Avatar, Button, Card, CardBody, CardHeader, Chips, EmptyState, formatChips, LocalTime } from "@/components/ui";
import { prisma } from "@poker-platform/shared/db";
import { requireUser } from "@/lib/auth/session";
import { StatsFilters } from "./stats-filters";

export const metadata: Metadata = { title: "My stats" };

function pctSub(r: Ratio, what = "spots") {
  return r.n > 0 ? `${r.hits.toLocaleString("en-US")} of ${r.n.toLocaleString("en-US")} ${what}` : "Not enough data yet";
}

function signedBB(v: number, digits = 1) {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatNumber(Math.abs(v), digits)}`;
}

function Filters({ range, position, stakes, report }: { range: "7d" | "30d" | "all"; position: string | null; stakes: string | null; report: StatsReport }) {
  const stakesOptions = report.byStakes.map((s) => ({ value: s.key, label: s.label }));
  if (stakes && !stakesOptions.some((o) => o.value === stakes)) stakesOptions.push({ value: stakes, label: stakes.replace(/^NLHE:/, "").replace(/^PLO:/, "PLO ") });
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <StatsFilters
        position={position}
        stakes={stakes}
        positionOptions={POSITION_GROUPS.map((g) => ({ value: g, label: POSITION_GROUP_LABEL[g] }))}
        stakesOptions={stakesOptions}
      />
      <RangeFilter value={range} />
    </div>
  );
}

export default async function StatsPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { userId } = await requireUser({ callbackUrl: "/stats" });
  const range = parseStatsRange(searchParams.range);
  const filters = parseStatsFilters(searchParams);
  const filtered = Boolean(filters.position || filters.stakes);
  const since = rangeStart(range);
  const [{ report }, flow, notes] = await Promise.all([getMyStats(userId, range, filters), getMoneyFlow(userId, since, 5), listPlayerNotes(userId, 50)]);
  const filterBar = <Filters range={range} position={filters.position ?? null} stakes={filters.stakes ?? null} report={report} />;
  const flowNotes = await getPlayerNotes(userId, [...flow.wonFrom, ...flow.lostTo].map((l) => l.userId));
  const h = report.headline;
  const rangeLabel = range === "7d" ? "the last 7 days" : range === "30d" ? "the last 30 days" : "all time";

  if (h.hands === 0) {
    // Never played: no filters (there is nothing to filter), just the way to a table.
    const everPlayed = filtered || range === "all" ? true : (await prisma.handPlayer.count({ where: { userId }, take: 1 })) > 0;

    if (!everPlayed || (range === "all" && !filtered)) {
      return (
        <PageContainer>
          <PageHeader title="My stats" description="How you play and where you win, in plain English." />
          <Card>
            <EmptyState
              icon={<BarChart3 />}
              title="Play your first hand"
              description="Win rate, playing style and a starting-hand chart show up here after your first hands."
              action={
                <Button asChild>
                  <Link href="/lobby">Find a table</Link>
                </Button>
              }
            />
          </Card>
        </PageContainer>
      );
    }

    return (
      <PageContainer>
        <PageHeader title="My stats" description="How you play and where you win, in plain English." actions={filterBar} />
        <Card>
          <EmptyState
            icon={<BarChart3 />}
            title={filtered ? "No hands match these filters" : `No hands in ${rangeLabel}`}
            description={
              filtered
                ? "Clear the position or stakes filter, or pick a longer time range."
                : "Pick a longer time range or sit down at a table."
            }
            action={
              <Button asChild>
                <Link href="/lobby">Find a table</Link>
              </Button>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="My stats"
        description={`Based on ${pluralize(h.hands, "hand")} in ${rangeLabel}${filtered ? " matching the filters" : ""}.${filtered ? " Opponents and notes below are not filtered." : ""}`}
        actions={filterBar}
      />

      <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile stat="hands" value={h.hands.toLocaleString("en-US")} sub={pluralize(report.sessions.length, "session")} />
          <StatTile
            stat="net"
            value={<Chips amount={h.net} signed />}
            sub={`${signedBB(h.netBB)} BB`}
            tone={h.net > 0 ? "positive" : h.net < 0 ? "negative" : null}
          />
          <StatTile stat="bb100" value={h.bb100 === null ? "—" : signedBB(h.bb100)} tone={(h.bb100 ?? 0) > 0 ? "positive" : (h.bb100 ?? 0) < 0 ? "negative" : null} sub="per 100 hands" />
          <StatTile stat="vpip" value={formatPct(h.vpip.value)} sub={pctSub(h.vpip, "hands")} />
          <StatTile stat="pfr" value={formatPct(h.pfr.value)} sub={pctSub(h.pfr, "hands")} />
          <StatTile stat="threeBet" value={formatPct(h.threeBet.value, 1)} sub={pctSub(h.threeBet)} />
          <StatTile
            stat="af"
            value={h.af.value === null ? (h.af.aggressive > 0 ? "∞" : "—") : formatNumber(h.af.value, 1)}
            sub={`${h.af.aggressive} bets/raises, ${h.af.calls} calls`}
          />
          <StatTile stat="wtsd" value={formatPct(h.wtsd.value)} sub={pctSub(h.wtsd, "flops")} />
          <StatTile stat="wsd" value={formatPct(h.wsd.value)} sub={pctSub(h.wsd, "showdowns")} />
          <StatTile stat="cbet" value={formatPct(h.cbet.value)} sub={pctSub(h.cbet, "flops")} />
        </dl>

        <section aria-labelledby="insights-title">
          <h2 id="insights-title" className="mb-3 text-[15px] font-semibold text-fg">
            Insights
          </h2>
          <Insights insights={report.insights} />
        </section>

        <Card as="section">
          <CardHeader
            title="Profit over time"
            description={
              report.hasEv
                ? `All-in EV: ${signedBB(h.allInEvBB)} BB vs ${signedBB(h.netBB)} BB actual over ${h.allInHands} all-in hand${h.allInHands === 1 ? "" : "s"}.`
                : "Cumulative result, hand by hand."
            }
          />
          <CardBody>
            <ProfitChart points={report.graph} hasEv={report.hasEv} />
          </CardBody>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card as="section" className="min-w-0">
            <CardHeader title="By position" description="Where you sit relative to the button." />
            <ResultsTable lines={report.byPosition} label="Position" />
          </Card>
          <Card as="section" className="min-w-0">
            <CardHeader title="By stakes" description="Blinds of the tables you played." />
            <ResultsTable lines={report.byStakes} label="Stakes" />
          </Card>
        </div>

        <Card as="section">
          <CardHeader title="Sessions" description="A new session starts after 30 minutes without a hand." />
          <ul className="divide-y divide-line">
            {report.sessions.slice(0, 10).map((s) => {
              const start = new Date(s.start);
              const mins = Math.max(1, Math.round((new Date(s.end).getTime() - start.getTime()) / 60_000));
              return (
                <li key={s.start} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg">
                      <LocalTime value={start} format="relative" />
                    </p>
                    <p className="truncate text-xs text-subtle">
                      {pluralize(s.hands, "hand")} · {mins} min · {s.tables.join(", ")}
                    </p>
                  </div>
                  <div className="text-right">
                    <Chips amount={s.net} signed className="text-sm font-semibold" />
                    <div className="tabular text-xs text-subtle">{signedBB(s.netBB)} BB</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card as="section">
          <CardHeader title="Starting hands" description="Your net result with each Hold'em starting hand, in big blinds." />
          <CardBody>
            <HandGrid cells={report.grid} />
          </CardBody>
        </Card>

        <section aria-labelledby="opponents-title" className="space-y-3">
          <div>
            <h2 id="opponents-title" className="text-[15px] font-semibold text-fg">
              Opponents
            </h2>
            <p className="text-sm text-muted">
              Who your chips came from and went to: in each hand your result is split across the players on the other side of it.
            </p>
          </div>
          <MoneyFlowLists wonFrom={flow.wonFrom} lostTo={flow.lostTo} notes={flowNotes} />
        </section>

        <Card as="section">
          <CardHeader title="My player notes" description="Private notes and colour tags. Only you can see them." />
          {notes.length === 0 ? (
            <EmptyState title="No notes yet" description="Add a note from an opponent above, their profile or the table." className="py-8" />
          ) : (
            <ul className="divide-y divide-line">
              {notes.map((n) => (
                <li key={n.subjectId} className="flex items-center gap-3 px-5 py-3">
                  <Avatar avatar={n.avatar} name={n.displayName} seed={n.subjectId} size="sm" decorative />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <NoteColorDot color={n.color} />
                      {n.username ? (
                        <Link href={`/u/${n.username}`} className="truncate text-sm font-medium text-fg hover:underline">
                          {n.displayName}
                        </Link>
                      ) : (
                        <span className="truncate text-sm font-medium text-fg">{n.displayName}</span>
                      )}
                    </div>
                    {n.text ? <p className="line-clamp-2 whitespace-pre-line text-sm text-muted">{n.text}</p> : null}
                  </div>
                  <PlayerNoteButton subjectId={n.subjectId} name={n.displayName} initial={{ text: n.text, color: n.color }} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="text-center text-xs text-subtle">
          Biggest pot won: {formatChips(h.biggestPot)} chips · Stats use play-money results only.
        </p>
      </div>
    </PageContainer>
  );
}
