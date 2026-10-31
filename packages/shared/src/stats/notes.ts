// Private player notes + colour tags (PlayerNote). Only ever read by their owner.
import { z } from "zod";
import { prisma } from "../db/prisma";
import { NOTE_COLORS, type NoteColor, type PlayerNoteView } from "./definitions";

export type { PlayerNoteView };

export const NOTE_MAX_LENGTH = 1000;

export const playerNoteInputSchema = z
  .object({
    subjectId: z.string().min(1).max(64),
    text: z.string().max(NOTE_MAX_LENGTH),
    color: z.enum(NOTE_COLORS),
  })
  .strict();

export type PlayerNoteInput = z.infer<typeof playerNoteInputSchema>;


export class NoteError extends Error {
  constructor(
    readonly code: "INVALID" | "SELF" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "NoteError";
  }
}

function toView(subjectId: string, note: { text: string; color: string; updatedAt: Date } | null): PlayerNoteView {
  const color = (NOTE_COLORS as readonly string[]).includes(note?.color ?? "") ? (note!.color as NoteColor) : "none";
  return { subjectId, text: note?.text ?? "", color, updatedAt: note?.updatedAt.toISOString() ?? null };
}

export async function getPlayerNote(ownerId: string, subjectId: string): Promise<PlayerNoteView> {
  const note = await prisma.playerNote.findUnique({
    where: { ownerId_subjectId: { ownerId, subjectId } },
    select: { text: true, color: true, updatedAt: true },
  });
  return toView(subjectId, note);
}

export async function getPlayerNotes(ownerId: string, subjectIds: readonly string[]): Promise<Map<string, PlayerNoteView>> {
  if (subjectIds.length === 0) return new Map();
  const notes = await prisma.playerNote.findMany({
    where: { ownerId, subjectId: { in: [...subjectIds] } },
    select: { subjectId: true, text: true, color: true, updatedAt: true },
  });
  return new Map(notes.map((n) => [n.subjectId, toView(n.subjectId, n)]));
}

/** Creates/updates the owner's note on a player; an empty note with no tag deletes it. */
export async function savePlayerNote(ownerId: string, input: unknown): Promise<PlayerNoteView> {
  const parsed = playerNoteInputSchema.safeParse(input);
  if (!parsed.success) throw new NoteError("INVALID", "Notes are limited to 1,000 characters.");
  const { subjectId, color } = parsed.data;
  const text = parsed.data.text.replace(/\r\n/g, "\n").trim();
  if (subjectId === ownerId) throw new NoteError("SELF", "You can't write a note about yourself.");
  const subject = await prisma.user.findFirst({ where: { id: subjectId, deletedAt: null }, select: { id: true } });
  if (!subject) throw new NoteError("NOT_FOUND", "Player not found.");
  if (text === "" && color === "none") {
    await prisma.playerNote.deleteMany({ where: { ownerId, subjectId } });
    return toView(subjectId, null);
  }
  const note = await prisma.playerNote.upsert({
    where: { ownerId_subjectId: { ownerId, subjectId } },
    create: { ownerId, subjectId, text, color },
    update: { text, color },
    select: { text: true, color: true, updatedAt: true },
  });
  return toView(subjectId, note);
}

/** Players the owner has notes on, most recently edited first. */
export async function listPlayerNotes(ownerId: string, limit = 100) {
  const notes = await prisma.playerNote.findMany({
    where: { ownerId, subject: { deletedAt: null } },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
    select: {
      subjectId: true,
      text: true,
      color: true,
      updatedAt: true,
      subject: { select: { username: true, displayName: true, avatar: true } },
    },
  });
  return notes.map((n) => ({
    ...toView(n.subjectId, n),
    username: n.subject.username,
    displayName: n.subject.displayName ?? n.subject.username ?? "Player",
    avatar: n.subject.avatar,
  }));
}
