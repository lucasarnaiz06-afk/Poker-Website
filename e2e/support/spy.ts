// Records what the game server sends to one browser page: every socket.io packet (websocket frames and
// long-polling responses) is parsed so tests can assert on the exact TableView payloads a player received,
// including what must NOT be in them (other players' hole cards).
import type { Page } from "@playwright/test";
import type { ChatMessage, TableView } from "@poker-platform/shared/types";

export type SocketEvent = { name: string; data: unknown; at: number };

export class TableSpy {
  readonly events: SocketEvent[] = [];
  /** Raw text of every packet received (for leak checks). */
  readonly raw: string[] = [];

  constructor(readonly page: Page, readonly label: string) {
    page.on("websocket", (ws) => {
      if (!ws.url().includes("/socket.io")) return;
      ws.on("framereceived", ({ payload }) => this.ingest(typeof payload === "string" ? payload : payload.toString("utf8")));
    });
    page.on("response", async (response) => {
      const url = response.url();
      if (!/\/socket\.io\/?\?/.test(url) || response.request().method() !== "GET" || response.status() !== 200) return;
      const body = await response.text().catch(() => "");
      for (const part of body.split("\x1e")) this.ingest(part);
    });
  }

  private ingest(packet: string) {
    if (!packet.startsWith("4")) return; // engine.io "message"
    this.raw.push(packet);
    const io = packet.slice(1);
    if (io.startsWith("2")) {
      // event: 2["name",data] (no namespace, no ack id for server pushes)
      const json = io.slice(io.indexOf("["));
      try {
        const [name, data] = JSON.parse(json) as [string, unknown];
        this.events.push({ name, data, at: Date.now() });
      } catch {
        /* binary or partial packet */
      }
    } else if (io.startsWith("3")) {
      // ack: 3<id>[result]
      const json = io.slice(io.indexOf("["));
      try {
        const [result] = JSON.parse(json) as [{ ok?: boolean; data?: unknown }];
        if (result && typeof result === "object" && result.ok && isTableView(result.data)) {
          this.events.push({ name: "table:state", data: result.data, at: Date.now() });
        }
      } catch {
        /* ignore */
      }
    }
  }

  views(): TableView[] {
    return this.events.filter((e) => e.name === "table:state").map((e) => e.data as TableView);
  }

  latest(): TableView | null {
    const all = this.views();
    let best: TableView | null = null;
    for (const v of all) if (!best || v.version >= best.version || v.serverTime > best.serverTime) best = v;
    return all.at(-1) ?? best;
  }

  /** True when the table's version went backwards: the game server process restarted (dev watch mode). */
  serverRestarted(): boolean {
    let max = -1;
    for (const v of this.views()) {
      if (v.version < max - 1) return true;
      max = Math.max(max, v.version);
    }
    return false;
  }

  chats(): ChatMessage[] {
    return this.events.filter((e) => e.name === "table:chat").map((e) => e.data as ChatMessage);
  }

  async waitFor<T>(
    describe: string,
    pick: (view: TableView) => T | null | undefined | false,
    timeout = 30_000,
  ): Promise<T> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const view = this.latest();
      if (view) {
        const result = pick(view);
        if (result !== null && result !== undefined && result !== false) return result;
      }
      if (Date.now() > deadline) {
        const note = this.serverRestarted() ? "\nNOTE: the game server restarted during this test (table versions went backwards)." : "";
        throw new Error(`[${this.label}] timed out waiting for: ${describe}\nlatest view: ${summarize(view)}${note}`);
      }
      await this.page.waitForTimeout(100);
    }
  }
}

function isTableView(value: unknown): value is TableView {
  return Boolean(value && typeof value === "object" && "tableId" in value && "viewer" in value && "seats" in value);
}

export function summarize(view: TableView | null) {
  if (!view) return "none";
  return JSON.stringify({
    v: view.version,
    status: view.status,
    hand: view.hand && {
      n: view.hand.handNumber,
      phase: view.hand.phase,
      toAct: view.hand.toActSeat,
      pot: view.hand.totalPot,
      bomb: view.hand.isBombPot,
      boards: view.hand.boards.map((b) => b.length),
      result: Boolean(view.hand.result),
    },
    seats: view.seats.map((s) => `${s.seat}:${s.username}:${s.stack}+${s.bet}:${s.status}${s.folded ? ":F" : ""}`),
    viewer: { seat: view.viewer.seat, wallet: view.viewer.walletBalance, legal: Boolean(view.viewer.legalActions) },
    side: view.sideGames,
    votes: view.votes.map((v) => `${v.kind}:${v.action}:${v.status}`),
  });
}
