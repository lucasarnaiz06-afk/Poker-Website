"use server";

import { prisma } from "@poker-platform/shared/db";
import {
  createGameInputSchema,
  createLobbyForUser,
  extractInviteCode,
  getUsualBigBlind,
  inviteLinkPath,
  joinLobbyForUser,
  listLobbyTables,
  LobbyServiceError,
  pickQuickSeatTable,
} from "@poker-platform/shared/lobbies";
import type { Session } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentSession } from "@/lib/auth/session";
import { closeTableOnGameServer, fetchLiveTables } from "@/lib/game-server";

export type CreateGameState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: Record<string, string> }
  | { status: "created"; lobbyId: string; invitePath: string | null; name: string };

export type JoinTableState = { error: string | null };

const MAX_PAYLOAD_LENGTH = 8_000;

function readString(formData: FormData, key: string, maxLength = 256) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function toAuthenticatedUser(user: Session["user"]) {
  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
    image: user.image ?? null,
  };
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof LobbyServiceError) {
    return error.message;
  }

  console.error("[lobby] action failed", error);

  return fallback;
}

export async function createGameAction(_previous: CreateGameState, formData: FormData): Promise<CreateGameState> {
  const session = await requireCurrentSession();
  const rawPayload = formData.get("payload");

  if (typeof rawPayload !== "string" || rawPayload.length > MAX_PAYLOAD_LENGTH) {
    return { status: "error", message: "Game settings are missing.", fieldErrors: {} };
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return { status: "error", message: "Game settings are invalid.", fieldErrors: {} };
  }

  const parsed = createGameInputSchema.safeParse(payload);

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};

    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join(".");

      fieldErrors[key] ??= issue.message;
    }

    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors };
  }

  let created: { id: string; inviteCode: string | null };

  try {
    const lobby = await createLobbyForUser(toAuthenticatedUser(session.user), parsed.data);

    created = { id: lobby.id, inviteCode: lobby.inviteCode ?? null };
  } catch (error) {
    return {
      status: "error",
      message: errorMessage(error, "The game could not be created. Try again."),
      fieldErrors: {},
    };
  }

  revalidatePath("/lobby");

  if (parsed.data.visibility === "PRIVATE") {
    return {
      status: "created",
      lobbyId: created.id,
      invitePath: created.inviteCode ? inviteLinkPath(created.inviteCode) : null,
      name: parsed.data.name,
    };
  }

  redirect(`/lobby/${created.id}`);
}

/** Join by table id (public list) or invite code (private link), with optional password. */
export async function joinTableAction(_previous: JoinTableState, formData: FormData): Promise<JoinTableState> {
  const session = await requireCurrentSession();
  let lobbyId: string;

  try {
    const lobby = await joinLobbyForUser(toAuthenticatedUser(session.user), {
      lobbyId: readString(formData, "lobbyId", 64),
      inviteCode: readString(formData, "inviteCode", 32) || undefined,
      password: readString(formData, "password", 128),
    });

    lobbyId = lobby.id;
  } catch (error) {
    return { error: errorMessage(error, "Couldn't join that table. Try again.") };
  }

  revalidatePath("/lobby");
  redirect(`/lobby/${lobbyId}`);
}

/** "Join with code": accepts a code or a pasted invite link and opens the invite page. */
export async function openInviteAction(_previous: JoinTableState, formData: FormData): Promise<JoinTableState> {
  await requireCurrentSession();
  const code = extractInviteCode(readString(formData, "code", 512));

  if (!code) {
    return { error: "That doesn't look like an invite code or link." };
  }

  redirect(inviteLinkPath(code));
}

export type CloseTableResult = { ok: true } | { ok: false; message: string };

/**
 * Host closes one of their tables from the lobby. Goes through the game server (never straight to the DB) so
 * any hand in progress is voided and every stack is refunded to its wallet first.
 */
export async function closeTableAction(tableId: string): Promise<CloseTableResult> {
  await requireCurrentSession();

  if (typeof tableId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(tableId)) {
    return { ok: false, message: "Table not found." };
  }

  const result = await closeTableOnGameServer(tableId);

  revalidatePath("/lobby");

  if (!result.ok) {
    // Already closed (e.g. from another tab): the lobby just refreshes.
    return result.code === "TABLE_NOT_FOUND" ? { ok: true } : { ok: false, message: result.message };
  }

  return { ok: true };
}

export type QuickSeatState = { error: string | null };

/**
 * "Play now": opens the best-filled public table with a free seat at the player's usual stakes (lowest stakes
 * without history) and asks the table to open the buy-in dialog (`?sit=1`, default 100 BB or what they have).
 */
export async function quickSeatAction(_previous: QuickSeatState, _formData: FormData): Promise<QuickSeatState> {
  const session = await requireCurrentSession();
  const [live, usualBigBlind, user] = await Promise.all([
    fetchLiveTables(),
    getUsualBigBlind(session.user.id),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { chipBalance: true } }),
  ]);
  // Live counts from the game server; the lobby's own list if it can't be reached.
  const tables = live ?? (await listLobbyTables());
  const table = pickQuickSeatTable(tables, { usualBigBlind, balance: user?.chipBalance ?? 0 });

  if (!table) {
    return {
      error:
        tables.length === 0
          ? "No public tables are open right now. Create one and invite friends."
          : "No open seat you can afford right now. Create a table, or claim your daily bonus.",
    };
  }

  redirect(`/lobby/${table.tableId}?sit=1`);
}
