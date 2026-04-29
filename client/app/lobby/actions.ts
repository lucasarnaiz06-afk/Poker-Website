"use server";

import {
  createLobbyForUser,
  joinLobbyForUser,
  LobbyServiceError,
} from "@poker-platform/shared/lobbies";
import type { Session } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentSession } from "@/lib/auth/session";

function readString(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : fallback;
}

function readInteger(formData: FormData, key: string, fallback: number) {
  const value = Number(readString(formData, key));

  return Number.isInteger(value) ? value : fallback;
}

function getActionErrorMessage(error: unknown) {
  if (error instanceof LobbyServiceError) {
    return error.message;
  }

  return "Lobby request could not be completed.";
}

function redirectWithLobbyError(message: string): never {
  redirect(`/lobby?error=${encodeURIComponent(message)}`);
}

function toAuthenticatedUser(user: Session["user"]) {
  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
    image: user.image ?? null,
  };
}

export async function createLobbyAction(formData: FormData) {
  const session = await requireCurrentSession();
  let lobbyId: string;

  try {
    const visibility = readString(formData, "visibility") === "PRIVATE" ? "PRIVATE" : "PUBLIC";
    const lobby = await createLobbyForUser(toAuthenticatedUser(session.user), {
      name: readString(formData, "name"),
      visibility,
      password: readString(formData, "password"),
      smallBlind: readInteger(formData, "smallBlind", 5),
      bigBlind: readInteger(formData, "bigBlind", 10),
      minBuyIn: readInteger(formData, "minBuyIn", 200),
      maxBuyIn: readInteger(formData, "maxBuyIn", 1000),
      maxPlayers: readInteger(formData, "maxPlayers", 6),
    });

    lobbyId = lobby.id;
  } catch (error) {
    redirectWithLobbyError(getActionErrorMessage(error));
  }

  revalidatePath("/lobby");
  redirect(`/lobby/${lobbyId}`);
}

export async function joinLobbyAction(formData: FormData) {
  const session = await requireCurrentSession();
  let lobbyId: string;

  try {
    const lobby = await joinLobbyForUser(toAuthenticatedUser(session.user), {
      lobbyId: readString(formData, "lobbyId"),
      password: readString(formData, "password"),
    });

    lobbyId = lobby.id;
  } catch (error) {
    redirectWithLobbyError(getActionErrorMessage(error));
  }

  revalidatePath("/lobby");
  revalidatePath(`/lobby/${lobbyId}`);
  redirect(`/lobby/${lobbyId}`);
}
