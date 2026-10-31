"use server";

import { NoteError, savePlayerNote, type PlayerNoteView } from "@poker-platform/shared/stats";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";

export type SaveNoteResult = { ok: true; note: PlayerNoteView } | { ok: false; error: string };

/**
 * Saves the signed-in user's private note / colour tag on another player. Usable from the stats page, the
 * public profile and the table (import { savePlayerNoteAction } from "@/components/stats/note-actions").
 */
export async function savePlayerNoteAction(input: { subjectId: string; text: string; color: string }): Promise<SaveNoteResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to keep notes." };
  try {
    const note = await savePlayerNote(user.userId, {
      subjectId: input?.subjectId,
      text: input?.text,
      color: input?.color,
    });
    revalidatePath("/stats");
    return { ok: true, note };
  } catch (error) {
    if (error instanceof NoteError) return { ok: false, error: error.message };
    return { ok: false, error: "Couldn't save the note. Try again." };
  }
}
