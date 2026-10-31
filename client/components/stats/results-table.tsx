import type { ResultLine } from "@poker-platform/shared/stats/client";
import { Chips, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { cn } from "@/components/ui/cn";

function signed(v: number | null, digits = 1) {
  if (v === null) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
}

export function ResultsTable({ lines, label }: { lines: ResultLine[]; label: string }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>{label}</TH>
          <TH numeric>Hands</TH>
          <TH numeric>Net</TH>
          <TH numeric>bb/100</TH>
        </TR>
      </THead>
      <TBody>
        {lines.map((l) => (
          <TR key={l.key}>
            <TD className="h-11 whitespace-nowrap font-medium">{l.label}</TD>
            <TD numeric className="h-11">
              {l.hands.toLocaleString("en-US")}
            </TD>
            <TD numeric className="h-11">
              <Chips amount={l.net} signed compact />
            </TD>
            <TD numeric className={cn("h-11", (l.bb100 ?? 0) > 0 ? "text-accent" : (l.bb100 ?? 0) < 0 ? "text-danger" : "")}>
              {signed(l.bb100)}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
