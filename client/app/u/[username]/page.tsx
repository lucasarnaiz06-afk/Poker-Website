import { getPublicProfileByUsername } from "@poker-platform/shared/users";
import { CalendarDays, Layers } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Avatar, Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { PageContainer } from "@/components/shell/page";
import { formatMonthYear, pluralize } from "@/lib/format-time";
import { ProfileStatsSlot } from "./profile-stats-slot";

type Props = { params: { username: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await getPublicProfileByUsername(params.username);
  return { title: profile ? `${profile.displayName} (@${profile.username})` : "Player not found" };
}

export default async function PublicProfilePage({ params }: Props) {
  const profile = await getPublicProfileByUsername(params.username);

  if (!profile) {
    notFound();
  }

  const joined = formatMonthYear(profile.joinedAt);

  return (
    <PageContainer width="narrow">
      <div className="space-y-6">
        <Card>
          <CardBody className="flex flex-col items-start gap-4 py-6 sm:flex-row sm:items-center">
            <Avatar avatar={profile.avatar} name={profile.displayName} seed={profile.id} size="xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">{profile.displayName}</h1>
                {profile.role !== "USER" ? <Badge tone="info">{profile.role === "ADMIN" ? "Admin" : "Moderator"}</Badge> : null}
              </div>
              <p className="text-sm text-muted">@{profile.username}</p>
              {profile.bio ? <p className="mt-3 whitespace-pre-line text-sm leading-6 text-fg">{profile.bio}</p> : null}
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4" aria-hidden /> Joined {joined}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="h-4 w-4" aria-hidden />
                  <span className="tabular">{pluralize(profile.handsPlayed, "hand")}</span> played
                </span>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card as="section">
          <CardHeader title="Stats" />
          <ProfileStatsSlot userId={profile.id} username={profile.username} handsPlayed={profile.handsPlayed} />
        </Card>
      </div>
    </PageContainer>
  );
}
