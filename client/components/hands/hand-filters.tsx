"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, Input, Select } from "@/components/ui";

const ANY = "any";

type Option = { value: string; label: string };

export function HandFilters({ tables }: { tables: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.delete("cursor");
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "" || value === ANY) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const select = (key: string, label: string, options: Option[]) => (
    <Select
      aria-label={label}
      size="sm"
      className="w-full"
      value={params.get(key) ?? ANY}
      onValueChange={(value) => update({ [key]: value })}
      options={[{ value: ANY, label }, ...options]}
    />
  );

  const active = ["table", "from", "to", "position", "result", "showdown", "bombPot", "q"].some((k) => params.has(k));

  return (
    <div className="space-y-3" aria-busy={pending}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2 sm:col-span-3 lg:col-span-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: q.trim() || null });
            }}
          >
            <Input
              size="sm"
              leading={<Search />}
              placeholder="Hand number, e.g. 1234"
              aria-label="Search by hand number"
              inputMode="numeric"
              value={q}
              onChange={(e) => setQ(e.target.value.replace(/[^\d#]/g, "").slice(0, 12))}
            />
          </form>
        </div>
        {select(
          "table",
          "All tables",
          tables.map((t) => ({ value: t.id, label: t.name })),
        )}
        {select("position", "Any position", ["BTN", "CO", "HJ", "LJ", "MP", "UTG", "UTG+1", "UTG+2", "SB", "BB"].map((p) => ({ value: p, label: p })))}
        {select("result", "Won or lost", [
          { value: "won", label: "Won" },
          { value: "lost", label: "Lost" },
        ])}
        {select("showdown", "Showdown?", [
          { value: "yes", label: "Went to showdown" },
          { value: "no", label: "No showdown" },
        ])}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          From
          <Input size="sm" type="date" value={params.get("from") ?? ""} onChange={(e) => update({ from: e.target.value || null })} className="w-[150px]" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          To
          <Input size="sm" type="date" value={params.get("to") ?? ""} onChange={(e) => update({ to: e.target.value || null })} className="w-[150px]" />
        </label>
        <div className="w-[150px]">
          {select("bombPot", "Bomb pots too", [
            { value: "yes", label: "Only bomb pots" },
            { value: "no", label: "No bomb pots" },
          ])}
        </div>
        {active ? (
          <Button variant="ghost" size="sm" leftIcon={<X />} onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
