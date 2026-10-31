"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/** Renders inside the account layout (header and section nav stay put). */
export default function AccountError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card>
      <EmptyState
        tone="danger"
        icon={<AlertTriangle />}
        title="This section couldn't load"
        description="Something went wrong on our side. Your account and chips are safe."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </Card>
  );
}
