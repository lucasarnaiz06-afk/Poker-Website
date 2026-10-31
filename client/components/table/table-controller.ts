import type {
  Ack,
  ActionType,
  ChatMessage,
  TableView,
  VoteKind,
} from "@poker-platform/shared/types";

export type ConnectionStatus =
  | "connecting" // first connection / join in flight
  | "connected" // joined, receiving state
  | "reconnecting" // lost the socket, socket.io is retrying
  | "disconnected" // gave up or torn down
  | "error"; // join rejected (see `error`)

export type TableCommands = {
  sit: (seat: number, buyIn: number) => Promise<Ack>;
  stand: () => Promise<Ack>;
  sitOut: (sitOut: boolean) => Promise<Ack>;
  rebuy: (amount: number) => Promise<Ack>;
  start: () => Promise<Ack>;
  /** Uses the current hand id from the latest view. */
  act: (type: ActionType, amount?: number) => Promise<Ack>;
  straddle: (enabled: boolean) => Promise<Ack>;
  propose: (kind: VoteKind, action: "START" | "STOP") => Promise<Ack>;
  vote: (voteId: string, yes: boolean) => Promise<Ack>;
  /** Show the viewer's cards for the hand that just finished. */
  show: () => Promise<Ack>;
  chat: (message: { text?: string; emoteId?: string }) => Promise<Ack>;
  leave: () => Promise<Ack>;
  /** Host only: closes the table for everyone (a hand in progress is voided, every stack refunded). */
  close: () => Promise<Ack>;
};

/**
 * What every table component consumes. Produced by `useTable` (live socket) or by
 * `MockTableProvider` (fixtures), so the same UI runs in both.
 */
export type TableController = {
  tableId: string;
  view: TableView | null;
  status: ConnectionStatus;
  error: { code: string; message: string } | null;
  /**
   * True once connecting / reconnecting has taken longer than CONNECT_STALL_MS. The UI then shows a
   * "can't connect" state with Retry instead of an endless skeleton (socket.io keeps retrying behind it).
   */
  stalled: boolean;
  /** Tear down the connection and start a fresh one (Retry buttons). */
  retry: () => void;
  chat: ChatMessage[];
  /** Server-clock "now" in ms (Date.now() corrected by the skew measured from `serverTime`). */
  now: () => number;
  commands: TableCommands;
  /** Errors pushed by the server ("table:error") or failed acks; the UI shows them as toasts. */
  notices: TableNotice[];
  dismissNotice: (id: string) => void;
};

export type TableNotice = { id: string; tone: "error" | "info"; message: string };

export const CHAT_MAX_LENGTH = 200;
export const ACK_TIMEOUT_MS = 8000;
/** How long connecting / reconnecting may take before the UI offers Retry. */
export const CONNECT_STALL_MS = 8000;

export function ackError(code: string, message: string): Ack {
  return { ok: false, code, message };
}
