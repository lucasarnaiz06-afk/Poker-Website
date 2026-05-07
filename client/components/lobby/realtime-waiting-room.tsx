"use client";

import type {
  LobbyPresencePayload,
  LobbySummary,
} from "@poker-platform/shared/types";
import { LoaderCircle, Users, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";

type ServerToClientEvents = {
  presence_update: (payload: LobbyPresencePayload) => void;
  lobby_error: (payload: { message: string }) => void;
};

type ClientToServerEvents = {
  join_lobby: (payload: { lobbyId: string }) => void;
  leave_lobby: (payload: { lobbyId: string }) => void;
};

type ConnectionStatus = "connecting" | "connected" | "disconnected";

type RealtimeWaitingRoomProps = {
  initialLobby: LobbySummary;
  currentUserId: string;
};

function getSocketUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  return null;
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
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "connecting") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

export function RealtimeWaitingRoom({
  initialLobby,
  currentUserId,
}: RealtimeWaitingRoomProps) {
  const [lobby, setLobby] = useState(initialLobby);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [socketError, setSocketError] = useState<string | null>(null);
  const onlineUsers = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);

  useEffect(() => {
    const socketUrl = getSocketUrl();
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> =
      socketUrl
        ? io(socketUrl, {
            autoConnect: false,
            withCredentials: true,
          })
        : io({
            autoConnect: false,
            withCredentials: true,
          });

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

    socket.on("presence_update", (payload) => {
      if (payload.lobby.id !== initialLobby.id) {
        return;
      }

      setLobby(payload.lobby);
      setOnlineUserIds(payload.onlineUserIds);
    });

    socket.connect();

    return () => {
      socket.emit("leave_lobby", { lobbyId: initialLobby.id });
      socket.disconnect();
    };
  }, [initialLobby.id]);

  return (
    <>
      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Players" value={`${lobby.playerCount}/${lobby.maxPlayers}`} />
        <Metric label="Blinds" value={`${lobby.smallBlind}/${lobby.bigBlind}`} />
        <Metric label="Min buy-in" value={String(lobby.minBuyIn)} />
        <Metric label="Max buy-in" value={String(lobby.maxBuyIn)} />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-zinc-950">Waiting Room</h2>
            <Users className="h-5 w-5 text-zinc-500" aria-hidden="true" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {socketError ? (
              <span className="text-sm font-medium text-amber-800">{socketError}</span>
            ) : null}
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${getConnectionClasses(
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
        </div>
        <div className="divide-y divide-zinc-200">
          {lobby.players.map((player) => {
            const isOnline =
              onlineUsers.has(player.userId) ||
              (player.userId === currentUserId &&
                connectionStatus === "connected");

            return (
              <div
                key={player.id}
                className="grid gap-3 px-5 py-4 md:grid-cols-[80px_minmax(0,1fr)_120px_96px] md:items-center"
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
                <div
                  className={`inline-flex w-fit items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                    isOnline
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-zinc-200 bg-zinc-50 text-zinc-600"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isOnline ? "bg-emerald-600" : "bg-zinc-400"
                    }`}
                  />
                  {isOnline ? "Online" : "Away"}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
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
