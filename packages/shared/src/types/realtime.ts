import type { LobbySummary } from "./lobby";

export type LobbyPresencePayload = {
  lobby: LobbySummary;
  onlineUserIds: string[];
  updatedAt: string;
};
