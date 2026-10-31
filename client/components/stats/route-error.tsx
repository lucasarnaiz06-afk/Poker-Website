"use client";

import { AlertTriangle } from "lucide-react";
import { PageContainer } from "@/components/shell/page";
import { Button, Card, EmptyState } from "@/components/ui";

/** Shared error boundary body for the hands / stats / leaderboard routes. */
export function RouteError({ title, reset }: { title: string; reset: () => void }) {
  return (
    <PageContainer>
      <Card>
        <EmptyState
          tone="danger"
          icon={<AlertTriangle />}
          title={title}
          description="Something went wrong on our side. Your chips and hands are safe."
          action={<Button onClick={reset}>Try again</Button>}
        />
      </Card>
    </PageContainer>
  );
}
