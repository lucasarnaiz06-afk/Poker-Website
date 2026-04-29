import type { Server as HttpServer } from "node:http";
import type { AuthenticatedSession } from "@poker-platform/shared/auth";
import {
  getLobbySummary,
  getWaitingRoomLobbyForUser,
  LobbyServiceError,
} from "@poker-platform/shared/lobbies";
import type { LobbyPresencePayload } from "@poker-platform/shared/types";
import { Server, type Socket } from "socket.io";
import { isCorsOriginAllowed } from "../http/cors";
import { authenticateCookieHeader } from "../security/session";

type ClientToServerEvents = {
  join_lobby: (payload: { lobbyId?: string }) => void;
  leave_lobby: (payload: { lobbyId?: string }) => void;
};

type ServerToClientEvents = {
  presence_update: (payload: LobbyPresencePayload) => void;
  lobby_error: (payload: { message: string }) => void;
};

type InterServerEvents = Record<string, never>;

type SocketData = {
  session: AuthenticatedSession;
  lobbyIds: Set<string>;
};

type LobbySocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type LobbyServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

const presenceByLobby = new Map<string, Map<string, number>>();

function getRoomName(lobbyId: string) {
  return `lobby:${lobbyId}`;
}

function readLobbyId(payload: { lobbyId?: string }) {
  return typeof payload.lobbyId === "string" ? payload.lobbyId.trim() : "";
}

function addPresence(lobbyId: string, userId: string) {
  const lobbyPresence = presenceByLobby.get(lobbyId) ?? new Map<string, number>();
  const currentCount = lobbyPresence.get(userId) ?? 0;

  lobbyPresence.set(userId, currentCount + 1);
  presenceByLobby.set(lobbyId, lobbyPresence);
}

function removePresence(lobbyId: string, userId: string) {
  const lobbyPresence = presenceByLobby.get(lobbyId);

  if (!lobbyPresence) {
    return;
  }

  const nextCount = (lobbyPresence.get(userId) ?? 1) - 1;

  if (nextCount > 0) {
    lobbyPresence.set(userId, nextCount);
    return;
  }

  lobbyPresence.delete(userId);

  if (lobbyPresence.size === 0) {
    presenceByLobby.delete(lobbyId);
  }
}

function getOnlineUserIds(lobbyId: string) {
  return [...(presenceByLobby.get(lobbyId)?.keys() ?? [])];
}

async function emitPresenceUpdate(io: LobbyServer, lobbyId: string) {
  const lobby = await getLobbySummary(lobbyId);

  if (!lobby) {
    return;
  }

  const playerUserIds = new Set(lobby.players.map((player) => player.userId));
  const onlineUserIds = getOnlineUserIds(lobbyId).filter((userId) =>
    playerUserIds.has(userId),
  );

  io.to(getRoomName(lobbyId)).emit("presence_update", {
    lobby,
    onlineUserIds,
    updatedAt: new Date().toISOString(),
  });
}

function leaveLobby(socket: LobbySocket, lobbyId: string) {
  if (!socket.data.lobbyIds.has(lobbyId)) {
    return false;
  }

  socket.leave(getRoomName(lobbyId));
  socket.data.lobbyIds.delete(lobbyId);
  removePresence(lobbyId, socket.data.session.user.id);

  return true;
}

function logPresenceError(error: unknown) {
  console.error("Realtime presence update failed", error);
}

export function createSocketServer(httpServer: HttpServer) {
  const io: LobbyServer = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        callback(null, isCorsOriginAllowed(origin));
      },
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const session = await authenticateCookieHeader(socket.handshake.headers.cookie);

      if (!session) {
        next(new Error("Unauthorized"));
        return;
      }

      socket.data.session = session;
      socket.data.lobbyIds = new Set<string>();
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("join_lobby", async (payload) => {
      const lobbyId = readLobbyId(payload);

      if (!lobbyId) {
        socket.emit("lobby_error", { message: "Lobby ID is required." });
        return;
      }

      try {
        await getWaitingRoomLobbyForUser(lobbyId, socket.data.session.user.id);

        if (!socket.data.lobbyIds.has(lobbyId)) {
          socket.data.lobbyIds.add(lobbyId);
          addPresence(lobbyId, socket.data.session.user.id);
          socket.join(getRoomName(lobbyId));
        }

        await emitPresenceUpdate(io, lobbyId);
      } catch (error) {
        const message =
          error instanceof LobbyServiceError
            ? error.message
            : "Realtime lobby connection failed.";

        socket.emit("lobby_error", { message });
      }
    });

    socket.on("leave_lobby", (payload) => {
      const lobbyId = readLobbyId(payload);

      if (!lobbyId || !leaveLobby(socket, lobbyId)) {
        return;
      }

      void emitPresenceUpdate(io, lobbyId).catch(logPresenceError);
    });

    socket.on("disconnect", () => {
      const lobbyIds = [...socket.data.lobbyIds];

      for (const lobbyId of lobbyIds) {
        leaveLobby(socket, lobbyId);
        void emitPresenceUpdate(io, lobbyId).catch(logPresenceError);
      }
    });
  });

  return io;
}
