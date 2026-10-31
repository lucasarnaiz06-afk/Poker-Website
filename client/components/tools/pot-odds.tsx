"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, Field, InfoTip, Input, Segmented } from "@/components/ui";
import { cn } from "@/components/ui/cn";

const OUT_EXAMPLES = [
  { outs: 9, label: "Flush draw" },
  { outs: 8, label: "Open-ended straight draw" },
  { outs: 4, label: "Gutshot straight draw" },
  { outs: 2, label: "Pocket pair to a set" },
  { outs: 15, label: "Flush + straight draw" },
];

function num(value: string) {
  const n = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? Math.min(n, 1_000_000_000) : 0;
}

/** Pot odds vs. your chance to hit: the simplest "should I call?" check. */
export function PotOdds() {
  const [pot, setPot] = useState("300");
  const [call, setCall] = useState("100");
  const [outs, setOuts] = useState("9");
  const [street, setStreet] = useState<"flop" | "turn">("flop");

  const potN = num(pot);
  const callN = num(call);
  const outsN = Math.min(num(outs), 30);
  const need = potN + callN > 0 && callN > 0 ? callN / (potN + callN) : null;
  const unseen = street === "flop" ? 47 : 46;
  const nextCard = outsN / unseen;
  const byRiver = street === "flop" ? 1 - ((unseen - outsN) / unseen) * ((unseen - 1 - outsN) / (unseen - 1)) : nextCard;
  const ruleOf = street === "flop" ? Math.min(100, outsN * 4) : Math.min(100, outsN * 2);
  const profitable = need !== null ? nextCard >= need : null;

  return (
    <Card as="section">
      <CardHeader title="Pot odds & outs" description="Is calling worth it? Compare the price with your chance to hit." />
      <CardBody className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Pot (before you call)">
            <Input inputMode="numeric" value={pot} onChange={(e) => setPot(e.target.value)} />
          </Field>
          <Field label="To call">
            <Input inputMode="numeric" value={call} onChange={(e) => setCall(e.target.value)} />
          </Field>
          <Field
            label="Outs"
            labelAside={
              <InfoTip label="What are outs?" title="Outs">
                Cards left in the deck that would give you the best hand. A flush draw has 9: the 13 cards of your suit minus the 4 you can see.
              </InfoTip>
            }
          >
            <Input inputMode="numeric" value={outs} onChange={(e) => setOuts(e.target.value)} />
          </Field>
          <Field label="Now on the">
            <Segmented
              aria-label="Street"
              fullWidth
              value={street}
              onValueChange={setStreet}
              options={[
                { value: "flop", label: "Flop" },
                { value: "turn", label: "Turn" },
              ]}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {OUT_EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => setOuts(String(ex.outs))}
              className={cn(
                "rounded-full border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-fg",
                outsN === ex.outs && "border-accent/60 text-fg",
              )}
            >
              {ex.label} · {ex.outs}
            </button>
          ))}
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-surface-2/50 p-3">
            <dt className="text-xs text-muted">You need to win at least</dt>
            <dd className="tabular text-2xl font-semibold text-fg">{need === null ? "—" : `${(need * 100).toFixed(1)}%`}</dd>
            <dd className="text-xs text-subtle">call ÷ (pot + call)</dd>
          </div>
          <div className="rounded-lg border border-line bg-surface-2/50 p-3">
            <dt className="text-xs text-muted">Chance to hit on the next card</dt>
            <dd className="tabular text-2xl font-semibold text-fg">{(nextCard * 100).toFixed(1)}%</dd>
            <dd className="text-xs text-subtle">
              {outsN} outs of {unseen} unseen cards
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-surface-2/50 p-3">
            <dt className="text-xs text-muted">{street === "flop" ? "By the river (if all-in)" : "On the river"}</dt>
            <dd className="tabular text-2xl font-semibold text-fg">{(byRiver * 100).toFixed(1)}%</dd>
            <dd className="text-xs text-subtle">
              Shortcut: outs × {street === "flop" ? 4 : 2} ≈ {ruleOf}%
            </dd>
          </div>
        </dl>
        {need !== null ? (
          <p className={cn("rounded-lg px-4 py-3 text-sm", profitable ? "bg-accent/10 text-accent" : "bg-danger/10 text-danger")}>
            {profitable
              ? `Calling is profitable on its own: you hit ${(nextCard * 100).toFixed(0)}% of the time and only need ${(need * 100).toFixed(0)}%.`
              : `The price is too high for one card: you hit ${(nextCard * 100).toFixed(0)}% but need ${(need * 100).toFixed(0)}%. Call only if you expect to win more later (implied odds) or have other ways to win.`}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
