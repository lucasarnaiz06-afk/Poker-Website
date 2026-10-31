"use client";

import { RouteError } from "@/components/stats/route-error";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError title="Stats couldn't load" reset={reset} />;
}
