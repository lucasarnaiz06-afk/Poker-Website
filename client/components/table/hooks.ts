"use client";

import type { PublicCard, TableView } from "@poker-platform/shared/types";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { playSound } from "./sounds";

/** Re-renders every `intervalMs` while `active`, returning the (server-corrected) clock. */
export function useNow(now: () => number, active: boolean, intervalMs = 250): number {
  const [value, setValue] = useState(() => now());
  useEffect(() => {
    if (!active) return;
    setValue(now());
    const id = window.setInterval(() => setValue(now()), intervalMs);
    return () => window.clearInterval(id);
  }, [now, active, intervalMs]);
  return active ? value : now();
}

export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}

export function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (Math.abs(s.width - width) < 0.5 && Math.abs(s.height - height) < 0.5 ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Plays effects by diffing consecutive views (robust to whatever `lastEvent` the server sends). */
export function useTableSounds(view: TableView | null, enabled: boolean) {
  const prev = useRef<TableView | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!enabled || !view || !before || before.tableId !== view.tableId) return;
    const h0 = before.hand;
    const h1 = view.hand;
    if (h1 && h0?.handId !== h1.handId) {
      playSound("deal");
      return;
    }
    if (!h1 || !h0) return;
    const viewerSeat = view.viewer.seat;
    if (h1.result && !h0.result) {
      const won = h1.result.winners.some((w) => w.seat === viewerSeat);
      playSound(won ? "win" : "chips");
      return;
    }
    const cards0 = h0.boards.reduce((n, b) => n + b.length, 0);
    const cards1 = h1.boards.reduce((n, b) => n + b.length, 0);
    if (cards1 > cards0) {
      playSound("deal");
      return;
    }
    if (h1.toActSeat !== null && h1.toActSeat === viewerSeat && h0.toActSeat !== viewerSeat) {
      playSound("turn");
      return;
    }
    for (const seat of view.seats) {
      const old = before.seats.find((s) => s.seat === seat.seat);
      const a = seat.lastAction;
      if (!a || !old || (old.lastAction?.type === a.type && old.lastAction?.amount === a.amount)) continue;
      if (a.type === "check") playSound("check");
      else if (a.type === "fold") playSound("fold");
      else playSound("chips");
      return;
    }
  }, [view, enabled]);
}

export type HandSummary = {
  handId: string;
  handNumber: number;
  at: number;
  totalPot: number;
  boards: PublicCard[][];
  winners: Array<{ name: string; amount: number; handName: string | null }>;
  viewerCards: PublicCard[] | null;
  viewerNet: number | null;
  bombPot: boolean;
};

/** Collects finished hands seen during this session (newest first). */
export function useSessionHands(view: TableView | null, limit = 30): HandSummary[] {
  const [hands, setHands] = useState<HandSummary[]>([]);
  const startStacks = useRef(new Map<string, number>());
  useEffect(() => {
    const hand = view?.hand;
    if (!view || !hand) return;
    const me = view.seats.find((s) => s.seat === view.viewer.seat);
    if (!hand.result) {
      if (me && me.inHand && !startStacks.current.has(hand.handId)) {
        startStacks.current.set(hand.handId, me.stack + me.bet + (me.lastAction?.type === "ante" ? me.lastAction.amount ?? 0 : 0));
      }
      return;
    }
    const result = hand.result;
    setHands((list) => {
      if (list.some((h) => h.handId === hand.handId)) return list;
      const byName = new Map<number, { name: string; amount: number; handName: string | null }>();
      for (const w of result.winners) {
        const name = view.seats.find((s) => s.seat === w.seat)?.displayName ?? `Seat ${w.seat}`;
        const cur = byName.get(w.seat);
        byName.set(w.seat, { name, amount: (cur?.amount ?? 0) + w.amount, handName: cur?.handName ?? w.handName });
      }
      const start = startStacks.current.get(hand.handId);
      const summary: HandSummary = {
        handId: hand.handId,
        handNumber: hand.handNumber,
        at: Date.now(),
        totalPot: result.winners.reduce((n, w) => n + w.amount, 0),
        boards: hand.boards,
        winners: [...byName.values()],
        viewerCards: me?.holeCards ?? null,
        viewerNet: start !== undefined && me ? me.stack - start : null,
        bombPot: hand.isBombPot,
      };
      return [summary, ...list].slice(0, limit);
    });
  }, [view, limit]);
  return hands;
}
