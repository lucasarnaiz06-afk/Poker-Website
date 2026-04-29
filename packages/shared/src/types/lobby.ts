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
};
