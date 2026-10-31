import { Card, Skeleton } from "@/components/ui";

/** Renders inside the account layout (header and section nav stay put). */
export default function AccountLoading() {
  return (
    <>
      <span className="sr-only" role="status">
        Loading
      </span>
      {Array.from({ length: 2 }, (_, i) => (
        <Card key={i} className="space-y-4 p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </Card>
      ))}
    </>
  );
}
