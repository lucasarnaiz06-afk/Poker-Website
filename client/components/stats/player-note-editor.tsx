"use client";

import { NOTE_COLOR_LABEL, NOTE_COLORS, type NoteColor, type PlayerNoteView } from "@poker-platform/shared/stats/client";
import { NotebookPen } from "lucide-react";
import { useState, useTransition } from "react";
import { Button, Dialog, DialogContent, DialogTrigger, Textarea, toast } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { savePlayerNoteAction } from "./note-actions";
import { NOTE_SWATCH } from "./note-colors";

export function NoteColorDot({ color, className }: { color: NoteColor | null | undefined; className?: string }) {
  if (!color || color === "none") return null;
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", NOTE_SWATCH[color], className)} aria-label={`${NOTE_COLOR_LABEL[color]} tag`} role="img" />;
}

function ColorPicker({ value, onChange }: { value: NoteColor; onChange: (c: NoteColor) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour tag">
      {NOTE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={NOTE_COLOR_LABEL[c]}
          title={NOTE_COLOR_LABEL[c]}
          onClick={() => onChange(c)}
          className={cn(
            "h-7 w-7 rounded-full transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            NOTE_SWATCH[c],
            value === c && "ring-2 ring-fg ring-offset-2 ring-offset-surface",
          )}
        />
      ))}
    </div>
  );
}

/** Inline editor (profile page, side panels). Private: only the author sees it. */
export function PlayerNoteEditor({
  subjectId,
  initial,
  onSaved,
  compact = false,
}: {
  subjectId: string;
  initial: Pick<PlayerNoteView, "text" | "color">;
  onSaved?: (note: PlayerNoteView) => void;
  compact?: boolean;
}) {
  const [text, setText] = useState(initial.text);
  const [color, setColor] = useState<NoteColor>(initial.color);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const dirty = text !== saved.text || color !== saved.color;

  const save = () =>
    start(async () => {
      const res = await savePlayerNoteAction({ subjectId, text, color });
      if (res.ok) {
        setSaved({ text: res.note.text, color: res.note.color });
        setText(res.note.text);
        onSaved?.(res.note);
        toast({ title: "Note saved", tone: "success", duration: 2000 });
      } else {
        toast({ title: "Couldn't save note", description: res.error, tone: "error" });
      }
    });

  return (
    <div className="space-y-3">
      <ColorPicker value={color} onChange={setColor} />
      <Textarea
        aria-label="Private note"
        rows={compact ? 2 : 3}
        maxLength={1000}
        placeholder="Only you can see this. e.g. “Bluffs a lot on the river”"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-subtle">{text.length}/1000 · private</span>
        <Button size="sm" onClick={save} loading={pending} disabled={!dirty}>
          Save note
        </Button>
      </div>
    </div>
  );
}

/** Small button + dialog to edit a note (opponent lists, table seats). */
export function PlayerNoteButton({
  subjectId,
  name,
  initial,
}: {
  subjectId: string;
  name: string;
  initial: Pick<PlayerNoteView, "text" | "color">;
}) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(initial);
  const has = current.text !== "" || current.color !== "none";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={has ? `Edit note on ${name}` : `Add note on ${name}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {has ? <NoteColorDot color={current.color} /> : null}
          <NotebookPen className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">{has ? "Note" : "Add note"}</span>
        </button>
      </DialogTrigger>
      <DialogContent title={`Note on ${name}`} description="Private: only you can see notes and colour tags.">
        <PlayerNoteEditor
          subjectId={subjectId}
          initial={current}
          onSaved={(n) => {
            setCurrent({ text: n.text, color: n.color });
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
