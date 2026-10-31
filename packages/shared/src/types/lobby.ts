import type { TableSettings } from "./table-settings";

export type LobbyVisibility = "PUBLIC" | "PRIVATE";

export type LobbyStatus = "WAITING" | "ACTIVE" | "CLOSED";

export type LobbyPlayerStatus = "JOINED" | "SEATED" | "LEFT" | "KICKED";

export type LobbyPlayerSummary = {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  seatNumber: number | null;
  stack: number | null;
  status: LobbyPlayerStatus;
  joinedAt: string;
};

export type LobbySummary = {
  id: string;
  name: string;
  visibility: LobbyVisibility;
  status: LobbyStatus;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxPlayers: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  playerCount: number;
  players: LobbyPlayerSummary[];
  /** Full table settings (Lobby.settings JSON; legacy lobbies get defaults + legacy columns). */
  settings?: TableSettings;
  /** True when joining requires a password. */
  hasPassword?: boolean;
  /** Invite code for the share link. Only populated for players already in the lobby. */
  inviteCode?: string | null;
};

export type CreateLobbyInput = {
  name: string;
  visibility: LobbyVisibility;
  password?: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxPlayers: number;
};

export type JoinLobbyInput = {
  lobbyId: string;
  password?: string;
  /** Invite code from a share link; required for private tables that have one. */
  inviteCode?: string;
};
