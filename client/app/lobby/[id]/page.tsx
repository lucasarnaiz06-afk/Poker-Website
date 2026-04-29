import { getWaitingRoomLobbyForUser, LobbyServiceError } from "@poker-platform/shared/lobbies";
import { ArrowLeft, Lock, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
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
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
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

        <section className="grid gap-4 md:grid-cols-4">
          <Metric label="Players" value={`${lobby.playerCount}/${lobby.maxPlayers}`} />
          <Metric label="Blinds" value={`${lobby.smallBlind}/${lobby.bigBlind}`} />
          <Metric label="Min buy-in" value={String(lobby.minBuyIn)} />
          <Metric label="Max buy-in" value={String(lobby.maxBuyIn)} />
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white">
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-zinc-950">Waiting Room</h2>
            <Users className="h-5 w-5 text-zinc-500" aria-hidden="true" />
          </div>
          <div className="divide-y divide-zinc-200">
            {lobby.players.map((player) => (
              <div
                key={player.id}
                className="grid gap-3 px-5 py-4 md:grid-cols-[80px_minmax(0,1fr)_120px] md:items-center"
              >
                <div className="text-sm font-semibold text-zinc-950">
                  Seat {player.seatNumber ?? "-"}
                </div>
                <div>
                  <p className="font-medium text-zinc-950">
                    {player.name || player.email || "Player"}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600">{player.email}</p>
                </div>
                <div className="text-sm font-semibold text-zinc-700">
                  Stack {player.stack ?? lobby.minBuyIn}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <p className="text-sm text-zinc-600">{label}</p>
      <p className="mt-2 text-xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}
