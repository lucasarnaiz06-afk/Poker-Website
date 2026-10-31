import { PageContainer } from "@/components/shell/page";
import { Card, Skeleton } from "@/components/ui";

export default function ToolsLoading() {
  return (
    <PageContainer width="narrow">
      <span className="sr-only" role="status">
        Loading tools
      </span>
      <Skeleton className="mb-2 h-7 w-24" />
      <Skeleton className="mb-6 h-4 w-64 max-w-full" />
      <Card className="space-y-4 p-5">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-44 w-full" />
      </Card>
    </PageContainer>
  );
}
