"use client";

import { AlertTriangle } from "lucide-react";
import { PageContainer } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export default function LobbyError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageContainer>
      <Card>
        <EmptyState
          tone="danger"
          icon={<AlertTriangle />}
          title="The lobby couldn't load"
          description="Something went wrong on our side. Your chips are safe."
          action={<Button onClick={reset}>Try again</Button>}
        />
      </Card>
    </PageContainer>
  );
}
