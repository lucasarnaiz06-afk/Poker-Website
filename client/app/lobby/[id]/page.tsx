import { joinLobbyForUser, LobbyServiceError } from "@poker-platform/shared/lobbies";
import { redirect } from "next/navigation";
import { LiveTableProvider, TableScreen } from "@/components/table";
import { requireCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type TablePageProps = {
  params: { id: string };
  searchParams?: { sit?: string | string[] };
};

export default async function TablePage({ params, searchParams }: TablePageProps) {
  const session = await requireCurrentSession();
  let lobbyId: string;
  let inviteCode: string | null = null;

  try {
    // Members go straight back to the table; public tables admit anyone; private ones need the invite link.
    const lobby = await joinLobbyForUser(
      {
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      },
      { lobbyId: params.id },
    );
    lobbyId = lobby.id;
    // Private tables share the invite link from the table's menu; public ones share the table URL.
    inviteCode = lobby.visibility === "PRIVATE" ? lobby.inviteCode : null;
  } catch (error) {
    const message = error instanceof LobbyServiceError ? error.message : "That table couldn't be opened.";
    redirect(`/lobby?error=${encodeURIComponent(message)}`);
  }

  return (
    <LiveTableProvider tableId={lobbyId}>
      <TableScreen inviteCode={inviteCode} autoSit={searchParams?.sit === "1"} />
    </LiveTableProvider>
  );
}
