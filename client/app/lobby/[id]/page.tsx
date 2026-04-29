import { getWaitingRoomLobbyForUser, LobbyServiceError } from "@poker-platform/shared/lobbies";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { PokerTable } from "@/components/lobby/poker-table";
import { requireCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type WaitingRoomPageProps = {
  params: {
    id: string;
  };
};

function redirectWithLobbyError(message: string): never {
  redirect(`/lobby?error=${encodeURIComponent(message)}`);
}

export default async function WaitingRoomPage({ params }: WaitingRoomPageProps) {
  const session = await requireCurrentSession();
  let lobby;

  try {
    lobby = await getWaitingRoomLobbyForUser(params.id, session.user.id);
  } catch (error) {
    if (error instanceof LobbyServiceError) {
      redirectWithLobbyError(error.message);
    }

    redirectWithLobbyError("Lobby could not be loaded.");
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-zinc-200 pb-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/lobby"
              className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-zinc-700 transition hover:text-zinc-950"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Lobby
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-normal text-zinc-950">
                {lobby.name}
              </h1>
              {lobby.visibility === "PRIVATE" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-600">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  Private
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-zinc-600">ID {lobby.id}</p>
          </div>
          <SignOutButton />
        </header>

        <PokerTable
          initialLobby={lobby}
          currentUserId={session.user.id}
        />
      </div>
    </main>
  );
}
