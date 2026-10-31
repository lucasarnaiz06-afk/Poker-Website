import { getHandView } from "@poker-platform/shared/hands";
import { ArrowLeft, Bomb, Eye } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HandActions } from "@/components/hands/hand-actions";
import { HandReplayer, HandResults } from "@/components/hands/hand-replayer";
import { PageContainer } from "@/components/shell/page";
import { Badge, Button, LocalTime } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Hand replay" };

export default async function HandPage({ params }: { params: { id: string } }) {
  const { userId } = await requireUser({ callbackUrl: `/hands/${encodeURIComponent(params.id)}` });
  const view = await getHandView(params.id, userId);
  if (!view) notFound();
  const when = new Date(view.endedAt ?? view.startedAt);

  return (
    <PageContainer width="wide">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/hands">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Hand history
        </Link>
      </Button>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-fg">
            Hand #{view.handNumber}
            {view.isBombPot ? (
              <Badge tone="warning" size="md" icon={<Bomb />}>
                Bomb pot
              </Badge>
            ) : null}
            {view.runItTwice ? <Badge tone="info" size="md">Run twice</Badge> : null}
            {view.relation === "SPECTATOR" ? (
              <Badge tone="outline" size="md" icon={<Eye />}>
                Shared hand
              </Badge>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {view.tableName} · {view.variant === "PLO" ? "PLO" : "NL Hold'em"} {view.smallBlind}/{view.bigBlind}
            {view.ante > 0 ? ` (ante ${view.ante})` : ""} ·{" "}
            <LocalTime value={when} />
          </p>
        </div>
        <HandActions view={view} />
      </div>
      <div className="space-y-4">
        <HandReplayer view={view} />
        <HandResults view={view} />
      </div>
    </PageContainer>
  );
}
