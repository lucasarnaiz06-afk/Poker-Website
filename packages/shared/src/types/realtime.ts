import type { LobbySummary } from "./lobby";

export type LobbyPresencePayload = {
  lobby: LobbySummary;
  onlineUserIds: string[];
  updatedAt: string;
};

export type PublicChatMessagePayload = {
  id: string;
  lobbyId: string;
  playerId: string;
  playerName: string;
  message: string | null;
  emoteId: string | null;
  emoteSrc: string | null;
  sentAt: string;
};
