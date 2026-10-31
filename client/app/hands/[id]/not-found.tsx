import { SearchX } from "lucide-react";
import Link from "next/link";
import { PageContainer } from "@/components/shell/page";
import { Button, Card, EmptyState } from "@/components/ui";

export default function HandNotFound() {
  return (
    <PageContainer width="narrow">
      <Card>
        <EmptyState
          icon={<SearchX />}
          title="Hand not found"
          description="This hand doesn't exist or hasn't finished yet."
          action={
            <Button asChild>
              <Link href="/hands">Back to hand history</Link>
            </Button>
          }
        />
      </Card>
    </PageContainer>
  );
}
