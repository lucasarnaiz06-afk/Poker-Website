import type { UserLobbyTable } from "@poker-platform/shared/lobbies";
import { inviteLinkPath } from "@poker-platform/shared/lobbies/client";
import { Crown, Lock } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CloseTableButton } from "./close-table-button";
import { CopyButton } from "./copy-button";
import { formatBlinds, VARIANT_SHORT } from "./format";
import { SeatMeter } from "./seat-meter";

/** Tables the viewer is already sitting at, with quick "Open" and invite-link actions. */
export function YourTables({ tables }: { tables: UserLobbyTable[] }) {
  if (tables.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="your-tables-heading" className="flex flex-col gap-3">
      <h2 id="your-tables-heading" className="text-[15px] font-semibold text-fg">
        Your tables
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((table) => (
          <li key={table.tableId} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-medium text-fg">
                  <span className="truncate">{table.name}</span>
                  {table.visibility === "PRIVATE" ? (
                    <Lock className="h-3.5 w-3.5 shrink-0 text-subtle" aria-label="Private" />
                  ) : null}
                </p>
                <p className="tabular mt-0.5 text-[13px] text-muted">
                  {VARIANT_SHORT[table.variant]} · {formatBlinds(table)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {table.status === "RUNNING" ? (
                  <Badge tone="accent">Playing</Badge>
                ) : (
                  <Badge tone="neutral">Waiting</Badge>
                )}
                {table.isHost ? (
                  <Badge tone="gold" icon={<Crown aria-hidden />}>
                    Host
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="mt-auto flex items-center justify-between gap-2">
              <SeatMeter seated={table.seated} max={table.maxPlayers} />
              <div className="flex items-center gap-2">
                {table.isHost ? <CloseTableButton tableId={table.tableId} name={table.name} /> : null}
                {table.inviteCode && table.visibility === "PRIVATE" ? (
                  <CopyButton
                    text={inviteLinkPath(table.inviteCode)}
                    label="Invite"
                    aria-label={`Copy invite link for ${table.name}`}
                  />
                ) : null}
                <Button asChild size="sm">
                  <Link href={`/lobby/${table.tableId}`}>
                    Open<span className="sr-only"> {table.name}</span>
                  </Link>
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
