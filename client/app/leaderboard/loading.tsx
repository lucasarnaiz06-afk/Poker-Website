import { PageContainer } from "@/components/shell/page";
import { Card, Skeleton } from "@/components/ui";

export default function LeaderboardLoading() {
  return (
    <PageContainer width="narrow">
      <span className="sr-only" role="status">
        Loading leaderboard
      </span>
      <Skeleton className="mb-2 h-7 w-40" />
      <Skeleton className="mb-6 h-4 w-72 max-w-full" />
      <Skeleton className="mb-3 h-10 w-full" />
      <Skeleton className="mb-4 h-8 w-72 max-w-full" />
      <Card className="divide-y divide-line">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3">
            <Skeleton className="h-5 w-6" />
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </Card>
    </PageContainer>
  );
}
