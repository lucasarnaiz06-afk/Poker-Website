import { PageContainer } from "@/components/shell/page";
import { Card, CardBody, Skeleton } from "@/components/ui";

export default function ProfileLoading() {
  return (
    <PageContainer width="narrow">
      <span className="sr-only" role="status">
        Loading profile
      </span>
      <div className="space-y-6">
        <Card>
          <CardBody className="flex flex-col items-start gap-4 py-6 sm:flex-row sm:items-center">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-7 w-48 max-w-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          </CardBody>
        </Card>
        <Card className="space-y-3 p-5">
          <Skeleton className="h-5 w-16" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
