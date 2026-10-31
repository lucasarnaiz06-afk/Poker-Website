"use client";

import { RouteErrorState } from "@/components/shell/route-states";

export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState reset={reset} />;
}
