"use client";

import type {
  LobbyPresencePayload,
  LobbySummary,
  PublicCard,
  PublicGameLogEntry,
  PublicHandCompletePayload,
  PublicHandHistoryEntry,
  PublicTablePlayer,
  PublicTableState,
} from "@poker-platform/shared/types";
import {
  getRealtimeSocketOptions,
  getRealtimeSocketUrl,
} from "@/lib/realtime-socket";
import {
  ArrowUp,
  Check,
  CircleDollarSign,
  History,
  LoaderCircle,
  Play,
  Radio,
  ScrollText,
  Trophy,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

type PlayerActionType = "fold" | "check" | "call" | "raise";

type ServerToClientEvents = {
  presence_update: (payload: LobbyPresencePayload) => void;
  lobby_error: (payload: { message: string }) => void;
  table_error: (payload: { message: string; code: string }) => void;
  game_state_update: (payload: PublicTableState) => void;
  hand_complete: (payload: PublicHandCompletePayload) => void;
};

type ClientToServerEvents = {
  join_lobby: (payload: { lobbyId: string }) => void;
  leave_lobby: (payload: { lobbyId: string }) => void;
  start_game: (payload: { lobbyId: string }) => void;
  player_action: (payload: {
    lobbyId: string;
    action: PlayerActionType;
    totalBet?: number;
  }) => void;
};

type ConnectionStatus = "connecting" | "connected" | "disconnected";

type PokerTableProps = {
  initialLobby: LobbySummary;
  currentUserId: string;
};

type SeatView = {
  id: string;
  userId: string;
  seat: number | null;
  name: string;
  stack: number;
  currentBet: number;
  committed: number;
  holeCards: PublicCard[];
  hasHiddenHoleCards: boolean;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  isViewer: boolean;
  isRevealed: boolean;
  isTurn: boolean;
  isOnline: boolean;
};

type QuickBetTarget = {
  label: string;
  totalBet: number;
};

const chipFormatter = new Intl.NumberFormat("en-US");

const phaseLabels: Record<PublicTableState["phase"], string> = {
  NOT_STARTED: "Not started",
  PRE_FLOP: "Pre-flop",
  FLOP: "Flop",
  TURN: "Turn",
  RIVER: "River",
  SHOWDOWN: "Showdown",
  COMPLETE: "Complete",
};

const suitSymbols: Record<PublicCard["suit"], string> = {
  c: "\u2663",
  d: "\u2666",
  h: "\u2665",
  s: "\u2660",
};

function formatChips(value: number) {
  return chipFormatter.format(value);
}

function getPlayerDisplayName(
  lobby: LobbySummary,
  userId: string,
  fallback = "Player",
) {
  const lobbyPlayer = lobby.players.find((player) => player.userId === userId);

  return lobbyPlayer?.name || lobbyPlayer?.email || fallback;
}

function getWinnerName(winner: PublicHandCompletePayload["winners"][number]) {
  return winner.name ?? "Player";
}

function getHandCompleteTitle(payload: PublicHandCompletePayload) {
  if (payload.winners.length === 0) {
    return "Hand complete";
  }

  if (payload.winners.length === 1) {
    const winner = payload.winners[0];

    return `${getWinnerName(winner)} wins ${formatChips(winner.amount)}`;
  }

  return `${payload.winners.map(getWinnerName).join(", ")} split ${formatChips(
    payload.potSize,
  )}`;
}

function getHandCompleteSubtitle(payload: PublicHandCompletePayload) {
  const handDescription =
    payload.winners.find((winner) => winner.handDescription)?.handDescription ??
    payload.winningHandDescription;

  return handDescription ? `with ${handDescription}` : "wins the pot";
}

function getConnectionLabel(status: ConnectionStatus) {
  if (status === "connected") {
    return "Connected";
  }

  if (status === "connecting") {
    return "Connecting";
  }

  return "Disconnected";
}

function getConnectionClasses(status: ConnectionStatus) {
  if (status === "connected") {
    return "border-emerald-300/40 bg-emerald-400/10 text-emerald-100";
  }

  if (status === "connecting") {
    return "border-amber-300/40 bg-amber-400/10 text-amber-100";
  }

  return "border-zinc-500/40 bg-zinc-800 text-zinc-200";
}

function buildSeatViews({
  lobby,
  tableState,
  onlineUserIds,
  currentUserId,
  isConnected,
}: {
  lobby: LobbySummary;
  tableState: PublicTableState | null;
  onlineUserIds: Set<string>;
  currentUserId: string;
  isConnected: boolean;
}): SeatView[] {
  if (tableState) {
    return [...tableState.players]
      .sort((left, right) => left.seat - right.seat)
      .map((player) => ({
        id: player.id,
        userId: player.id,
        seat: player.seat,
        name: getPlayerDisplayName(lobby, player.id, `Seat ${player.seat}`),
        stack: player.stack,
        currentBet: player.currentBet,
        committed: player.committed,
        holeCards: player.holeCards,
        hasHiddenHoleCards: player.hasHiddenHoleCards,
        folded: player.folded,
        allIn: player.allIn,
        inHand: player.inHand,
        isViewer: player.isViewer,
        isRevealed:
          tableState.phase === "SHOWDOWN" &&
          !player.isViewer &&
          player.holeCards.length > 0,
        isTurn: tableState.currentTurnPlayerId === player.id,
        isOnline:
          onlineUserIds.has(player.id) ||
          (player.id === currentUserId && isConnected),
      }));
  }

  return lobby.players
    .filter((player) => typeof player.seatNumber === "number")
    .sort((left, right) => (left.seatNumber ?? 0) - (right.seatNumber ?? 0))
    .map((player) => ({
      id: player.id,
      userId: player.userId,
      seat: player.seatNumber,
      name: player.name || player.email || `Seat ${player.seatNumber}`,
      stack: player.stack ?? lobby.minBuyIn,
      currentBet: 0,
      committed: 0,
      holeCards: [],
      hasHiddenHoleCards: false,
      folded: false,
      allIn: false,
      inHand: false,
      isViewer: player.userId === currentUserId,
      isRevealed: false,
      isTurn: false,
      isOnline:
        onlineUserIds.has(player.userId) ||
        (player.userId === currentUserId && isConnected),
    }));
}

function arrangeSeats(seats: SeatView[]) {
  if (seats.length <= 2) {
    return {
      top: seats.slice(0, 1),
      left: [],
      right: [],
      bottom: seats.slice(1),
    };
  }

  if (seats.length <= 4) {
    return {
      top: seats.slice(0, 2),
      left: [],
      right: [],
      bottom: seats.slice(2),
    };
  }

  return {
    top: seats.slice(0, 2),
    left: seats.slice(2, 4),
    right: seats.slice(4, 6),
    bottom: seats.slice(6),
  };
}

function getDefaultRaiseTo(
  tableState: PublicTableState | null,
  viewer: PublicTablePlayer | null,
) {
  if (!tableState || !viewer) {
    return "";
  }

  const minimumRaiseTo = tableState.currentBet + tableState.minRaise;
  const maximumRaiseTo = viewer.currentBet + viewer.stack;

  return String(Math.min(minimumRaiseTo, maximumRaiseTo));
}

function clampBetTarget(totalBet: number, maximumRaiseTo: number) {
  return Math.max(1, Math.min(totalBet, maximumRaiseTo));
}

function getQuickBetTargets(
  tableState: PublicTableState | null,
  viewer: PublicTablePlayer | null,
): QuickBetTarget[] {
  if (!tableState || !viewer || viewer.stack <= 0) {
    return [];
  }

  const maximumRaiseTo = viewer.currentBet + viewer.stack;
  const amountToCall = Math.max(0, tableState.currentBet - viewer.currentBet);
  const minimumRaiseTo = tableState.currentBet + tableState.minRaise;
  const potAfterCall = tableState.pot.total + amountToCall;
  const halfPotRaiseTo =
    tableState.currentBet + Math.floor(potAfterCall / 2);
  const potRaiseTo = tableState.currentBet + potAfterCall;

  return [
    {
      label: "1/2 Pot",
      totalBet: clampBetTarget(
        Math.max(minimumRaiseTo, halfPotRaiseTo),
        maximumRaiseTo,
      ),
    },
    {
      label: "Pot",
      totalBet: clampBetTarget(
        Math.max(minimumRaiseTo, potRaiseTo),
        maximumRaiseTo,
      ),
    },
    {
      label: "All-In",
      totalBet: maximumRaiseTo,
    },
  ].filter((target) => target.totalBet > tableState.currentBet);
}

export function PokerTable({ initialLobby, currentUserId }: PokerTableProps) {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(
    null,
  );
  const [lobby, setLobby] = useState(initialLobby);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [tableState, setTableState] = useState<PublicTableState | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [socketError, setSocketError] = useState<string | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [handComplete, setHandComplete] =
    useState<PublicHandCompletePayload | null>(null);
  const [raiseTo, setRaiseTo] = useState("");

  const onlineUsers = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);
  const viewer =
    tableState?.players.find((player) => player.isViewer) ?? null;
  const isConnected = connectionStatus === "connected";
  const isHost = lobby.createdByUserId === currentUserId;
  const hasStarted = Boolean(tableState && tableState.phase !== "NOT_STARTED");
  const isLocalTurn = Boolean(
    tableState?.currentTurnPlayerId &&
      tableState.currentTurnPlayerId === currentUserId,
  );
  const amountToCall =
    tableState && viewer
      ? Math.max(0, tableState.currentBet - viewer.currentBet)
      : 0;
  const quickBetTargets = useMemo(
    () => getQuickBetTargets(tableState, viewer),
    [tableState, viewer],
  );
  const activeTurnName = tableState?.currentTurnPlayerId
    ? getPlayerDisplayName(lobby, tableState.currentTurnPlayerId)
    : null;
  const seats = useMemo(
    () =>
      buildSeatViews({
        lobby,
        tableState,
        onlineUserIds: onlineUsers,
        currentUserId,
        isConnected,
      }),
    [currentUserId, isConnected, lobby, onlineUsers, tableState],
  );
  const arrangedSeats = useMemo(() => arrangeSeats(seats), [seats]);

  useEffect(() => {
    const socketUrl = getRealtimeSocketUrl();
    const socketOptions = getRealtimeSocketOptions();
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> =
      socketUrl
        ? io(socketUrl, socketOptions)
        : io(socketOptions);

    socketRef.current = socket;

    function joinLobby() {
      socket.emit("join_lobby", { lobbyId: initialLobby.id });
    }

    socket.on("connect", () => {
      setConnectionStatus("connected");
      setSocketError(null);
      joinLobby();
    });

    socket.on("disconnect", () => {
      setConnectionStatus("disconnected");
    });

    socket.io.on("reconnect_attempt", () => {
      setConnectionStatus("connecting");
    });

    socket.io.on("reconnect", () => {
      setConnectionStatus("connected");
    });

    socket.on("connect_error", (error) => {
      setConnectionStatus("disconnected");
      setSocketError(error.message);
    });

    socket.on("lobby_error", (payload) => {
      setSocketError(payload.message);
    });

    socket.on("table_error", (payload) => {
      setTableError(payload.message);
    });

    socket.on("presence_update", (payload) => {
      if (payload.lobby.id !== initialLobby.id) {
        return;
      }

      setLobby(payload.lobby);
      setOnlineUserIds(payload.onlineUserIds);
    });

    socket.on("game_state_update", (payload) => {
      if (payload.lobbyId !== initialLobby.id) {
        return;
      }

      setTableState(payload);
      setTableError(null);
    });

    socket.on("hand_complete", (payload) => {
      if (payload.lobbyId !== initialLobby.id) {
        return;
      }

      setHandComplete(payload);
    });

    socket.connect();

    return () => {
      socket.emit("leave_lobby", { lobbyId: initialLobby.id });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [initialLobby.id]);

  useEffect(() => {
    if (!handComplete) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setHandComplete(null);
    }, 5200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [handComplete]);

  useEffect(() => {
    if (!isLocalTurn) {
      return;
    }

    setRaiseTo(getDefaultRaiseTo(tableState, viewer));
  }, [
    isLocalTurn,
    tableState,
    tableState?.currentBet,
    tableState?.minRaise,
    viewer,
    viewer?.currentBet,
    viewer?.stack,
  ]);

  function emitPlayerAction(action: PlayerActionType, totalBet?: number) {
    if (!socketRef.current || !isConnected) {
      setTableError("The table is not connected.");
      return;
    }

    setTableError(null);
    socketRef.current.emit("player_action", {
      lobbyId: lobby.id,
      action,
      totalBet,
    });
  }

  function handleStartGame() {
    if (!socketRef.current || !isConnected) {
      setTableError("The table is not connected.");
      return;
    }

    setTableError(null);
    socketRef.current.emit("start_game", { lobbyId: lobby.id });
  }

  function handleCheckOrCall() {
    emitPlayerAction(amountToCall > 0 ? "call" : "check");
  }

  function handleRaiseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const totalBet = Number(raiseTo);

    if (!Number.isInteger(totalBet) || totalBet <= 0) {
      setTableError("Raise must be a positive whole number.");
      return;
    }

    emitPlayerAction("raise", totalBet);
  }

  function handleQuickBet(totalBet: number) {
    setRaiseTo(String(totalBet));
  }

  return (
    <>
      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Players" value={`${lobby.playerCount}/${lobby.maxPlayers}`} />
        <Metric label="Blinds" value={`${lobby.smallBlind}/${lobby.bigBlind}`} />
        <Metric
          label="Total Pot"
          value={tableState ? formatChips(tableState.pot.total) : "0"}
        />
        <Metric
          label="Hand"
          value={tableState ? phaseLabels[tableState.phase] : "Waiting"}
        />
      </section>

      {socketError || tableError ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950">
          {tableError ?? socketError}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="rounded-lg border border-zinc-900 bg-[radial-gradient(circle_at_top,#1f2937_0%,#09090b_52%,#030712_100%)] p-4 text-white shadow-2xl shadow-zinc-950/30 md:p-5 xl:p-6">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-normal">Table</h2>
              <p className="mt-1 text-sm text-zinc-300">
                {activeTurnName ? `${activeTurnName} to act` : "No active turn"}
              </p>
            </div>
            <span
              className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${getConnectionClasses(
                connectionStatus,
              )}`}
            >
              {connectionStatus === "connected" ? (
                <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
              ) : connectionStatus === "connecting" ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {getConnectionLabel(connectionStatus)}
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[230px_minmax(520px,1fr)_230px] lg:items-center 2xl:grid-cols-[260px_minmax(620px,1fr)_260px]">
            <SeatColumn seats={arrangedSeats.left} />

            <div className="min-w-0">
              <SeatRow seats={arrangedSeats.top} />
              <TableFelt
                handComplete={handComplete}
                tableState={tableState}
                activeTurnName={activeTurnName}
              />
              <SeatRow seats={arrangedSeats.bottom} />
            </div>

            <SeatColumn seats={arrangedSeats.right} />
          </div>
        </div>

        <div className="grid gap-4 xl:sticky xl:top-4 xl:self-start">
          <ActionPanel
            amountToCall={amountToCall}
            hasStarted={hasStarted}
            isConnected={isConnected}
            isHost={isHost}
            isLocalTurn={isLocalTurn}
            onCheckOrCall={handleCheckOrCall}
            onFold={() => emitPlayerAction("fold")}
            onQuickBet={handleQuickBet}
            onRaiseSubmit={handleRaiseSubmit}
            onStartGame={handleStartGame}
            raiseTo={raiseTo}
            quickBetTargets={quickBetTargets}
            setRaiseTo={setRaiseTo}
            tableState={tableState}
            viewer={viewer}
          />
          <ActionLogPanel events={tableState?.actionLog ?? []} />
          <HandHistoryPanel hands={tableState?.handHistory ?? []} />
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-zinc-600">{label}</p>
      <p className="mt-2 text-xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

function SeatColumn({ seats }: { seats: SeatView[] }) {
  if (seats.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4 xl:gap-5">
      {seats.map((seat) => (
        <PlayerSeat key={seat.id} seat={seat} />
      ))}
    </div>
  );
}

function SeatRow({ seats }: { seats: SeatView[] }) {
  if (seats.length === 0) {
    return null;
  }

  return (
    <div className="my-4 grid gap-3 sm:grid-cols-2 xl:my-5 xl:gap-5">
      {seats.map((seat) => (
        <PlayerSeat key={seat.id} seat={seat} />
      ))}
    </div>
  );
}

function PlayerSeat({ seat }: { seat: SeatView }) {
  const statusLabel = seat.folded
    ? "Folded"
    : seat.allIn
      ? "All-in"
      : seat.inHand
        ? "In hand"
        : "Seated";

  return (
    <div
      className={`relative rounded-lg border p-3 shadow-lg transition duration-200 ${
        seat.isTurn
          ? "animate-[active-seat-glow_1.7s_ease-in-out_infinite] border-amber-300 bg-amber-100 text-zinc-950 shadow-[0_0_28px_rgba(251,191,36,0.55)] ring-2 ring-amber-300/80"
          : seat.isRevealed
            ? "border-amber-300/70 bg-amber-950/80 text-white shadow-amber-950/30"
          : seat.isViewer
            ? "border-cyan-300/50 bg-cyan-950/70 text-white shadow-cyan-950/30"
            : "border-white/10 bg-white/[0.08] text-white"
      } ${seat.folded ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{seat.name}</p>
          <p
            className={`mt-1 text-xs ${
              seat.isTurn ? "text-zinc-700" : "text-zinc-300"
            }`}
          >
            Seat {seat.seat ?? "-"}
          </p>
        </div>
        <span
          className={`mt-1 h-2.5 w-2.5 rounded-full ${
            seat.isOnline ? "bg-emerald-400" : "bg-zinc-500"
          }`}
          title={seat.isOnline ? "Online" : "Away"}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <SeatStat label="Stack" value={formatChips(seat.stack)} isTurn={seat.isTurn} />
        <SeatStat
          label="Bet"
          value={formatChips(seat.currentBet)}
          isTurn={seat.isTurn}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-h-14 gap-1.5">
          <HoleCards seat={seat} />
        </div>
        <span
          className={`rounded-full border px-2 py-1 text-xs font-semibold ${
            seat.isTurn
              ? "border-zinc-300 bg-white/70 text-zinc-800"
              : "border-white/10 bg-black/20 text-zinc-200"
          }`}
        >
          {seat.isTurn ? "Acting" : statusLabel}
        </span>
      </div>
    </div>
  );
}

function SeatStat({
  label,
  value,
  isTurn,
}: {
  label: string;
  value: string;
  isTurn: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        isTurn ? "border-zinc-300 bg-white/70" : "border-white/10 bg-black/20"
      }`}
    >
      <p className={isTurn ? "text-zinc-600" : "text-zinc-400"}>{label}</p>
      <p className="mt-0.5 font-semibold">{value}</p>
    </div>
  );
}

function HoleCards({ seat }: { seat: SeatView }) {
  if (seat.holeCards.length > 0) {
    return (
      <>
        {seat.holeCards.map((card) => (
          <PlayingCard key={`${card.rank}${card.suit}`} card={card} compact />
        ))}
      </>
    );
  }

  if (seat.hasHiddenHoleCards) {
    return (
      <>
        <PlayingCard hidden compact />
        <PlayingCard hidden compact />
      </>
    );
  }

  return (
    <>
      <PlayingCard placeholder compact />
      <PlayingCard placeholder compact />
    </>
  );
}

function TableFelt({
  handComplete,
  tableState,
  activeTurnName,
}: {
  handComplete: PublicHandCompletePayload | null;
  tableState: PublicTableState | null;
  activeTurnName: string | null;
}) {
  const boardCards = tableState?.board ?? [];

  return (
    <div className="relative overflow-hidden rounded-[44px] border border-emerald-200/20 bg-[radial-gradient(circle_at_center,#167044_0%,#0f5136_48%,#063528_100%)] px-4 py-9 shadow-[inset_0_0_70px_rgba(0,0,0,0.45)] md:px-8 md:py-12 xl:rounded-[58px] xl:px-10 xl:py-14">
      <div className="absolute inset-5 rounded-[36px] border border-white/10 xl:inset-7 xl:rounded-[48px]" />
      {handComplete ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/65 p-4 backdrop-blur-sm">
          <div className="max-w-lg animate-[winner-pop_260ms_ease-out] rounded-lg border border-amber-200 bg-zinc-950 px-6 py-5 text-center shadow-2xl shadow-black/60">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-md bg-amber-400 text-zinc-950">
              <Trophy className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="text-xs font-semibold uppercase text-amber-200">
              Hand Complete
            </p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {getHandCompleteTitle(handComplete)}
            </p>
            <p className="mt-2 text-base font-medium text-zinc-100">
              {getHandCompleteSubtitle(handComplete)}
            </p>
          </div>
        </div>
      ) : null}
      <div className="relative z-10 flex min-h-[320px] flex-col items-center justify-center gap-7 text-center xl:min-h-[390px]">
        <div className="inline-flex items-center gap-3 rounded-lg border border-amber-200/30 bg-zinc-950/55 px-4 py-3 shadow-lg">
          <CircleDollarSign className="h-5 w-5 text-amber-200" aria-hidden="true" />
          <div className="text-left">
            <p className="text-xs font-semibold uppercase text-amber-100">
              Total Pot
            </p>
            <p className="text-2xl font-semibold text-white">
              {formatChips(tableState?.pot.total ?? 0)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-2 md:gap-3 xl:gap-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <PlayingCard
              key={index}
              card={boardCards[index]}
              placeholder={!boardCards[index]}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="rounded-full border border-white/15 bg-black/20 px-3 py-1 font-semibold text-white">
            {tableState ? phaseLabels[tableState.phase] : "Waiting"}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-3 py-1 text-zinc-200">
            <Radio className="h-3.5 w-3.5 text-amber-200" aria-hidden="true" />
            {activeTurnName ?? "No active turn"}
          </span>
        </div>
      </div>
    </div>
  );
}

function PlayingCard({
  card,
  hidden = false,
  placeholder = false,
  compact = false,
}: {
  card?: PublicCard;
  hidden?: boolean;
  placeholder?: boolean;
  compact?: boolean;
}) {
  const sizeClasses = compact
    ? "h-14 w-10 text-sm"
    : "h-20 w-14 text-base md:h-24 md:w-16 md:text-lg";

  if (hidden) {
    return (
      <div
        className={`${sizeClasses} flex shrink-0 animate-[deal-card_220ms_ease-out] items-center justify-center rounded-md border border-cyan-200/30 bg-[linear-gradient(135deg,#0f172a_0%,#0f766e_100%)] p-1 shadow-md transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:animate-none`}
      >
        <div className="h-full w-full rounded border border-white/20 bg-white/10" />
      </div>
    );
  }

  if (!card || placeholder) {
    return (
      <div
        className={`${sizeClasses} shrink-0 rounded-md border border-dashed border-white/20 bg-white/10 shadow-inner transition-colors duration-200`}
      />
    );
  }

  const isRed = card.suit === "h" || card.suit === "d";
  const rank = card.rank === "T" ? "10" : card.rank;

  return (
    <div
      className={`${sizeClasses} flex shrink-0 flex-col justify-between rounded-md border border-zinc-200 bg-white p-1.5 font-bold shadow-md ${
        isRed ? "text-rose-600" : "text-zinc-950"
      } animate-[deal-card_220ms_ease-out] transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:animate-none`}
    >
      <span className="leading-none">{rank}</span>
      <span className="self-center text-xl leading-none md:text-2xl">
        {suitSymbols[card.suit]}
      </span>
      <span className="self-end leading-none">{rank}</span>
    </div>
  );
}

function formatLogTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function getLogToneClasses(tone: PublicGameLogEntry["tone"]) {
  if (tone === "award") {
    return "border-amber-300/30 bg-amber-400/10 text-amber-100";
  }

  if (tone === "showdown") {
    return "border-cyan-300/30 bg-cyan-400/10 text-cyan-100";
  }

  if (tone === "deal") {
    return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  }

  return "border-white/10 bg-white/[0.06] text-zinc-100";
}

function ActionLogPanel({ events }: { events: PublicGameLogEntry[] }) {
  const visibleEvents = events.slice(-18);

  return (
    <aside className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-white shadow-xl shadow-zinc-950/20">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Action Log</h2>
          <p className="mt-1 text-sm text-zinc-400">Current hand</p>
        </div>
        <div className="rounded-md bg-zinc-900 p-2 text-emerald-200">
          <ScrollText className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>

      <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
        {visibleEvents.length > 0 ? (
          visibleEvents.map((event) => (
            <div
              key={event.id}
              className={`rounded-md border px-3 py-2 text-sm ${getLogToneClasses(
                event.tone,
              )}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="leading-5">{event.message}</p>
                <time className="shrink-0 text-xs text-zinc-400">
                  {formatLogTime(event.at)}
                </time>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-white/10 bg-white/[0.04] p-4 text-sm text-zinc-400">
            No actions yet
          </div>
        )}
      </div>
    </aside>
  );
}

function HandHistoryPanel({ hands }: { hands: PublicHandHistoryEntry[] }) {
  return (
    <aside className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-white shadow-xl shadow-zinc-950/20">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Hand History</h2>
          <p className="mt-1 text-sm text-zinc-400">Last 3 hands</p>
        </div>
        <div className="rounded-md bg-zinc-900 p-2 text-amber-200">
          <History className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {hands.length > 0 ? (
          hands.map((hand) => {
            const winnerText =
              hand.winners.length > 0
                ? hand.winners
                    .map((winner) => winner.name ?? "Player")
                    .join(", ")
                : "No winner";
            const handText =
              hand.winningHandDescription ?? hand.winningHandName ?? "Pot awarded";

            return (
              <div
                key={hand.handNumber}
                className="rounded-md border border-white/10 bg-white/[0.06] p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-white">Hand {hand.handNumber}</p>
                  <p className="text-xs font-semibold text-amber-200">
                    {formatChips(hand.potSize)}
                  </p>
                </div>
                <p className="mt-2 text-zinc-200">{winnerText}</p>
                <p className="mt-1 text-xs text-zinc-400">{handText}</p>
              </div>
            );
          })
        ) : (
          <div className="rounded-md border border-white/10 bg-white/[0.04] p-4 text-sm text-zinc-400">
            No completed hands yet
          </div>
        )}
      </div>
    </aside>
  );
}

function ActionPanel({
  amountToCall,
  hasStarted,
  isConnected,
  isHost,
  isLocalTurn,
  onCheckOrCall,
  onFold,
  onQuickBet,
  onRaiseSubmit,
  onStartGame,
  raiseTo,
  quickBetTargets,
  setRaiseTo,
  tableState,
  viewer,
}: {
  amountToCall: number;
  hasStarted: boolean;
  isConnected: boolean;
  isHost: boolean;
  isLocalTurn: boolean;
  onCheckOrCall: () => void;
  onFold: () => void;
  onQuickBet: (totalBet: number) => void;
  onRaiseSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStartGame: () => void;
  raiseTo: string;
  quickBetTargets: QuickBetTarget[];
  setRaiseTo: (value: string) => void;
  tableState: PublicTableState | null;
  viewer: PublicTablePlayer | null;
}) {
  const minimumRaiseTo = tableState
    ? tableState.currentBet + tableState.minRaise
    : undefined;
  const maximumRaiseTo = viewer ? viewer.currentBet + viewer.stack : undefined;
  const canRaise =
    Boolean(tableState) &&
    typeof maximumRaiseTo === "number" &&
    maximumRaiseTo > (tableState?.currentBet ?? 0);
  const inputMinimum =
    minimumRaiseTo && maximumRaiseTo
      ? Math.min(minimumRaiseTo, maximumRaiseTo)
      : minimumRaiseTo;

  return (
    <aside className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-white shadow-xl shadow-zinc-950/20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Action</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {hasStarted
              ? tableState
                ? phaseLabels[tableState.phase]
                : "Hand in progress"
              : "Waiting to start"}
          </p>
        </div>
        <div className="rounded-md bg-amber-400 p-2 text-zinc-950">
          <CircleDollarSign className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>

      {!hasStarted ? (
        <div className="mt-5">
          {isHost ? (
            <button
              type="button"
              onClick={onStartGame}
              disabled={!isConnected}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Start Game
            </button>
          ) : (
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm font-medium text-zinc-300">
              Waiting on the host
            </div>
          )}
        </div>
      ) : isLocalTurn ? (
        <div className="mt-5 space-y-3">
          {amountToCall > 0 ? (
            <button
              type="button"
              onClick={onFold}
              disabled={!isConnected}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-rose-400/30 bg-rose-500/15 px-4 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Fold
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCheckOrCall}
            disabled={!isConnected}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {amountToCall > 0 ? `Call ${formatChips(amountToCall)}` : "Check"}
          </button>
          <form onSubmit={onRaiseSubmit} className="rounded-lg border border-white/10 bg-white/[0.06] p-3">
            <label
              className="block text-sm font-medium text-zinc-200"
              htmlFor="raise-to"
            >
              Raise to
            </label>
            {quickBetTargets.length > 0 ? (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {quickBetTargets.map((target) => (
                  <button
                    key={target.label}
                    type="button"
                    onClick={() => onQuickBet(target.totalBet)}
                    className="h-9 rounded-md border border-white/10 bg-zinc-900 px-2 text-xs font-semibold text-zinc-100 transition hover:border-amber-300/70 hover:text-amber-100"
                  >
                    {target.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="mt-2 flex gap-2">
              <input
                id="raise-to"
                type="number"
                min={inputMinimum}
                max={maximumRaiseTo}
                step={1}
                value={raiseTo}
                disabled={!canRaise}
                onChange={(event) => setRaiseTo(event.target.value)}
                className="h-11 min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-900 px-3 text-sm text-white outline-none transition focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/20 disabled:cursor-not-allowed disabled:bg-zinc-900/50 disabled:text-zinc-500"
              />
              <button
                type="submit"
                disabled={!isConnected || !canRaise}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-amber-400 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
                Raise
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.06] p-4 text-sm font-medium text-zinc-300">
          {tableState?.currentTurnPlayerId ? "Waiting for action" : "Hand settled"}
        </div>
      )}

      {tableState?.pot.awards.length ? (
        <div className="mt-5 space-y-2">
          <h3 className="text-sm font-semibold text-white">Awards</h3>
          {tableState.pot.awards.map((award, index) => (
            <div
              key={`${award.amount}-${index}`}
              className="rounded-lg border border-amber-300/30 bg-amber-400/10 p-3 text-sm text-amber-100"
            >
              <p className="font-semibold">{formatChips(award.amount)} pot</p>
              {award.handDescription ? (
                <p className="mt-1 text-amber-200">{award.handDescription}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
