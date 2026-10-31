import {
  getLeaderboard,
  LEADERBOARD_METRIC_LABEL,
  LEADERBOARD_METRICS,
  LEADERBOARD_PERIOD_LABEL,
  LEADERBOARD_PERIODS,
  parseLeaderboardMetric,
  parseLeaderboardPeriod,
  type LeaderboardMetric,
  type LeaderboardRow,
} from "@poker-platform/shared/stats";
import { Medal, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { Avatar, Button, Card, EmptyState, formatChips, InfoTip } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { getCurrentUser } from "@/lib/auth/session";
import { pluralize } from "@/lib/format-time";

export const metadata: Metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

const EXPLAIN: Record<LeaderboardMetric, string> = {
  profit: "Chips won minus chips lost in the period.",
  bb100: "Big blinds won per 100 hands. Only players with 500+ hands in the period are ranked.",
  hands: "Hands dealt in the period.",
  biggestPot: "The most chips collected in a single hand.",
  showdownWins: "Hands won when the cards were turned over.",
};

function formatValue(metric: LeaderboardMetric, value: number) {
  if (metric === "bb100") return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}`;
  if (metric === "profit") return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatChips(Math.abs(value))}`;
  return value.toLocaleString("en-US");
}

function href(metric: LeaderboardMetric, period: string) {
  return `/leaderboard?metric=${metric}&period=${period}`;
}

function MedalIcon({ rank }: { rank: number }) {
  if (rank > 3) return <span className="tabular w-6 text-center text-sm text-muted">{rank}</span>;
  const tone = rank === 1 ? "text-gold" : rank === 2 ? "text-[#c0c7d1]" : "text-[#cd8a52]";
  return (
    <span className="flex w-6 justify-center" aria-label={`Rank ${rank}`}>
      <Medal className={cn("h-5 w-5", tone)} aria-hidden />
    </span>
  );
}

function Row({ row, metric }: { row: LeaderboardRow; metric: LeaderboardMetric }) {
  const tone = metric === "profit" || metric === "bb100" ? (row.value > 0 ? "text-accent" : row.value < 0 ? "text-danger" : "text-fg") : "text-fg";
  return (
    <li className={cn("flex items-center gap-3 px-4 py-2.5 sm:px-5", row.isViewer && "bg-accent/10")}>
      <MedalIcon rank={row.rank} />
      <Avatar avatar={row.avatar} name={row.displayName} seed={row.userId} size="xs" decorative />
      <div className="min-w-0 flex-1">
        <Link href={`/u/${row.username}`} className="block truncate text-sm font-medium text-fg hover:underline">
          {row.displayName}
          {row.isViewer ? <span className="ml-1.5 text-xs font-normal text-accent">(you)</span> : null}
        </Link>
        <span className="text-xs text-subtle">{pluralize(row.hands, "hand")}</span>
      </div>
      <div className="text-right">
        {row.handId ? (
          <Link href={`/hands/${row.handId}`} className={cn("tabular text-sm font-semibold hover:underline", tone)}>
            {formatValue(metric, row.value)}
          </Link>
        ) : (
          <span className={cn("tabular text-sm font-semibold", tone)}>{formatValue(metric, row.value)}</span>
        )}
      </div>
    </li>
  );
}

export default async function LeaderboardPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const metric = parseLeaderboardMetric(searchParams.metric);
  const period = parseLeaderboardPeriod(searchParams.period);
  const viewer = await getCurrentUser();
  const board = await getLeaderboard({ metric, period, viewerId: viewer?.userId ?? null, limit: 50 });
  const viewerOutside = board.viewer && !board.rows.some((r) => r.isViewer) ? board.viewer : null;

  return (
    <PageContainer width="narrow">
      <PageHeader title="Leaderboard" description="Play-money rankings. Weeks start Monday, days reset at 00:00 UTC." />
      <nav aria-label="Metric" className="-mx-4 mb-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-1 border-b border-line">
          {LEADERBOARD_METRICS.map((m) => (
            <li key={m}>
              <Link
                href={href(m, period)}
                aria-current={m === metric ? "page" : undefined}
                className={cn(
                  "relative -mb-px inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
                  m === metric ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
                )}
              >
                {LEADERBOARD_METRIC_LABEL[m]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Period" className="inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
          {LEADERBOARD_PERIODS.map((p) => (
            <Link
              key={p}
              href={href(metric, p)}
              aria-current={p === period ? "page" : undefined}
              className={cn(
                "inline-flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium transition-colors",
                p === period ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg",
              )}
            >
              {LEADERBOARD_PERIOD_LABEL[p]}
            </Link>
          ))}
        </nav>
        <p className="flex items-center gap-1 text-xs text-muted">
          {board.total.toLocaleString("en-US")} ranked
          <InfoTip label={`About ${LEADERBOARD_METRIC_LABEL[metric]}`} title={LEADERBOARD_METRIC_LABEL[metric]}>
            {EXPLAIN[metric]} Ties share a rank.
          </InfoTip>
        </p>
      </div>
      <Card className="overflow-hidden">
        {board.rows.length === 0 ? (
          <EmptyState
            icon={<Trophy />}
            title="Nobody here yet"
            description={metric === "bb100" ? "Players need 500 hands in this period to be ranked by win rate." : "Play a hand to get on the board."}
            action={
              <Button asChild>
                <Link href="/lobby">Find a table</Link>
              </Button>
            }
          />
        ) : (
          <ol className="divide-y divide-line">
            {board.rows.map((row) => (
              <Row key={row.userId} row={row} metric={metric} />
            ))}
          </ol>
        )}
        {viewerOutside ? (
          <div className="border-t-2 border-dashed border-line">
            <ol>
              <Row row={viewerOutside} metric={metric} />
            </ol>
          </div>
        ) : null}
      </Card>
      {viewer && !board.viewer ? (
        <p className="mt-3 text-center text-sm text-muted">
          You&apos;re not ranked {period === "all" ? "yet" : `for ${LEADERBOARD_PERIOD_LABEL[period].toLowerCase()}`}
          {metric === "bb100" ? " (500 hands needed)" : ""}.{" "}
          <Link href="/lobby" className="text-accent hover:underline">
            Play a few hands
          </Link>
        </p>
      ) : null}
    </PageContainer>
  );
}
