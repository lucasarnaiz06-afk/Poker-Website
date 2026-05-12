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
    <main className="min-h-screen bg-[#0b1020] px-4 py-5 text-[#f8f8f2] md:px-6">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-5">
        <header className="flex flex-col gap-4 border-b-4 border-[#f8f8f2] pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/lobby"
              className="mb-3 inline-flex items-center gap-2 border-2 border-[#f8f8f2] bg-[#111827] px-3 py-2 text-[10px] font-semibold text-[#f8f8f2] hover:bg-[#f8f8f2] hover:text-[#111827]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Lobby
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-lg font-semibold tracking-normal text-[#f8f8f2] md:text-2xl">
                {lobby.name}
              </h1>
              {lobby.visibility === "PRIVATE" ? (
                <span className="inline-flex items-center gap-1 border-2 border-[#f8f8f2] px-2 py-1 text-[10px] font-semibold text-[#f8f8f2]">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  Private
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-[10px] text-[#9ca3af]">ID {lobby.id}</p>
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
