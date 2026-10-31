import { formatPct, getPlayerNote, getPublicStatsSummary } from "@poker-platform/shared/stats";
import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { PlayerNoteEditor } from "@/components/stats/player-note-editor";
import { StatTile } from "@/components/stats/stat-tile";
import { Chips, EmptyState, formatChips, LocalTime } from "@/components/ui";
import { formatMonthYear, pluralize } from "@/lib/format-time";
import { cn } from "@/components/ui/cn";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Stats section on the public profile: public summary + the viewer's private note on this player.
 */
export type ProfileStatsSlotProps = {
  userId: string;
  username: string;
  handsPlayed: number;
};

function RecentForm({ days }: { days: Array<{ day: string; net: number; hands: number }> }) {
  const max = Math.max(1, ...days.map((d) => Math.abs(d.net)));
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted">Recent form (last 14 days)</p>
      <div className="flex h-16 items-center gap-1" role="img" aria-label={`Daily results: ${days.filter((d) => d.net > 0).length} winning days, ${days.filter((d) => d.net < 0).length} losing days`}>
        {days.map((d) => {
          const h = d.hands === 0 ? 0 : Math.max(6, (Math.abs(d.net) / max) * 50);
          return (
            <div key={d.day} className="flex h-full flex-1 flex-col justify-center" title={`${d.day}: ${pluralize(d.hands, "hand")}, ${d.net >= 0 ? "+" : ""}${formatChips(d.net)}`}>
              <div className="flex h-1/2 items-end">
                {d.net > 0 ? <div className="w-full rounded-t-[3px] bg-accent" style={{ height: `${h}%` }} /> : null}
              </div>
              <div className={cn("h-px w-full", d.hands > 0 ? "bg-line" : "bg-line/50")} />
              <div className="flex h-1/2 items-start">
                {d.net < 0 ? <div className="w-full rounded-b-[3px] bg-danger" style={{ height: `${h}%` }} /> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export async function ProfileStatsSlot({ userId, username }: ProfileStatsSlotProps) {
  const [summary, viewer] = await Promise.all([getPublicStatsSummary(userId), getCurrentUser()]);
  const note = viewer && viewer.userId !== userId ? await getPlayerNote(viewer.userId, userId) : null;

  const noteSection = note ? (
    <div className="border-t border-line px-5 py-4">
      <p className="mb-2 text-sm font-semibold text-fg">Your note on @{username}</p>
      <PlayerNoteEditor subjectId={userId} initial={{ text: note.text, color: note.color }} compact />
    </div>
  ) : null;

  if (!summary || summary.hands === 0) {
    return (
      <>
        <EmptyState icon={<BarChart3 />} title="No hands yet" description="Stats show up after this player's first hands." />
        {noteSection}
      </>
    );
  }

  const bbTone = (summary.bb100 ?? 0) > 0 ? "positive" : (summary.bb100 ?? 0) < 0 ? "negative" : null;
  return (
    <>
      <div className="space-y-5 px-5 py-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile stat="hands" value={summary.hands.toLocaleString("en-US")} sub={summary.lastPlayedAt ? <>Last played <LocalTime value={summary.lastPlayedAt} format="relative" /></> : undefined} />
          <StatTile stat="bb100" value={summary.bb100 === null ? "—" : `${summary.bb100 > 0 ? "+" : ""}${summary.bb100.toFixed(1)}`} tone={bbTone} sub={<Chips amount={summary.net} signed className="text-xs" />} />
          <StatTile stat="vpip" value={`${formatPct(summary.vpip.value)} / ${formatPct(summary.pfr.value)}`} sub="VPIP / PFR" />
          <StatTile
            stat="biggestPot"
            value={formatChips(summary.biggestPot)}
            sub={
              summary.biggestPotHandId && viewer ? (
                <Link href={`/hands/${summary.biggestPotHandId}`} className="text-info hover:underline">
                  Replay it
                </Link>
              ) : (
                `${summary.showdownsWon} showdowns won`
              )
            }
          />
        </dl>
        <RecentForm days={summary.recentForm} />
        <p className="text-xs text-subtle">
          Member since {formatMonthYear(summary.memberSince)} · {summary.showdownsWon.toLocaleString("en-US")} showdowns won
        </p>
      </div>
      {noteSection}
    </>
  );
}
