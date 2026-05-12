"use client";

import type {
  LobbyPresencePayload,
  LobbySummary,
  PublicCard,
  PublicChatMessagePayload,
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
  History,
  LoaderCircle,
  Play,
  Radio,
  ScrollText,
  Smile,
  Trophy,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import Image from "next/image";
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
  receive_chat_message: (payload: PublicChatMessagePayload) => void;
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
  send_chat_message: (payload: {
    lobbyId: string;
    message?: string;
    emoteId?: string;
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
const CARD_BACK_SRC = "/cards/Blue_Backside.png";
const CARD_PLACEHOLDER_SRC = "/cards/Grey_Blank.png";
const EMOTE_IDS = Array.from({ length: 52 }, (_, index) => String(index + 1));

const phaseLabels: Record<PublicTableState["phase"], string> = {
  NOT_STARTED: "Not started",
  PRE_FLOP: "Pre-flop",
  FLOP: "Flop",
  TURN: "Turn",
  RIVER: "River",
  SHOWDOWN: "Showdown",
  COMPLETE: "Complete",
};

function formatChips(value: number) {
  return chipFormatter.format(value);
}

function getCardImageSrc(card: PublicCard) {
  const rank = card.rank === "T" ? "10" : card.rank;

  return `/cards/${rank}${card.suit.toUpperCase()}.png`;
}

function getCardAltText(card: PublicCard) {
  const rank = card.rank === "T" ? "10" : card.rank;

  return `${rank}${card.suit.toUpperCase()}`;
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

  return handDescription ?? "Pot awarded";
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
    return "border-[#7cff6b] bg-[#173f1f] text-[#7cff6b]";
  }

  if (status === "connecting") {
    return "border-[#ffd166] bg-[#4a3517] text-[#ffd166]";
  }

  return "border-[#f87171] bg-[#451a1a] text-[#fca5a5]";
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
  const [chatMessages, setChatMessages] = useState<PublicChatMessagePayload[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [isEmotePickerOpen, setIsEmotePickerOpen] = useState(false);

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

    socket.on("receive_chat_message", (payload) => {
      if (payload.lobbyId !== initialLobby.id) {
        return;
      }

      setChatMessages((currentMessages) =>
        [...currentMessages, payload].slice(-60),
      );
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

  function emitChatMessage(payload: { message?: string; emoteId?: string }) {
    if (!socketRef.current || !isConnected) {
      setSocketError("The table is not connected.");
      return;
    }

    socketRef.current.emit("send_chat_message", {
      lobbyId: lobby.id,
      ...payload,
    });
  }

  function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = chatDraft.trim();

    if (!message) {
      return;
    }

    emitChatMessage({ message });
    setChatDraft("");
  }

  function handleSendEmote(emoteId: string) {
    emitChatMessage({ emoteId });
    setIsEmotePickerOpen(false);
  }

  return (
    <>
      <section className="grid gap-3 md:grid-cols-4">
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
        <div className="border-4 border-[#ffd166] bg-[#4a3517] px-4 py-3 text-[10px] font-medium text-[#ffd166]">
          {tableError ?? socketError}
        </div>
      ) : null}

      <section className="grid min-h-[calc(100vh-260px)] items-center gap-5 xl:grid-cols-[minmax(900px,1fr)_380px] 2xl:grid-cols-[minmax(1050px,1fr)_400px]">
        <div className="w-full justify-self-center border-4 border-[#f8f8f2] bg-[#111827] p-4 text-[#f8f8f2] md:p-5 xl:max-w-[1380px] xl:p-6 2xl:max-w-[1520px]">
          <div className="mb-5 flex flex-col gap-3 border-b-4 border-[#f8f8f2] pb-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-normal md:text-base">
                Pixel Poker
              </h2>
              <p className="mt-2 text-[10px] text-[#a3e635]">
                {activeTurnName ? `${activeTurnName} to act` : "No active turn"}
              </p>
            </div>
            <span
              className={`inline-flex w-fit items-center gap-2 border-2 px-3 py-2 text-[10px] font-semibold ${getConnectionClasses(
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

          <div className="grid gap-5 lg:grid-cols-[230px_minmax(620px,1fr)_230px] lg:items-center xl:gap-6 2xl:grid-cols-[260px_minmax(760px,1fr)_260px]">
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
          <ActionLogPanel
            chatDraft={chatDraft}
            chatMessages={chatMessages}
            events={tableState?.actionLog ?? []}
            isConnected={isConnected}
            isEmotePickerOpen={isEmotePickerOpen}
            onChatDraftChange={setChatDraft}
            onChatSubmit={handleChatSubmit}
            onSendEmote={handleSendEmote}
            onToggleEmotePicker={() =>
              setIsEmotePickerOpen((isOpen) => !isOpen)
            }
          />
          <HandHistoryPanel hands={tableState?.handHistory ?? []} />
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-4 border-[#f8f8f2] bg-[#111827] p-3 text-[#f8f8f2]">
      <p className="text-[9px] text-[#9ca3af]">{label}</p>
      <p className="mt-2 text-xs font-semibold text-[#f8f8f2] md:text-sm">
        {value}
      </p>
    </div>
  );
}

function SeatColumn({ seats }: { seats: SeatView[] }) {
  if (seats.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4 xl:gap-6">
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
    <div className="my-5 grid gap-4 sm:grid-cols-2 xl:my-6 xl:gap-6">
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
      className={`relative border-4 p-3 ${
        seat.isTurn
          ? "border-[#ffd166] bg-[#ffd166] text-[#0b1020] outline outline-4 outline-offset-4 outline-[#ff3864]"
          : seat.isRevealed
            ? "border-[#ffd166] bg-[#5a3e1b] text-[#f8f8f2]"
          : seat.isViewer
            ? "border-[#29adff] bg-[#1d2b53] text-[#f8f8f2]"
            : "border-[#f8f8f2] bg-[#111827] text-[#f8f8f2]"
      } ${seat.folded ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{seat.name}</p>
          <p
            className={`mt-2 text-[9px] ${
              seat.isTurn ? "text-[#1f2937]" : "text-[#9ca3af]"
            }`}
          >
            Seat {seat.seat ?? "-"}
          </p>
        </div>
        <span
          className={`mt-1 h-3 w-3 border-2 border-[#0b1020] ${
            seat.isOnline ? "bg-[#7cff6b]" : "bg-[#6b7280]"
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
          className={`border-2 px-2 py-1 text-[9px] font-semibold ${
            seat.isTurn
              ? "border-[#0b1020] bg-[#f8f8f2] text-[#0b1020]"
              : "border-[#f8f8f2] bg-[#0b1020] text-[#f8f8f2]"
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
      className={`border-2 px-2 py-1.5 ${
        isTurn ? "border-[#0b1020] bg-[#f8f8f2]" : "border-[#f8f8f2] bg-[#0b1020]"
      }`}
    >
      <p className={isTurn ? "text-[#374151]" : "text-[#9ca3af]"}>{label}</p>
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
    <div className="relative overflow-hidden border-4 border-[#f8f8f2] bg-[#0f7f3f] px-4 py-10 md:px-8 md:py-14 xl:px-12 xl:py-16">
      <div className="absolute inset-5 border-4 border-[#0b1020] xl:inset-7" />
      {handComplete ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0b1020]/90 p-4">
          <div className="max-w-2xl animate-[winner-pop_160ms_steps(2,end)] border-4 border-[#ffd166] bg-[#111827] px-6 py-5 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center border-4 border-[#0b1020] bg-[#ffd166] text-[#0b1020]">
              <Trophy className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="text-[10px] font-semibold uppercase text-[#ffd166]">
              Hand Complete
            </p>
            <p className="mt-4 text-sm font-semibold text-[#f8f8f2] md:text-base">
              {getHandCompleteTitle(handComplete)}
            </p>
            <p className="mt-4 border-2 border-[#f8f8f2] bg-[#0b1020] px-3 py-2 text-[10px] font-medium leading-5 text-[#a3e635]">
              HAND: {getHandCompleteSubtitle(handComplete)}
            </p>
          </div>
        </div>
      ) : null}
      <div className="relative z-10 flex min-h-[360px] flex-col items-center justify-center gap-8 text-center xl:min-h-[520px]">
        <div className="inline-flex items-center gap-3 border-4 border-[#0b1020] bg-[#ffd166] px-5 py-4 text-[#0b1020]">
          <span className="border-2 border-[#0b1020] bg-[#f8f8f2] px-2 py-1 text-[10px]">
            CHIP
          </span>
          <div className="text-left">
            <p className="text-[9px] font-semibold uppercase">
              Total Pot
            </p>
            <p className="mt-1 text-sm font-semibold md:text-base">
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

        <div className="flex flex-wrap items-center justify-center gap-2 text-[10px]">
          <span className="border-2 border-[#0b1020] bg-[#f8f8f2] px-3 py-2 font-semibold text-[#0b1020]">
            {tableState ? phaseLabels[tableState.phase] : "Waiting"}
          </span>
          <span className="inline-flex items-center gap-2 border-2 border-[#0b1020] bg-[#111827] px-3 py-2 text-[#f8f8f2]">
            <Radio className="h-3.5 w-3.5 text-[#ffd166]" aria-hidden="true" />
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
    ? "h-16 w-11 text-[10px]"
    : "h-24 w-16 text-xs md:h-28 md:w-20 md:text-sm";

  if (hidden) {
    return (
      <div
        className={`${sizeClasses} flex shrink-0 animate-[deal-card_120ms_steps(2,end)] items-center justify-center border-4 border-[#f8f8f2] bg-[#1d2b53] p-1 motion-reduce:animate-none`}
      >
        <Image
          src={CARD_BACK_SRC}
          alt="Face-down card"
          width={80}
          height={112}
          unoptimized
          className="h-full w-full object-contain"
        />
      </div>
    );
  }

  if (!card || placeholder) {
    return (
      <div
        className={`${sizeClasses} shrink-0 border-4 border-dashed border-[#0b1020] bg-[#4b5563] p-1`}
      >
        <Image
          src={CARD_PLACEHOLDER_SRC}
          alt="Empty card slot"
          width={80}
          height={112}
          unoptimized
          className="h-full w-full object-contain opacity-60"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClasses} flex shrink-0 animate-[deal-card_120ms_steps(2,end)] items-center justify-center border-4 border-[#0b1020] bg-[#f8f8f2] p-1 motion-reduce:animate-none`}
    >
      <Image
        src={getCardImageSrc(card)}
        alt={getCardAltText(card)}
        width={80}
        height={112}
        unoptimized
        className="h-full w-full object-contain"
      />
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
    return "border-[#ffd166] bg-[#4a3517] text-[#ffd166]";
  }

  if (tone === "showdown") {
    return "border-[#29adff] bg-[#1d2b53] text-[#29adff]";
  }

  if (tone === "deal") {
    return "border-[#7cff6b] bg-[#173f1f] text-[#7cff6b]";
  }

  return "border-[#f8f8f2] bg-[#111827] text-[#f8f8f2]";
}

type LogListItem =
  | {
      id: string;
      at: string;
      kind: "event";
      message: string;
      tone: PublicGameLogEntry["tone"];
    }
  | {
      id: string;
      at: string;
      kind: "chat";
      message: string | null;
      playerName: string;
      emoteSrc: string | null;
    };

function ActionLogPanel({
  chatDraft,
  chatMessages,
  events,
  isConnected,
  isEmotePickerOpen,
  onChatDraftChange,
  onChatSubmit,
  onSendEmote,
  onToggleEmotePicker,
}: {
  chatDraft: string;
  chatMessages: PublicChatMessagePayload[];
  events: PublicGameLogEntry[];
  isConnected: boolean;
  isEmotePickerOpen: boolean;
  onChatDraftChange: (value: string) => void;
  onChatSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSendEmote: (emoteId: string) => void;
  onToggleEmotePicker: () => void;
}) {
  const visibleEvents: LogListItem[] = [
    ...events.map((event) => ({
      id: event.id,
      at: event.at,
      kind: "event" as const,
      message: event.message,
      tone: event.tone,
    })),
    ...chatMessages.map((message) => ({
      id: message.id,
      at: message.sentAt,
      kind: "chat" as const,
      message: message.message,
      playerName: message.playerName,
      emoteSrc: message.emoteSrc,
    })),
  ]
    .sort((left, right) => left.at.localeCompare(right.at))
    .slice(-24);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const latestEventId = visibleEvents.at(-1)?.id;

  useEffect(() => {
    const logElement = logScrollRef.current;

    if (!logElement) {
      return;
    }

    logElement.scrollTop = logElement.scrollHeight;
  }, [latestEventId]);

  return (
    <aside className="border-4 border-[#f8f8f2] bg-[#111827] p-4 text-[#f8f8f2]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold">Action Log</h2>
          <p className="mt-2 text-[9px] text-[#9ca3af]">Current hand</p>
        </div>
        <div className="border-2 border-[#7cff6b] bg-[#173f1f] p-2 text-[#7cff6b]">
          <ScrollText className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>

      <div
        ref={logScrollRef}
        className="mt-4 max-h-72 space-y-2 overflow-y-auto border-2 border-[#0b1020] bg-[#0b1020] p-2"
      >
        {visibleEvents.length > 0 ? (
          visibleEvents.map((event) => {
            if (event.kind === "chat") {
              return (
                <div
                  key={event.id}
                  className="border-2 border-[#ff77a8] bg-[#3b1f3f] px-3 py-2 text-[9px] leading-5 text-[#ffd6e8]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p>
                        [{event.playerName}]: {event.message ?? ""}
                      </p>
                      {event.emoteSrc ? (
                        <Image
                          src={event.emoteSrc}
                          alt={`${event.playerName} emote`}
                          width={40}
                          height={40}
                          unoptimized
                          className="mt-2 h-10 w-10 border-2 border-[#f8f8f2] bg-[#0b1020] object-contain"
                        />
                      ) : null}
                    </div>
                    <time className="shrink-0 text-[8px] text-[#9ca3af]">
                      {formatLogTime(event.at)}
                    </time>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={event.id}
                className={`border-2 px-3 py-2 text-[9px] leading-5 ${getLogToneClasses(
                  event.tone,
                )}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="leading-5">{event.message}</p>
                  <time className="shrink-0 text-[8px] text-[#9ca3af]">
                    {formatLogTime(event.at)}
                  </time>
                </div>
              </div>
            );
          })
        ) : (
          <div className="border-2 border-[#f8f8f2] bg-[#111827] p-4 text-[10px] text-[#9ca3af]">
            No actions yet
          </div>
        )}
      </div>

      <form onSubmit={onChatSubmit} className="mt-3 flex gap-2">
        <input
          aria-label="Chat message"
          maxLength={180}
          value={chatDraft}
          onChange={(event) => onChatDraftChange(event.target.value)}
          className="h-11 min-w-0 flex-1 border-4 border-[#f8f8f2] bg-[#0b1020] px-3 text-[9px] text-[#f8f8f2] outline-none focus:border-[#ff77a8]"
          placeholder="CHAT..."
        />
        <button
          type="button"
          onClick={onToggleEmotePicker}
          className="inline-flex h-11 w-12 items-center justify-center border-4 border-[#ff77a8] bg-[#3b1f3f] text-[#ffd6e8] hover:bg-[#ff77a8] hover:text-[#0b1020]"
          aria-label="Open emotes"
        >
          <Smile className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="submit"
          disabled={!isConnected || chatDraft.trim().length === 0}
          className="h-11 border-4 border-[#7cff6b] bg-[#173f1f] px-3 text-[9px] font-semibold text-[#7cff6b] hover:bg-[#7cff6b] hover:text-[#0b1020] disabled:cursor-not-allowed disabled:border-[#4b5563] disabled:bg-[#1f2937] disabled:text-[#6b7280]"
        >
          Send
        </button>
      </form>

      {isEmotePickerOpen ? (
        <div className="mt-3 grid max-h-44 grid-cols-6 gap-2 overflow-y-auto border-4 border-[#ff77a8] bg-[#0b1020] p-2">
          {EMOTE_IDS.map((emoteId) => (
            <button
              key={emoteId}
              type="button"
              onClick={() => onSendEmote(emoteId)}
              disabled={!isConnected}
              className="flex h-12 items-center justify-center border-2 border-[#f8f8f2] bg-[#111827] p-1 hover:bg-[#ff77a8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Image
                src={`/emotes/${emoteId}.png`}
                alt={`Emote ${emoteId}`}
                width={32}
                height={32}
                unoptimized
                className="h-8 w-8 object-contain"
              />
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function HandHistoryPanel({ hands }: { hands: PublicHandHistoryEntry[] }) {
  return (
    <aside className="border-4 border-[#f8f8f2] bg-[#111827] p-4 text-[#f8f8f2]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold">Hand History</h2>
          <p className="mt-2 text-[9px] text-[#9ca3af]">Last 3 hands</p>
        </div>
        <div className="border-2 border-[#ffd166] bg-[#4a3517] p-2 text-[#ffd166]">
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
                className="border-2 border-[#f8f8f2] bg-[#0b1020] p-3 text-[10px]"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-[#f8f8f2]">Hand {hand.handNumber}</p>
                  <p className="text-[9px] font-semibold text-[#ffd166]">
                    {formatChips(hand.potSize)}
                  </p>
                </div>
                <p className="mt-2 text-[#f8f8f2]">{winnerText}</p>
                <p className="mt-2 text-[9px] leading-4 text-[#a3e635]">{handText}</p>
              </div>
            );
          })
        ) : (
          <div className="border-2 border-[#f8f8f2] bg-[#0b1020] p-4 text-[10px] text-[#9ca3af]">
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
    <aside className="border-4 border-[#f8f8f2] bg-[#111827] p-4 text-[#f8f8f2]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold text-[#f8f8f2]">Action</h2>
          <p className="mt-2 text-[9px] text-[#9ca3af]">
            {hasStarted
              ? tableState
                ? phaseLabels[tableState.phase]
                : "Hand in progress"
              : "Waiting to start"}
          </p>
        </div>
        <div className="border-2 border-[#0b1020] bg-[#ffd166] px-2 py-2 text-[9px] text-[#0b1020]">
          CHIP
        </div>
      </div>

      {!hasStarted ? (
        <div className="mt-5">
          {isHost ? (
            <button
              type="button"
              onClick={onStartGame}
              disabled={!isConnected}
              className="inline-flex h-12 w-full items-center justify-center gap-2 border-4 border-[#f8f8f2] bg-[#0f7f3f] px-4 text-[10px] font-semibold text-[#f8f8f2] hover:bg-[#7cff6b] hover:text-[#0b1020] disabled:cursor-not-allowed disabled:bg-[#4b5563] disabled:text-[#9ca3af]"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Start Game
            </button>
          ) : (
            <div className="border-2 border-[#f8f8f2] bg-[#0b1020] p-4 text-[10px] font-medium text-[#9ca3af]">
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
              className="inline-flex h-12 w-full items-center justify-center gap-2 border-4 border-[#ff3864] bg-[#451a1a] px-4 text-[10px] font-semibold text-[#fca5a5] hover:bg-[#ff3864] hover:text-[#0b1020] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Fold
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCheckOrCall}
            disabled={!isConnected}
            className="inline-flex h-12 w-full items-center justify-center gap-2 border-4 border-[#7cff6b] bg-[#173f1f] px-4 text-[10px] font-semibold text-[#7cff6b] hover:bg-[#7cff6b] hover:text-[#0b1020] disabled:cursor-not-allowed disabled:bg-[#4b5563] disabled:text-[#9ca3af]"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {amountToCall > 0 ? `Call ${formatChips(amountToCall)}` : "Check"}
          </button>
          <form onSubmit={onRaiseSubmit} className="border-4 border-[#f8f8f2] bg-[#0b1020] p-3">
            <label
              className="block text-[10px] font-medium text-[#f8f8f2]"
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
                    className="h-10 border-2 border-[#ffd166] bg-[#4a3517] px-2 text-[8px] font-semibold text-[#ffd166] hover:bg-[#ffd166] hover:text-[#0b1020]"
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
                className="h-12 min-w-0 flex-1 border-4 border-[#f8f8f2] bg-[#111827] px-3 text-[10px] text-[#f8f8f2] outline-none focus:border-[#ffd166] disabled:cursor-not-allowed disabled:border-[#4b5563] disabled:bg-[#1f2937] disabled:text-[#6b7280]"
              />
              <button
                type="submit"
                disabled={!isConnected || !canRaise}
                className="inline-flex h-12 items-center justify-center gap-2 border-4 border-[#ffd166] bg-[#4a3517] px-4 text-[10px] font-semibold text-[#ffd166] hover:bg-[#ffd166] hover:text-[#0b1020] disabled:cursor-not-allowed disabled:border-[#4b5563] disabled:bg-[#1f2937] disabled:text-[#6b7280]"
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
                Raise
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="mt-5 border-2 border-[#f8f8f2] bg-[#0b1020] p-4 text-[10px] font-medium text-[#9ca3af]">
          {tableState?.currentTurnPlayerId ? "Waiting for action" : "Hand settled"}
        </div>
      )}

      {tableState?.pot.awards.length ? (
        <div className="mt-5 space-y-2">
          <h3 className="text-[10px] font-semibold text-[#f8f8f2]">Awards</h3>
          {tableState.pot.awards.map((award, index) => (
            <div
              key={`${award.amount}-${index}`}
              className="border-2 border-[#ffd166] bg-[#4a3517] p-3 text-[10px] text-[#ffd166]"
            >
              <p className="font-semibold">{formatChips(award.amount)} pot</p>
              {award.handDescription ? (
                <p className="mt-2 leading-4 text-[#f8f8f2]">{award.handDescription}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
