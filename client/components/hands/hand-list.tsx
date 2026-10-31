import type { HandListRow } from "@poker-platform/shared/hands";
import { Bomb } from "lucide-react";
import Link from "next/link";
import { Badge, Chips, LocalTime, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { CardRow } from "./cards";

function bb(net: number, bigBlind: number) {
  const v = net / bigBlind;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} BB`;
}

export function HandList({ rows }: { rows: HandListRow[] }) {
  return (
    <>
      {/* Phones: stacked rows */}
      <ul className="divide-y divide-line md:hidden">
        {rows.map((r) => {
          return (
            <li key={r.handId}>
              <Link href={`/hands/${r.handId}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60">
                <CardRow cards={r.holeCards} width={r.variant === "PLO" ? 18 : 24} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm text-fg">
                    <span className="truncate">{r.tableName}</span>
                    {r.isBombPot ? <Bomb className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Bomb pot" /> : null}
                  </div>
                  <div className="text-xs text-muted">
                    #{r.handNumber} · {r.position} · <LocalTime value={r.endedAt} format="relative" />
                  </div>
                </div>
                <div className="text-right">
                  <Chips amount={r.net} signed className="text-sm font-semibold" />
                  <div className="tabular text-xs text-subtle">{bb(r.net, r.bigBlind)}</div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {/* Larger screens: table */}
      <Table wrapperClassName="hidden md:block">
        <THead>
          <TR>
            <TH>Time</TH>
            <TH>Table</TH>
            <TH>Your cards</TH>
            <TH>Board</TH>
            <TH>Position</TH>
            <TH numeric>Net</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => {
            return (
              <TR key={r.handId} interactive className="relative">
                <TD className="whitespace-nowrap">
                  <Link href={`/hands/${r.handId}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                    <LocalTime value={r.endedAt} format="relative" className="text-fg" />
                  </Link>
                  <div className="text-xs text-subtle">#{r.handNumber}</div>
                </TD>
                <TD>
                  <div className="flex items-center gap-1.5">
                    <span className="max-w-[200px] truncate">{r.tableName}</span>
                    {r.isBombPot ? (
                      <Badge tone="warning" icon={<Bomb />}>
                        Bomb
                      </Badge>
                    ) : null}
                  </div>
                  <div className="tabular text-xs text-subtle">
                    {r.variant === "PLO" ? "PLO " : ""}
                    {r.smallBlind}/{r.bigBlind}
                  </div>
                </TD>
                <TD>
                  <CardRow cards={r.holeCards} width={r.variant === "PLO" ? 20 : 26} />
                </TD>
                <TD>
                  <div className="flex flex-col gap-1">
                    {r.boards.length === 0 || r.board.length === 0 ? (
                      <span className="text-xs text-subtle">No flop</span>
                    ) : (
                      r.boards.map((b, i) => <CardRow key={i} cards={b} width={22} />)
                    )}
                  </div>
                </TD>
                <TD>
                  <Badge tone="outline">{r.position}</Badge>
                  {r.wentToShowdown ? <span className="ml-1.5 text-xs text-subtle">showdown</span> : null}
                </TD>
                <TD numeric>
                  <Chips amount={r.net} signed className="font-semibold" />
                  <div className="tabular text-xs text-subtle">{bb(r.net, r.bigBlind)}</div>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </>
  );
}
