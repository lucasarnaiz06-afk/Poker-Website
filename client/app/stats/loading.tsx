import { PageContainer } from "@/components/shell/page";
import { Card, Skeleton } from "@/components/ui";

export default function StatsLoading() {
  return (
    <PageContainer>
      <span className="sr-only" role="status">
        Loading stats
      </span>
      <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-9 w-56" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => (
          <Card key={i} className="space-y-2 px-4 py-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-3 w-24" />
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Card className="mt-6 p-5">
        <Skeleton className="h-[240px] w-full" />
      </Card>
    </PageContainer>
  );
}
