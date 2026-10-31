"use client";

import type { TableView } from "@poker-platform/shared/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/components/ui/cn";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatChips } from "./format";
import { advanceSession, closeSession, type SeatSession, type SessionResult } from "./session";

const storageKey = (tableId: string, userId: string) => `table-session:${tableId}:${userId}`;

function load(tableId: string, userId: string): SeatSession | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(tableId, userId));
    const parsed = raw ? (JSON.parse(raw) as SeatSession) : null;
    return parsed && parsed.tableId === tableId && parsed.userId === userId ? parsed : null;
  } catch {
    return null;
  }
}

function save(session: SeatSession | null, tableId: string, userId: string) {
  try {
    if (session) window.sessionStorage.setItem(storageKey(tableId, userId), JSON.stringify(session));
    else window.sessionStorage.removeItem(storageKey(tableId, userId));
  } catch {
    // Storage unavailable (private mode): the session still lives in memory.
  }
}

/**
 * Tracks the viewer's seat session and returns its summary once they stand up, leave or are cashed
 * out (seat goes from a number to null). Survives reloads of the tab via sessionStorage.
 */
export function useSeatSession(view: TableView | null): { result: SessionResult | null; dismiss: () => void } {
  const ref = useRef<SeatSession | null>(null);
  const loadedFor = useRef<string | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);

  useEffect(() => {
    if (!view) return;
    const { tableId } = view;
    const userId = view.viewer.userId;
    const key = `${tableId}:${userId}`;
    if (loadedFor.current !== key) {
      loadedFor.current = key;
      ref.current = load(tableId, userId);
      // A stored session for someone no longer seated (closed tab, stood up elsewhere): drop it quietly.
      if (ref.current && view.viewer.seat === null) {
        ref.current = null;
        save(null, tableId, userId);
        return;
      }
    }

    const seated = view.viewer.seat !== null && view.seats.some((s) => s.seat === view.viewer.seat);
    const current = ref.current;
    if (seated) {
      const me = view.seats.find((s) => s.seat === view.viewer.seat)!;
      const base: SeatSession =
        current ??
        ({
          tableId,
          userId,
          startedAt: Date.now(),
          handsPlayed: 0,
          net: 0,
          biggestPotWon: 0,
          idleStack: view.hand && !view.hand.result ? null : me.stack + me.bet,
          live: null,
          counted: [],
          lastStack: me.stack,
        } satisfies SeatSession);
      const next = advanceSession(base, view);
      ref.current = next;
      save(next, tableId, userId);
      return;
    }

    if (current) {
      const done = closeSession(current);
      ref.current = null;
      save(null, tableId, userId);
      if (done.handsPlayed > 0) {
        setResult({
          handsPlayed: done.handsPlayed,
          net: done.net,
          biggestPotWon: done.biggestPotWon,
          startedAt: done.startedAt,
          endedAt: Date.now(),
          bigBlind: view.settings.bigBlind,
        });
      }
    }
  }, [view]);

  return { result, dismiss: () => setResult(null) };
}

function duration(ms: number) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

export function SessionSummaryDialog({
  result,
  onClose,
  handsHref,
  lobbyHref,
}: {
  result: SessionResult | null;
  onClose: () => void;
  handsHref: string;
  lobbyHref: string;
}) {
  const r = result;
  const bb = r ? r.net / Math.max(1, r.bigBlind) : 0;
  const sign = r && r.net > 0 ? "+" : r && r.net < 0 ? "−" : "";
  return (
    <Dialog open={r !== null} onOpenChange={(o) => !o && onClose()}>
      {r && (
        <DialogContent
          data-theme="dark"
          className="text-fg"
          size="sm"
          title="Session summary"
          description={`${duration(r.endedAt - r.startedAt)} at this table. Your chips are back in your wallet.`}
          footer={
            <>
              <Button asChild variant="ghost">
                <Link href={handsHref}>View hands</Link>
              </Button>
              <Button asChild>
                <Link href={lobbyHref}>Back to lobby</Link>
              </Button>
            </>
          }
        >
          <dl className="grid grid-cols-2 gap-3 text-center">
            <div className="col-span-2 rounded-xl border border-line bg-surface-2 px-4 py-3">
              <dt className="text-xs text-muted">Net result</dt>
              <dd
                className={cn(
                  "mt-0.5 text-2xl font-semibold tabular",
                  r.net > 0 ? "text-accent" : r.net < 0 ? "text-danger" : "text-fg",
                )}
              >
                {sign}
                {formatChips(Math.abs(r.net))}
                <span className="ml-2 text-sm font-medium text-muted">
                  {sign}
                  {Math.abs(bb).toFixed(Math.abs(bb) >= 100 ? 0 : 1)} BB
                </span>
              </dd>
            </div>
            <div className="rounded-xl border border-line px-3 py-2.5">
              <dt className="text-xs text-muted">Hands played</dt>
              <dd className="mt-0.5 text-base font-semibold tabular">{r.handsPlayed}</dd>
            </div>
            <div className="rounded-xl border border-line px-3 py-2.5">
              <dt className="text-xs text-muted">Biggest pot won</dt>
              <dd className="mt-0.5 text-base font-semibold tabular">{r.biggestPotWon > 0 ? formatChips(r.biggestPotWon) : "—"}</dd>
            </div>
          </dl>
        </DialogContent>
      )}
    </Dialog>
  );
}
