import { listLobbyTables, listUserLobbyTables } from "@poker-platform/shared/lobbies";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { CreateGameDialog } from "@/components/lobby/create-game-dialog";
import { JoinCodeDialog } from "@/components/lobby/join-code-dialog";
import { LobbyErrorToast } from "@/components/lobby/lobby-error-toast";
import { LobbyTables } from "@/components/lobby/lobby-tables";
import { QuickSeatButton } from "@/components/lobby/quick-seat-button";
import { YourTables } from "@/components/lobby/your-tables";
import { getShellViewer } from "@/components/shell/get-shell-viewer";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { requireCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lobby" };

type LobbyPageProps = {
  searchParams?: {
    error?: string | string[];
  };
};

function getError(searchParams?: LobbyPageProps["searchParams"]) {
  const error = searchParams?.error;
  const value = Array.isArray(error) ? error[0] : error;

  // Only short plain messages (set by our own redirects) are shown.
  return value && value.length <= 200 ? value : undefined;
}

export default async function LobbyPage({ searchParams }: LobbyPageProps) {
  const session = await requireCurrentSession();
  const [tables, yourTables, viewer] = await Promise.all([
    listLobbyTables(),
    listUserLobbyTables(session.user.id),
    getShellViewer(session),
  ]);
  const error = getError(searchParams);
  const chipBalance = viewer?.chipBalance ?? null;
  const displayName = viewer?.name ?? session.user.name ?? null;

  return (
    <PageContainer>
      <PageHeader
        title="Lobby"
        description="Pick a table or start your own. Chips are play money."
        actions={
          <>
            <JoinCodeDialog />
            <CreateGameDialog
              chipBalance={chipBalance}
              displayName={displayName}
              trigger={
                <Button variant="secondary" leftIcon={<Plus aria-hidden />}>
                  Create game
                </Button>
              }
            />
            <QuickSeatButton />
          </>
        }
      />

      <LobbyErrorToast message={error ?? null} />
      <div className="flex flex-col gap-8">
        <YourTables tables={yourTables} />
        <LobbyTables
          initialTables={tables}
          memberTableIds={yourTables.map((table) => table.tableId)}
          createAction={<CreateGameDialog chipBalance={chipBalance} displayName={displayName} />}
        />
      </div>
    </PageContainer>
  );
}
