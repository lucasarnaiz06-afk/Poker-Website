"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui";

type Option = { value: string; label: string };

const ALL = "all";

/** Position group and stakes filters for /stats (URL params `pos` and `stakes`). */
export function StatsFilters({
  position,
  stakes,
  positionOptions,
  stakesOptions,
}: {
  position: string | null;
  stakes: string | null;
  positionOptions: readonly Option[];
  stakesOptions: readonly Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (key: "pos" | "stakes", value: string) => {
    const p = new URLSearchParams(params.toString());
    if (value === ALL) p.delete(key);
    else p.set(key, value);
    const qs = p.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return (
    <div aria-busy={pending} className={`flex flex-wrap gap-2 ${pending ? "opacity-70" : ""}`}>
      <Select
        aria-label="Position"
        size="sm"
        className="w-40"
        value={position ?? ALL}
        onValueChange={(v) => set("pos", v)}
        options={[{ value: ALL, label: "All positions" }, ...positionOptions]}
      />
      <Select
        aria-label="Stakes"
        size="sm"
        className="w-36"
        value={stakes ?? ALL}
        onValueChange={(v) => set("stakes", v)}
        options={[{ value: ALL, label: "All stakes" }, ...stakesOptions]}
      />
    </div>
  );
}
