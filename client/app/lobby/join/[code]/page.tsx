import { getInvitePreview } from "@poker-platform/shared/lobbies";
import { Link2Off, Lock, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FeatureBadges } from "@/components/lobby/feature-badges";
import { formatBlinds, formatBuyInBB, VARIANT_SHORT } from "@/components/lobby/format";
import { InviteJoinForm } from "@/components/lobby/invite-join-form";
import { PageContainer } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { requireCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join table", robots: { index: false } };

export default async function InvitePage({ params }: { params: { code: string } }) {
  const session = await requireCurrentSession();
  const preview = await getInvitePreview(params.code, session.user.id);

  if (preview?.isMember) {
    redirect(`/lobby/${preview.tableId}`);
  }

  return (
    <PageContainer className="max-w-md py-12 sm:py-16">
      {!preview ? (
        <Card>
          <EmptyState
            icon={<Link2Off />}
            title="This invite doesn't work"
            description="The link may be mistyped, or the table has closed. Ask your host for a new link."
            action={
              <Button asChild variant="secondary">
                <Link href="/lobby">Back to lobby</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-6 py-5">
            <p className="text-xs font-medium text-muted">
              {preview.hostName ? `${preview.hostName} invited you to` : "You're invited to"}
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-fg">
              <span className="truncate">{preview.name}</span>
              {preview.hasPassword ? (
                <Lock className="h-4 w-4 shrink-0 text-subtle" aria-label="Password required" />
              ) : null}
            </h1>
            <FeatureBadges features={preview.features} className="mt-3 flex flex-wrap gap-1" />
          </div>
          <dl className="tabular grid grid-cols-3 gap-4 px-6 py-5 text-sm">
            <div>
              <dt className="text-xs text-muted">Game</dt>
              <dd className="mt-1 font-medium text-fg">{VARIANT_SHORT[preview.variant]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Blinds</dt>
              <dd className="mt-1 font-medium text-fg">{formatBlinds(preview)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Players</dt>
              <dd className="mt-1 inline-flex items-center gap-1 font-medium text-fg">
                <Users className="h-3.5 w-3.5 text-subtle" aria-hidden />
                {preview.seated}/{preview.maxPlayers}
              </dd>
            </div>
            <div className="col-span-3">
              <dt className="text-xs text-muted">Buy-in</dt>
              <dd className="mt-1 font-medium text-fg">
                <Chips amount={preview.minBuyIn} /> – <Chips amount={preview.maxBuyIn} />{" "}
                <span className="font-normal text-subtle">({formatBuyInBB(preview)})</span>
              </dd>
            </div>
          </dl>
          <div className="border-t border-line px-6 py-5">
            <InviteJoinForm
              tableId={preview.tableId}
              inviteCode={params.code}
              hasPassword={Boolean(preview.hasPassword)}
              isFull={preview.seated >= preview.maxPlayers}
              canJoin={preview.status === "WAITING"}
            />
          </div>
        </Card>
      )}
    </PageContainer>
  );
}
