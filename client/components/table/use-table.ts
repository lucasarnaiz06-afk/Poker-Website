"use client";

import type {
  Ack,
  ChatMessage,
  ClientToServerEvents,
  ServerToClientEvents,
  TableView,
} from "@poker-platform/shared/types";
import { getRealtimeSocketOptions, getRealtimeSocketUrl } from "@/lib/realtime-socket";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { estimateSkew, isNewerView } from "./logic";
import {
  ACK_TIMEOUT_MS,
  ackError,
  CONNECT_STALL_MS,
  type ConnectionStatus,
  type TableCommands,
  type TableController,
  type TableNotice,
} from "./table-controller";

type TableSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const CHAT_HISTORY = 150;
const SKEW_SAMPLES = 10;

/** Event names that take `{ tableId, ...payload }` and ack with a plain `Ack`. */
type SimpleEvent = Exclude<keyof ClientToServerEvents, "table:join" | "lobby:subscribe" | "lobby:unsubscribe">;
type PayloadOf<E extends SimpleEvent> = Omit<Parameters<ClientToServerEvents[E]>[0], "tableId">;

let noticeSeq = 0;
export function makeNotice(message: string, tone: TableNotice["tone"] = "error"): TableNotice {
  noticeSeq += 1;
  return { id: `n${noticeSeq}-${Date.now()}`, tone, message };
}

export type UseTableOptions = {
  password?: string;
  /** Set false to keep the hook idle (e.g. until a password is entered). Default true. */
  enabled?: boolean;
};

/**
 * Live table connection. Joins `tableId` over socket.io (same-origin `/socket.io` rewrite unless
 * NEXT_PUBLIC_SOCKET_URL is set), keeps the newest `TableView`, re-joins after reconnects and
 * exposes ack-returning commands.
 */
