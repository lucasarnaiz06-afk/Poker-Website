import type { MoneyFlowLine, PlayerNoteView } from "@poker-platform/shared/stats";
import Link from "next/link";
import { Avatar, Chips, EmptyState } from "@/components/ui";
import { PlayerNoteButton } from "./player-note-editor";
import { pluralize } from "@/lib/format-time";

function Line({ line, note }: { line: MoneyFlowLine; note: PlayerNoteView | undefined }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Avatar avatar={line.avatar} name={line.displayName} seed={line.userId} size="sm" decorative />
      <div className="min-w-0 flex-1">
        {line.username ? (
          <Link href={`/u/${line.username}`} className="block truncate text-sm font-medium text-fg hover:underline">
            {line.displayName}
          </Link>
        ) : (
          <span className="block truncate text-sm text-muted">{line.displayName}</span>
        )}
        <span className="text-xs text-subtle">{pluralize(line.hands, "hand")} together</span>
      </div>
      <div className="text-right">
        <Chips amount={line.net} signed className="text-sm font-semibold" />
        <div className="tabular text-xs text-subtle">
          {line.netBB > 0 ? "+" : "−"}
          {Math.abs(line.netBB).toFixed(1)} BB
        </div>
      </div>
      {line.username ? (
        <PlayerNoteButton subjectId={line.userId} name={line.displayName} initial={{ text: note?.text ?? "", color: note?.color ?? "none" }} />
      ) : null}
    </li>
  );
}

export function MoneyFlowLists({
  wonFrom,
  lostTo,
  notes,
}: {
  wonFrom: MoneyFlowLine[];
  lostTo: MoneyFlowLine[];
  notes: Map<string, PlayerNoteView>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-line bg-surface">
        <p className="border-b border-line px-4 py-3 text-sm font-semibold text-fg">You won most from</p>
        {wonFrom.length === 0 ? (
          <EmptyState title="Nobody yet" description="Players you take chips from will show up here." className="py-8" />
        ) : (
          <ul className="divide-y divide-line">
            {wonFrom.map((l) => (
              <Line key={l.userId} line={l} note={notes.get(l.userId)} />
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-xl border border-line bg-surface">
        <p className="border-b border-line px-4 py-3 text-sm font-semibold text-fg">You lost most to</p>
        {lostTo.length === 0 ? (
          <EmptyState title="Nobody yet" description="Players who win chips from you will show up here." className="py-8" />
        ) : (
          <ul className="divide-y divide-line">
            {lostTo.map((l) => (
              <Line key={l.userId} line={l} note={notes.get(l.userId)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
