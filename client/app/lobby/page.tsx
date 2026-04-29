import { listPublicWaitingLobbies } from "@poker-platform/shared/lobbies";
import { Lock, Plus, Search, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SubmitButton } from "@/components/lobby/submit-button";
import { requireCurrentSession } from "@/lib/auth/session";
import { createLobbyAction, joinLobbyAction } from "./actions";

export const dynamic = "force-dynamic";

type LobbyPageProps = {
  searchParams?: {
    error?: string | string[];
  };
};

function getError(searchParams?: LobbyPageProps["searchParams"]) {
  const error = searchParams?.error;

  return Array.isArray(error) ? error[0] : error;
}

export default async function LobbyPage({ searchParams }: LobbyPageProps) {
  const session = await requireCurrentSession();
  const publicLobbies = await listPublicWaitingLobbies();
  const error = getError(searchParams);

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-zinc-200 pb-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal text-zinc-950">
              Lobby
            </h1>
            <p className="mt-2 text-sm text-zinc-600">
              {session.user.email ?? "Authenticated account"}
            </p>
          </div>
          <SignOutButton />
        </header>

        {error ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="rounded-lg border border-zinc-200 bg-white">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Public Games</h2>
                <p className="mt-1 text-sm text-zinc-600">
                  {publicLobbies.length} waiting
                </p>
              </div>
              <Users className="h-5 w-5 text-zinc-500" aria-hidden="true" />
            </div>

            {publicLobbies.length > 0 ? (
              <div className="divide-y divide-zinc-200">
                {publicLobbies.map((lobby) => (
                  <div
                    key={lobby.id}
                    className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/lobby/${lobby.id}`}
                          className="font-semibold text-zinc-950 transition hover:text-emerald-800"
                        >
                          {lobby.name}
                        </Link>
                        <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600">
                          {lobby.playerCount}/{lobby.maxPlayers}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-zinc-600">
                        {lobby.smallBlind}/{lobby.bigBlind} blinds · {lobby.minBuyIn}-
                        {lobby.maxBuyIn} buy-in
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">ID {lobby.id}</p>
                    </div>

                    <form action={joinLobbyAction}>
                      <input type="hidden" name="lobbyId" value={lobby.id} />
                      <SubmitButton pendingLabel="Joining" variant="secondary">
                        Join
                      </SubmitButton>
                    </form>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-10 text-sm text-zinc-600">
                No public lobbies are waiting.
              </div>
            )}
          </div>

          <aside className="flex flex-col gap-4">
            <form action={createLobbyAction} className="rounded-lg border border-zinc-200 bg-white p-5">
              <input type="hidden" name="visibility" value="PUBLIC" />
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-zinc-950">Create Public</h2>
                <Plus className="h-5 w-5 text-zinc-500" aria-hidden="true" />
              </div>
              <LobbyFields namePlaceholder="Friday table" />
              <div className="mt-4">
                <SubmitButton pendingLabel="Creating">Create Public Game</SubmitButton>
              </div>
            </form>

            <form action={createLobbyAction} className="rounded-lg border border-zinc-200 bg-white p-5">
              <input type="hidden" name="visibility" value="PRIVATE" />
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-zinc-950">Create Private</h2>
                <Lock className="h-5 w-5 text-zinc-500" aria-hidden="true" />
              </div>
              <LobbyFields namePlaceholder="Study room table" />
              <label className="mt-3 block text-sm font-medium text-zinc-700" htmlFor="private-password">
                Password
              </label>
              <input
                id="private-password"
                name="password"
                type="password"
                minLength={4}
                className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                required
              />
              <div className="mt-4">
                <SubmitButton pendingLabel="Creating">Create Private Game</SubmitButton>
              </div>
            </form>

            <form action={joinLobbyAction} className="rounded-lg border border-zinc-200 bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-zinc-950">Join Private</h2>
                <Search className="h-5 w-5 text-zinc-500" aria-hidden="true" />
              </div>
              <label className="block text-sm font-medium text-zinc-700" htmlFor="join-lobby-id">
                Lobby ID
              </label>
              <input
                id="join-lobby-id"
                name="lobbyId"
                className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                required
              />
              <label className="mt-3 block text-sm font-medium text-zinc-700" htmlFor="join-password">
                Password
              </label>
              <input
                id="join-password"
                name="password"
                type="password"
                className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
              />
              <div className="mt-4">
                <SubmitButton pendingLabel="Joining" variant="secondary">
                  Join Private Lobby
                </SubmitButton>
              </div>
            </form>

            <div className="rounded-lg border border-zinc-200 bg-white p-5">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-emerald-700 text-white">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="text-lg font-semibold text-zinc-950">Account</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                {session.user.emailDomain
                  ? `Verified domain: ${session.user.emailDomain}`
                  : "Verified session"}
              </p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function LobbyFields({ namePlaceholder }: { namePlaceholder: string }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-zinc-700" htmlFor={`${namePlaceholder}-name`}>
          Name
        </label>
        <input
          id={`${namePlaceholder}-name`}
          name="name"
          minLength={3}
          maxLength={80}
          placeholder={namePlaceholder}
          className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Small blind" name="smallBlind" defaultValue={5} min={1} />
        <NumberField label="Big blind" name="bigBlind" defaultValue={10} min={1} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Min buy-in" name="minBuyIn" defaultValue={200} min={1} />
        <NumberField label="Max buy-in" name="maxBuyIn" defaultValue={1000} min={1} />
      </div>

      <NumberField label="Max players" name="maxPlayers" defaultValue={6} min={2} max={9} />
    </div>
  );
}

function NumberField({
  label,
  name,
  defaultValue,
  min,
  max,
}: {
  label: string;
  name: string;
  defaultValue: number;
  min: number;
  max?: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        defaultValue={defaultValue}
        min={min}
        max={max}
        className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
        required
      />
    </div>
  );
}
