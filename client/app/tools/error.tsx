"use client";

import { RouteErrorState } from "@/components/shell/route-states";

export default function ToolsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState title="Tools couldn't load" reset={reset} />;
}
