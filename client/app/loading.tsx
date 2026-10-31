import { PageSkeleton } from "@/components/shell/route-states";

export default function RootLoading() {
  return <PageSkeleton label="Loading" rows={3} />;
}
