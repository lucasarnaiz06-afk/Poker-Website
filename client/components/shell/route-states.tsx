import { AlertTriangle, SearchX } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer, type PageWidth } from "./page";

/** Body of an error.tsx boundary: what happened, that nothing was lost, and a retry. */
export function RouteErrorState({
  title = "This page couldn't load",
  description = "Something went wrong on our side. Your chips and hands are safe.",
  reset,
  width = "narrow",
}: {
  title?: string;
  description?: string;
  reset: () => void;
  width?: PageWidth;
}) {
  return (
    <PageContainer width={width}>
      <Card>
        <EmptyState
          tone="danger"
          icon={<AlertTriangle />}
          title={title}
          description={description}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={reset}>Try again</Button>
              <Button asChild variant="ghost">
                <Link href="/lobby">Go to lobby</Link>
              </Button>
            </div>
          }
        />
      </Card>
    </PageContainer>
  );
}

/** Body of a not-found.tsx: friendly message and one way back. */
export function NotFoundState({
  title = "Page not found",
  description = "The link may be mistyped, or the page has moved.",
  action,
  icon = <SearchX />,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <PageContainer width="narrow" className="py-12 sm:py-16">
      <Card>
        <EmptyState
          icon={icon}
          title={title}
          description={description}
          action={
            action ?? (
              <Button asChild>
                <Link href="/lobby">Go to lobby</Link>
              </Button>
            )
          }
        />
      </Card>
    </PageContainer>
  );
}

/** Generic page skeleton for loading.tsx: title, description and a few card rows. */
export function PageSkeleton({
  label,
  width = "default",
  rows = 4,
}: {
  label: string;
  width?: PageWidth;
  rows?: number;
}) {
  return (
    <PageContainer width={width}>
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="mb-6 flex flex-col gap-2 sm:mb-8">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Card className="divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        ))}
      </Card>
    </PageContainer>
  );
}
