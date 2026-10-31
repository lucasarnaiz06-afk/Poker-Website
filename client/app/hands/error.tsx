"use client";

import { RouteError } from "@/components/stats/route-error";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError title="Hand history couldn't load" reset={reset} />;
}
