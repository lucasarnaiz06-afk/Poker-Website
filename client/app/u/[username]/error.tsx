"use client";

import { RouteErrorState } from "@/components/shell/route-states";

export default function ProfileError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState title="This profile couldn't load" reset={reset} />;
}
