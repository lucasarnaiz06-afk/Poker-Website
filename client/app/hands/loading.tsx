import { PageContainer } from "@/components/shell/page";
import { Card, Skeleton } from "@/components/ui";

export default function HandsLoading() {
  return (
    <PageContainer>
      <span className="sr-only" role="status">
        Loading hands
      </span>
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
      <Card className="divide-y divide-line">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-9 w-14" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </Card>
    </PageContainer>
  );
}
