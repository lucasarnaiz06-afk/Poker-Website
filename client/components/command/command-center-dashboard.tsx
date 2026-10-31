"use client";

import type {
  CommandCenterGameDetail,
  CommandCenterGameSummary,
  PublicCard,
} from "@poker-platform/shared/types";
import { Eye, LogOut, Radio, RefreshCcw, ShieldCheck, Waves } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const GAME_POLL_INTERVAL_MS = 2000;
const DETAIL_POLL_INTERVAL_MS = 1500;

function getCardImageSrc(card: PublicCard) {
  const rank = card.rank === "T" ? "10" : card.rank;

  return `/cards/${rank}${card.suit.toUpperCase()}.png`;
}

function getCardAltText(card: PublicCard) {
  const rank = card.rank === "T" ? "10" : card.rank;

  return `${rank}${card.suit.toUpperCase()}`;
}

function formatChips(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function getPhaseLabel(phase: CommandCenterGameSummary["phase"]) {
  return phase.replace("_", " ");
}

async function readJson<T>(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function CommandCard({
  card,
  large = false,
}: {
  card?: PublicCard;
  large?: boolean;
}) {
  const sizeClasses = large
    ? "h-32 w-24 md:h-40 md:w-28"
    : "h-24 w-16 md:h-28 md:w-20";

  if (!card) {
    return (
      <div
        className={`${sizeClasses} shrink-0 border-4 border-dashed border-[#4b5563] bg-[#111827]`}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses} shrink-0 border-4 border-[#f8f8f2] bg-[#f8f8f2] p-1`}
    >
      <Image
        src={getCardImageSrc(card)}
        alt={getCardAltText(card)}
        width={80}
        height={112}
        unoptimized
        style={{ imageRendering: "pixelated" }}
        className="h-full w-full object-contain"
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4 border-4 border-dashed border-[#4b5563] bg-[#111827] p-6 text-center">
      <Waves className="h-10 w-10 text-[#7dd3fc]" aria-hidden="true" />
      <div>
        <h2 className="text-lg font-semibold text-[#f8f8f2]">No live games</h2>
        <p className="mt-3 text-sm leading-6 text-[#9ca3af]">
          Start a table and it will appear here automatically.
        </p>
      </div>
    </div>
  );
}

export function CommandCenterDashboard({
  initialGameId,
}: {
  initialGameId: string | null;
}) {
  const router = useRouter();
  const [games, setGames] = useState<CommandCenterGameSummary[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(
    initialGameId,
  );
  const [selectedGame, setSelectedGame] = useState<CommandCenterGameDetail | null>(
    null,
  );
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isLoadingGames, setIsLoadingGames] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  function handleSelectGame(lobbyId: string) {
    setSelectedGameId(lobbyId);
    router.replace(`/command?game=${lobbyId}`, { scroll: false });
  }

  useEffect(() => {
    let isActive = true;
    let timeoutId: number | undefined;

    async function loadGames() {
      try {
        const payload = await readJson<{ games: CommandCenterGameSummary[] }>(
          "/api/command/games",
        );

        if (!isActive) {
          return;
        }

        setGames(payload.games);
        setGamesError(null);
        setIsLoadingGames(false);

        const hasSelectedGame = payload.games.some(
          (game) => game.lobbyId === selectedGameId,
        );
        const nextSelectedGameId = hasSelectedGame
          ? selectedGameId
          : payload.games[0]?.lobbyId ?? null;

        if (nextSelectedGameId !== selectedGameId) {
          setSelectedGameId(nextSelectedGameId);
          const nextUrl = nextSelectedGameId
            ? `/command?game=${nextSelectedGameId}`
            : "/command";

          router.replace(nextUrl, { scroll: false });
        }
      } catch (error) {
        if (!isActive) {
          return;
        }

        console.error("Command center game list failed", error);
        setGamesError("Live game list is unavailable.");
        setIsLoadingGames(false);
      } finally {
        if (isActive) {
          timeoutId = window.setTimeout(loadGames, GAME_POLL_INTERVAL_MS);
        }
      }
    }

    void loadGames();

    return () => {
      isActive = false;

      if (typeof timeoutId === "number") {
        window.clearTimeout(timeoutId);
      }
    };
  }, [router, selectedGameId]);

  useEffect(() => {
    if (!selectedGameId) {
      setSelectedGame(null);
      setDetailError(null);
      return;
    }

    let isActive = true;
    let timeoutId: number | undefined;

    async function loadGame() {
      try {
        setIsLoadingDetail(true);

        const payload = await readJson<{ game: CommandCenterGameDetail }>(
          `/api/command/games/${selectedGameId}`,
        );

        if (!isActive) {
          return;
        }

        setSelectedGame(payload.game);
        setDetailError(null);
      } catch (error) {
        if (!isActive) {
          return;
        }

        console.error("Command center game detail failed", error);
        setSelectedGame(null);
        setDetailError("Live hand data is unavailable.");
      } finally {
        if (isActive) {
          setIsLoadingDetail(false);
          timeoutId = window.setTimeout(loadGame, DETAIL_POLL_INTERVAL_MS);
        }
      }
    }

    void loadGame();

    return () => {
      isActive = false;

      if (typeof timeoutId === "number") {
        window.clearTimeout(timeoutId);
      }
    };
  }, [selectedGameId]);

  return (
    <main className="min-h-screen bg-[#0b1020] px-3 py-3 text-[#f8f8f2] md:px-4">
      <div className="mx-auto flex max-w-[1900px] flex-col gap-3">
        <header className="flex flex-col gap-3 border-4 border-[#f8f8f2] bg-[#111827] p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 border-2 border-[#7cff6b] bg-[#173f1f] px-3 py-2 text-[10px] text-[#7cff6b]">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Live Testing Console
            </div>
            <h1 className="mt-4 text-xl font-semibold md:text-2xl">
              Command Center
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#9ca3af]">
              Full-card spectator view over every active runtime table.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 border-2 border-[#29adff] bg-[#1d2b53] px-3 py-2 text-[10px] text-[#9ad7ff]">
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              Auto-refreshing
            </div>
            <form action="/command/logout" method="post">
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center gap-2 border-4 border-[#f8f8f2] bg-[#0b1020] px-4 text-[10px] font-semibold text-[#f8f8f2]"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Lock
              </button>
            </form>
          </div>
        </header>

        <section className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="border-4 border-[#f8f8f2] bg-[#111827] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Current Games</h2>
                <p className="mt-2 text-[10px] text-[#9ca3af]">
                  {games.length} active
                </p>
              </div>
              <div className="border-2 border-[#ffd166] bg-[#4a3517] px-3 py-2 text-[10px] text-[#ffd166]">
                {isLoadingGames ? "..." : games.length}
              </div>
            </div>

            {gamesError ? (
              <div className="mt-3 border-2 border-[#ff3864] bg-[#451a1a] px-3 py-2 text-[10px] text-[#ffd6e8]">
                {gamesError}
              </div>
            ) : null}

            <div className="mt-3 max-h-[70vh] space-y-2 overflow-y-auto pr-1">
              {games.length === 0 && !isLoadingGames ? (
                <div className="border-2 border-[#4b5563] bg-[#0b1020] px-3 py-4 text-[10px] text-[#9ca3af]">
                  No active games
                </div>
              ) : null}

              {games.map((game) => {
                const isSelected = game.lobbyId === selectedGameId;

                return (
                  <button
                    key={game.lobbyId}
                    type="button"
                    onClick={() => handleSelectGame(game.lobbyId)}
                    className={`w-full border-4 p-3 text-left ${
                      isSelected
                        ? "border-[#ffd166] bg-[#4a3517] text-[#f8f8f2]"
                        : "border-[#f8f8f2] bg-[#0b1020] text-[#f8f8f2]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {game.lobbyName}
                        </p>
                        <p className="mt-2 text-[9px] text-[#d1d5db]">
                          {game.playerCount}/{game.maxPlayers} players
                        </p>
                      </div>
                      <span className="border-2 border-[#0b1020] bg-[#f8f8f2] px-2 py-1 text-[8px] text-[#0b1020]">
                        {getPhaseLabel(game.phase)}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-[9px]">
                      <div className="border-2 border-[#f8f8f2] bg-[#111827] px-2 py-2">
                        Pot {formatChips(game.potTotal)}
                      </div>
                      <div className="border-2 border-[#f8f8f2] bg-[#111827] px-2 py-2">
                        Hand {game.handNumber}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1">
                      {game.board.length > 0 ? (
                        game.board.map((card) => (
                          <span
                            key={`${card.rank}${card.suit}`}
                            className="border-2 border-[#f8f8f2] bg-[#111827] px-2 py-1 text-[8px]"
                          >
                            {getCardAltText(card)}
                          </span>
                        ))
                      ) : (
                        <span className="text-[8px] text-[#d1d5db]">
                          No board cards yet
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="min-w-0">
            {!selectedGameId ? (
              <EmptyState />
            ) : detailError ? (
              <div className="border-4 border-[#ff3864] bg-[#451a1a] p-6 text-[#ffd6e8]">
                {detailError}
              </div>
            ) : !selectedGame ? (
              <div className="flex min-h-[360px] items-center justify-center border-4 border-[#f8f8f2] bg-[#111827] p-6 text-[10px] text-[#9ca3af]">
                {isLoadingDetail ? "Loading live hand..." : "Waiting for hand data..."}
              </div>
            ) : (
              <div className="grid gap-3">
                <section className="border-4 border-[#f8f8f2] bg-[#111827] p-4">
                  <div className="flex flex-col gap-4 border-b-4 border-[#f8f8f2] pb-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">
                        {selectedGame.lobbyName}
                      </h2>
                      <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                        <span className="border-2 border-[#ffd166] bg-[#4a3517] px-3 py-2 text-[#ffd166]">
                          {getPhaseLabel(selectedGame.phase)}
                        </span>
                        <span className="border-2 border-[#29adff] bg-[#1d2b53] px-3 py-2 text-[#9ad7ff]">
                          Hand {selectedGame.handNumber}
                        </span>
                        <span className="border-2 border-[#7cff6b] bg-[#173f1f] px-3 py-2 text-[#7cff6b]">
                          Pot {formatChips(selectedGame.pot.total)}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-2 text-[10px] md:grid-cols-2">
                      <div className="border-2 border-[#f8f8f2] bg-[#0b1020] px-3 py-2">
                        Live updated {formatTimestamp(selectedGame.updatedAt)}
                      </div>
                      <div className="border-2 border-[#f8f8f2] bg-[#0b1020] px-3 py-2">
                        Started by {selectedGame.startedByName ?? "Player"}
                      </div>
                      <div className="border-2 border-[#f8f8f2] bg-[#0b1020] px-3 py-2">
                        Blinds {selectedGame.smallBlind}/{selectedGame.bigBlind}
                      </div>
                      <div className="border-2 border-[#f8f8f2] bg-[#0b1020] px-3 py-2">
                        Deck {selectedGame.deckCount} cards
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="border-4 border-[#f8f8f2] bg-[#0f7f3f] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="inline-flex items-center gap-2 border-2 border-[#0b1020] bg-[#ffd166] px-3 py-2 text-[10px] text-[#0b1020]">
                          <Eye className="h-4 w-4" aria-hidden="true" />
                          Full Table View
                        </div>
                        <div className="inline-flex items-center gap-2 border-2 border-[#0b1020] bg-[#111827] px-3 py-2 text-[10px] text-[#f8f8f2]">
                          <Radio className="h-4 w-4 text-[#ffd166]" aria-hidden="true" />
                          {selectedGame.currentTurnPlayerName ?? "No active turn"}
                        </div>
                      </div>

                      <div className="mt-6 flex flex-col items-center gap-4">
                        <div className="flex flex-wrap justify-center gap-2">
                          {selectedGame.board.length > 0 ? (
                            selectedGame.board.map((card) => (
                              <CommandCard
                                key={`${card.rank}${card.suit}`}
                                card={card}
                                large
                              />
                            ))
                          ) : (
                            <>
                              <CommandCard large />
                              <CommandCard large />
                              <CommandCard large />
                              <CommandCard large />
                              <CommandCard large />
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap justify-center gap-2">
                          {selectedGame.burnedCards.map((card, index) => (
                            <div key={`${card.rank}${card.suit}-${index}`}>
                              <CommandCard card={card} />
                            </div>
                          ))}
                        </div>

                        <div className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {selectedGame.players
                            .slice()
                            .sort((left, right) => left.seat - right.seat)
                            .map((player) => {
                              const isActing =
                                selectedGame.currentTurnPlayerId === player.id;

                              return (
                                <div
                                  key={player.id}
                                  className={`border-4 p-3 ${
                                    isActing
                                      ? "border-[#ffd166] bg-[#4a3517]"
                                      : player.folded
                                        ? "border-[#4b5563] bg-[#1f2937]"
                                        : "border-[#f8f8f2] bg-[#111827]"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-semibold">
                                        {player.name}
                                      </p>
                                      <p className="mt-2 text-[9px] text-[#d1d5db]">
                                        Seat {player.seat}
                                      </p>
                                    </div>
                                    <span className="border-2 border-[#f8f8f2] bg-[#0b1020] px-2 py-1 text-[8px]">
                                      {player.folded
                                        ? "Folded"
                                        : player.allIn
                                          ? "All-in"
                                          : isActing
                                            ? "Acting"
                                            : player.inHand
                                              ? "Live"
                                              : "Waiting"}
                                    </span>
                                  </div>

                                  <div className="mt-3 flex justify-center gap-2">
                                    {player.holeCards.map((card) => (
                                      <CommandCard
                                        key={`${player.id}-${card.rank}${card.suit}`}
                                        card={card}
                                      />
                                    ))}
                                  </div>

                                  <div className="mt-3 grid grid-cols-3 gap-2 text-[9px]">
                                    <div className="border-2 border-[#f8f8f2] bg-[#0b1020] px-2 py-2">
                                      Stack {formatChips(player.stack)}
                                    </div>
                                    <div className="border-2 border-[#f8f8f2] bg-[#0b1020] px-2 py-2">
                                      Bet {formatChips(player.currentBet)}
                                    </div>
                                    <div className="border-2 border-[#f8f8f2] bg-[#0b1020] px-2 py-2">
                                      In {formatChips(player.committed)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <section className="border-4 border-[#f8f8f2] bg-[#111827] p-3">
                        <h3 className="text-sm font-semibold">Showdown</h3>
                        <div className="mt-3 space-y-2">
                          {selectedGame.showdownHands.length > 0 ? (
                            selectedGame.showdownHands.map((hand) => (
                              <div
                                key={hand.playerId}
                                className="border-2 border-[#29adff] bg-[#1d2b53] px-3 py-2 text-[10px] text-[#9ad7ff]"
                              >
                                <p className="font-semibold">{hand.name}</p>
                                <p className="mt-2 leading-5">{hand.description}</p>
                              </div>
                            ))
                          ) : (
                            <div className="border-2 border-[#4b5563] bg-[#0b1020] px-3 py-3 text-[10px] text-[#9ca3af]">
                              No showdown hands yet
                            </div>
                          )}
                        </div>
                      </section>

                      <section className="border-4 border-[#f8f8f2] bg-[#111827] p-3">
                        <h3 className="text-sm font-semibold">Awards</h3>
                        <div className="mt-3 space-y-2">
                          {selectedGame.pot.awards.length > 0 ? (
                            selectedGame.pot.awards.map((award, index) => (
                              <div
                                key={`${award.amount}-${index}`}
                                className="border-2 border-[#ffd166] bg-[#4a3517] px-3 py-2 text-[10px] text-[#f8f8f2]"
                              >
                                <p className="font-semibold">
                                  {formatChips(award.amount)}
                                </p>
                                <p className="mt-2 text-[#ffd166]">
                                  {award.handDescription ?? "Awarded pot"}
                                </p>
                              </div>
                            ))
                          ) : (
                            <div className="border-2 border-[#4b5563] bg-[#0b1020] px-3 py-3 text-[10px] text-[#9ca3af]">
                              No pot awards yet
                            </div>
                          )}
                        </div>
                      </section>
                    </div>
                  </div>
                </section>

                <section className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_420px]">
                  <div className="border-4 border-[#f8f8f2] bg-[#111827] p-3">
                    <h3 className="text-sm font-semibold">Live Action Log</h3>
                    <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto">
                      {selectedGame.actionLog.length > 0 ? (
                        selectedGame.actionLog.map((event) => (
                          <div
                            key={event.id}
                            className="border-2 border-[#f8f8f2] bg-[#0b1020] px-3 py-2 text-[10px]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="leading-5 text-[#f8f8f2]">
                                {event.message}
                              </p>
                              <time className="shrink-0 text-[8px] text-[#9ca3af]">
                                {formatTimestamp(event.at)}
                              </time>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="border-2 border-[#4b5563] bg-[#0b1020] px-3 py-3 text-[10px] text-[#9ca3af]">
                          No actions yet
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <section className="border-4 border-[#f8f8f2] bg-[#111827] p-3">
                      <h3 className="text-sm font-semibold">Recent Hands</h3>
                      <div className="mt-3 space-y-2">
                        {selectedGame.handHistory.length > 0 ? (
                          selectedGame.handHistory.map((hand) => (
                            <div
                              key={hand.handNumber}
                              className="border-2 border-[#f8f8f2] bg-[#0b1020] px-3 py-3 text-[10px]"
                            >
                              <p className="font-semibold">Hand {hand.handNumber}</p>
                              <p className="mt-2 text-[#ffd166]">
                                {formatChips(hand.potSize)}
                              </p>
                              <p className="mt-2 leading-5 text-[#f8f8f2]">
                                {hand.winningHandDescription ?? "No description"}
                              </p>
                            </div>
                          ))
                        ) : (
                          <div className="border-2 border-[#4b5563] bg-[#0b1020] px-3 py-3 text-[10px] text-[#9ca3af]">
                            No completed hands yet
                          </div>
                        )}
                      </div>
                    </section>

                    {selectedGame.lastHandCompletePayload ? (
                      <section className="border-4 border-[#ffd166] bg-[#4a3517] p-3 text-[#f8f8f2]">
                        <h3 className="text-sm font-semibold">Last Result</h3>
                        <p className="mt-3 text-[10px] leading-5">
                          {selectedGame.lastHandCompletePayload.winningHandDescription ??
                            "Hand complete"}
                        </p>
                      </section>
                    ) : null}
                  </div>
                </section>
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
