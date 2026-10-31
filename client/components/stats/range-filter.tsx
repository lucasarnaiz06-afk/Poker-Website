"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Segmented } from "@/components/ui";

type Range = "7d" | "30d" | "all";

export function RangeFilter({ value }: { value: Range }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <div aria-busy={pending} className={pending ? "opacity-70" : undefined}>
      <Segmented
        aria-label="Time range"
        value={value}
        onValueChange={(next) => {
          const p = new URLSearchParams(params.toString());
          if (next === "30d") p.delete("range");
          else p.set("range", next);
          const qs = p.toString();
          start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
        }}
        options={[
          { value: "7d", label: "7 days" },
          { value: "30d", label: "30 days" },
          { value: "all", label: "All time" },
        ]}
      />
    </div>
  );
}
