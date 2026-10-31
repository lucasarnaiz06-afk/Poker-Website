import { PageContainer } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function LobbyLoading() {
  return (
    <PageContainer>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" aria-busy="true">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
      <span className="sr-only" role="status">
        Loading tables
      </span>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Skeleton className="h-10 w-full sm:w-80" />
        <Skeleton className="h-10 w-64" />
      </div>
      <Card className="divide-y divide-line">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-5 py-4">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="hidden h-4 w-16 md:block" />
            <Skeleton className="hidden h-4 w-20 md:block" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </Card>
    </PageContainer>
  );
}