export function useTable(tableId: string, options: UseTableOptions = {}): TableController {
  const { password, enabled = true } = options;
  const socketRef = useRef<TableSocket | null>(null);
  const viewRef = useRef<TableView | null>(null);
  const skewSamples = useRef<number[]>([]);
  const skewRef = useRef(0);

  const [view, setViewState] = useState<TableView | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [notices, setNotices] = useState<TableNotice[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [stalled, setStalled] = useState(false);

  const pushNotice = useCallback((message: string, tone: TableNotice["tone"] = "error") => {
    setNotices((list) => [...list.slice(-3), makeNotice(message, tone)]);
  }, []);

  const dismissNotice = useCallback((id: string) => {
    setNotices((list) => list.filter((n) => n.id !== id));
  }, []);

  const applyView = useCallback((next: TableView, force: boolean) => {
    if (next.tableId !== tableId) return;
    if (!force && !isNewerView(viewRef.current, next)) return;
    const serverMs = Date.parse(next.serverTime);
    if (Number.isFinite(serverMs)) {
      skewSamples.current = [...skewSamples.current.slice(-(SKEW_SAMPLES - 1)), serverMs - Date.now()];
      skewRef.current = estimateSkew(skewSamples.current);
    }
    viewRef.current = next;
    setViewState(next);
  }, [tableId]);

  useEffect(() => {
    if (!enabled) return;
    const url = getRealtimeSocketUrl();
    const socketOptions = getRealtimeSocketOptions(Boolean(url));
    const socket: TableSocket = url ? io(url, socketOptions) : io(socketOptions);
    socketRef.current = socket;
    // A Retry on the same table keeps the last view on screen (marked as reconnecting) until the rejoin.
    const keep = viewRef.current?.tableId === tableId;
    if (!keep) {
      viewRef.current = null;
      skewSamples.current = [];
      setViewState(null);
      setChat([]);
    }
    setError(null);
    setStatus(keep ? "reconnecting" : "connecting");

    let disposed = false;
    let rejoinTimer: number | undefined;
    const join = () => {
      if (disposed) return;
      const payload = password ? { tableId, password } : { tableId };
      socket.timeout(ACK_TIMEOUT_MS).emit("table:join", payload, (err, res) => {
        if (disposed) return;
        if (err) {
          setStatus(viewRef.current ? "reconnecting" : "connecting");
          // Retry the join while the socket is still up (e.g. server busy restarting).
          if (socket.connected) rejoinTimer = window.setTimeout(join, 1500);
          return;
        }
        if (!res.ok) {
          setStatus("error");
          setError({ code: res.code, message: res.message });
          return;
        }
        setError(null);
        setStatus("connected");
        // A join is a full resync: accept it even if the version went backwards (server restart).
        applyView(res.data, true);
      });
    };

    socket.on("connect", join);
    socket.on("disconnect", (reason) => {
      setStatus(reason === "io client disconnect" ? "disconnected" : "reconnecting");
    });
    socket.on("connect_error", (err) => {
      // A rejection by the server's auth middleware is final: socket.io won't retry it on its own.
      if (!socket.active) {
        setStatus("error");
        setError(
          /unauthori[sz]ed/i.test(err.message)
            ? { code: "UNAUTHORIZED", message: "Your sign-in has expired. Sign in again to join the table." }
            : { code: "CONNECT_REJECTED", message: err.message || "The table server refused the connection." },
        );
        return;
      }
      setStatus((s) => (s === "error" ? s : viewRef.current ? "reconnecting" : "connecting"));
    });
    socket.io.on("reconnect_failed", () => setStatus("disconnected"));

    socket.on("table:state", (next) => applyView(next, false));
    socket.on("table:chat", (msg) => {
      if (msg.tableId !== tableId) return;
      setChat((list) => (list.some((m) => m.id === msg.id) ? list : [...list, msg].slice(-CHAT_HISTORY)));
    });
    socket.on("table:error", (err) => {
      if (err.tableId === tableId) pushNotice(err.message);
    });
    socket.on("wallet:balance", ({ balance }) => {
      const current = viewRef.current;
      if (!current) return;
      const patched = { ...current, viewer: { ...current.viewer, walletBalance: balance } };
      viewRef.current = patched;
      setViewState(patched);
    });

    socket.connect();

    return () => {
      disposed = true;
      window.clearTimeout(rejoinTimer);
      if (socket.connected) socket.emit("table:leave", { tableId }, () => undefined);
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [tableId, password, enabled, applyView, pushNotice, attempt]);

  // Connecting or reconnecting for too long: let the UI offer Retry (socket.io keeps trying meanwhile).
  const waiting = enabled && (status === "connecting" || status === "reconnecting");
  useEffect(() => {
    setStalled(false);
    if (!waiting) return;
    const t = window.setTimeout(() => setStalled(true), CONNECT_STALL_MS);
    return () => window.clearTimeout(t);
  }, [waiting, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const emit = useCallback(
    <E extends SimpleEvent>(event: E, payload: PayloadOf<E>, quiet = false): Promise<Ack> => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        const message = "You're offline. Reconnecting…";
        if (!quiet) pushNotice(message);
        return Promise.resolve(ackError("OFFLINE", message));
      }
      return new Promise<Ack>((resolve) => {
        const full = { tableId, ...payload } as Parameters<ClientToServerEvents[E]>[0];
        // socket.io's typed emit can't be expressed generically over the event union; the payload
        // type is enforced by PayloadOf<E> above.
        const emitter = socket.timeout(ACK_TIMEOUT_MS) as unknown as {
          emit: (ev: string, p: unknown, cb: (err: Error | null, res: Ack) => void) => void;
        };
        emitter.emit(event, full, (err, res) => {
          const result: Ack = err ? ackError("TIMEOUT", "The server didn't respond. Try again.") : res;
          if (!result.ok && !quiet) pushNotice(result.message);
          resolve(result);
        });
      });
    },
    [tableId, pushNotice],
  );

  const commands = useMemo<TableCommands>(
    () => ({
      sit: (seat, buyIn) => emit("table:sit", { seat, buyIn }),
      stand: () => emit("table:stand", {}),
      sitOut: (sitOut) => emit("table:sitOut", { sitOut }),
      rebuy: (amount) => emit("table:rebuy", { amount }),
      start: () => emit("table:start", {}),
      act: (type, amount) => {
        const hand = viewRef.current?.hand;
        if (!hand) return Promise.resolve(ackError("NO_HAND", "There is no hand in progress."));
        return emit("table:action", amount === undefined ? { handId: hand.handId, type } : { handId: hand.handId, type, amount });
      },
      straddle: (enabled) => emit("table:straddle", { enabled }),
      propose: (kind, action) => emit("table:propose", { kind, action }),
      vote: (voteId, yes) => emit("table:vote", { voteId, yes }),
      show: () => {
        const hand = viewRef.current?.hand;
        if (!hand) return Promise.resolve(ackError("NO_HAND", "There is no hand to show."));
        return emit("table:show", { handId: hand.handId });
      },
      chat: (message) => emit("table:chat", message),
      leave: () => emit("table:leave", {}, true),
      close: () => emit("table:close", {}),
    }),
    [emit],
  );

  const now = useCallback(() => Date.now() + skewRef.current, []);

  return { tableId, view, status, error, stalled, retry, chat, now, commands, notices, dismissNotice };
}
