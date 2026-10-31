import { PageContainer } from "@/components/shell/page";
import { Card, Skeleton } from "@/components/ui";

export default function HandLoading() {
  return (
    <PageContainer width="wide">
      <span className="sr-only" role="status">
        Loading hand
      </span>
      <Skeleton className="mb-4 h-8 w-32" />
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="mb-6 h-4 w-72 max-w-full" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="p-4">
          <Skeleton className="mx-auto aspect-[3/4] w-full max-w-[760px] rounded-[40%] sm:aspect-[16/11]" />
        </Card>
        <Card className="space-y-3 p-4">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </Card>
      </div>
    </PageContainer>
  );
}
