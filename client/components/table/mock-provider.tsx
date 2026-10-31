"use client";

import type { Ack, ChatMessage, TableView } from "@poker-platform/shared/types";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  applyAction,
  castVote,
  initMockState,
  propose,
  rebuy,
  setStraddle,
  showCards,
  sit,
  sitOut,
  stand,
  startNextHand,
  tick,
  viewerSeatNo,
  type MockState,
} from "./mock-engine";
import { TableProvider } from "./table-context";
import { ackError, CHAT_MAX_LENGTH, type TableCommands, type TableController, type TableNotice } from "./table-controller";
import { makeNotice } from "./use-table";

type MockTableProviderProps = {
  initialView: TableView;
  initialChat?: ChatMessage[];
  /** Let the other (fake) players act, vote and deal new hands. Default true. */
  simulate?: boolean;
  /** Simulated network latency for acks, ms. */
  latencyMs?: number;
  /** Fake connection state, to preview the connecting / failure / reconnecting UI. Retry "succeeds". */
  connection?: MockConnection;
  children: ReactNode;
};

export type MockConnection = "connected" | "connecting" | "stalled" | "reconnecting" | "offline" | "closed" | "unauthorized";

const MOCK_ERRORS: Partial<Record<MockConnection, { code: string; message: string }>> = {
  closed: { code: "TABLE_CLOSED", message: "This table has closed." },
  unauthorized: { code: "UNAUTHORIZED", message: "Your sign-in has expired. Sign in again to join the table." },
};

/**
 * Runs the table UI from a fixture. Commands mutate the fixture through a tiny local simulator,
 * so the action bar, votes, seating and chat can be exercised without a server.
 */
export function MockTableProvider({
  initialView,
  initialChat = [],
  simulate = true,
  latencyMs = 120,
  connection: initialConnection = "connected",
  children,
}: MockTableProviderProps) {
  const [connection, setConnection] = useState<MockConnection>(initialConnection);
  const [state, setState] = useState<MockState>(() => initMockState(initialView));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [chat, setChat] = useState<ChatMessage[]>(initialChat);
  const [notices, setNotices] = useState<TableNotice[]>([]);
  const lastChatAt = useRef(0);

  const pushNotice = useCallback((message: string, tone: TableNotice["tone"] = "error") => {
    setNotices((list) => [...list.slice(-3), makeNotice(message, tone)]);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = tick(stateRef.current, simulate);
      if (next) setState(next);
    }, 250);
    return () => window.clearInterval(id);
  }, [simulate]);

  const run = useCallback(
    (fn: (s: MockState) => { state: MockState; ack: Ack }): Promise<Ack> =>
      new Promise((resolve) => {
        window.setTimeout(() => {
          const r = fn(stateRef.current);
          if (r.ack.ok) {
            const next = { ...r.state, live: true };
            stateRef.current = next;
            setState(next);
          } else {
            pushNotice(r.ack.message);
          }
          resolve(r.ack);
        }, latencyMs);
      }),
    [latencyMs, pushNotice],
  );

  const commands = useMemo<TableCommands>(
    () => ({
      sit: (seat, buyIn) => run((s) => sit(s, seat, buyIn)),
      stand: () => run((s) => stand(s)),
      sitOut: (out) => run((s) => sitOut(s, out)),
      rebuy: (amount) => run((s) => rebuy(s, amount)),
      start: () =>
        run((s) =>
          s.view.seats.filter((x) => x.status === "ACTIVE").length < 2
            ? { state: s, ack: ackError("NOT_ENOUGH_PLAYERS", "You need at least 2 players.") }
            : { state: startNextHand(s), ack: { ok: true, data: undefined } },
        ),
      act: (type, amount) =>
        run((s) => {
          const seat = viewerSeatNo(s);
          return seat === null ? { state: s, ack: ackError("NOT_SEATED", "You're not seated.") } : applyAction(s, seat, type, amount);
        }),
      straddle: (enabled) => run((s) => setStraddle(s, enabled)),
      propose: (kind, action) => run((s) => propose(s, kind, action)),
      vote: (voteId, yes) => run((s) => castVote(s, s.view.viewer.userId, voteId, yes)),
      show: () => run((s) => showCards(s)),
      chat: ({ text, emoteId }) => {
        const now = Date.now();
        const trimmed = text?.trim();
        if (now - lastChatAt.current < 800) {
          const message = "You're sending messages too fast.";
          pushNotice(message);
          return Promise.resolve(ackError("RATE_LIMITED", message));
        }
        if (!trimmed && !emoteId) return Promise.resolve(ackError("EMPTY", "Message is empty."));
        if (trimmed && trimmed.length > CHAT_MAX_LENGTH) return Promise.resolve(ackError("TOO_LONG", "Message is too long."));
        lastChatAt.current = now;
        const view = stateRef.current.view;
        const me = view.seats.find((x) => x.userId === view.viewer.userId);
        setChat((list) => [
          ...list,
          {
            id: `mc-${now}`,
            tableId: view.tableId,
            userId: view.viewer.userId,
            displayName: me?.displayName ?? "Sam",
            text: trimmed || null,
            emoteId: emoteId ?? null,
            sentAt: new Date(now).toISOString(),
          },
        ]);
        return Promise.resolve({ ok: true, data: undefined } as Ack);
      },
      leave: () => Promise.resolve({ ok: true, data: undefined } as Ack),
      close: () =>
        run((s) =>
          s.view.viewer.userId !== s.view.hostUserId
            ? { state: s, ack: ackError("NOT_HOST", "Only the host can close the table.") }
            : { state: { ...s, view: { ...s.view, status: "CLOSED", hand: null } }, ack: { ok: true, data: undefined } },
        ),
    }),
    [run, pushNotice],
  );

  const retry = useCallback(() => {
    setConnection((c) => (c === "reconnecting" || c === "offline" ? "reconnecting" : "connecting"));
    window.setTimeout(() => setConnection("connected"), 900);
  }, []);
  const hasView = connection === "connected" || connection === "reconnecting" || connection === "offline";
  const controller: TableController = {
    tableId: state.view.tableId,
    view: hasView ? state.view : null,
    status:
      connection === "stalled"
        ? "connecting"
        : connection === "closed" || connection === "unauthorized"
          ? "error"
          : connection === "offline"
            ? "disconnected"
            : connection,
    error: MOCK_ERRORS[connection] ?? null,
    stalled: connection === "stalled",
    retry,
    chat,
    now: Date.now,
    commands,
    notices,
    dismissNotice: (id) => setNotices((list) => list.filter((n) => n.id !== id)),
  };

  return <TableProvider controller={controller}>{children}</TableProvider>;
}
