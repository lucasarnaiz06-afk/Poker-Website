// Owns every Table actor: loading, connection bookkeeping, lobby feed, boot recovery and shutdown.
import type { ActionType, LobbyTableSummary, TableView, VoteKind } from "@poker-platform/shared/types";
import { getTableFeatures } from "@poker-platform/shared/lobbies/client";
import type { Clock, TimerHandle } from "./clock";
import { fail, RuntimeError } from "./errors";
import type {
  HandStorePort,
  LobbyFeedListener,
  LobbyStorePort,
  PlayGatePort,
  Rng,
  TableRecord,
  TableTransport,
  WalletPort,
} from "./ports";
import { Table } from "./table";
import type { TableTimings } from "./table-state";

export type RuntimeDeps = {
  clock: Clock;
  rng: Rng;
  wallet: WalletPort;
  hands: HandStorePort;
  lobby: LobbyStorePort;
  gate: PlayGatePort;
  transport: TableTransport;
  timings?: Partial<TableTimings>;
  deckProvider?: (tableId: string, handNumber: number) => string[] | null;
  lobbyThrottleMs?: number;
  lobbyRefreshMs?: number;
  idleUnloadMs?: number;
  logger?: (message: string, error?: unknown) => void;
};

export class TableRuntime {
  readonly tables = new Map<string, Table>();
  private loading = new Map<string, Promise<Table>>();
  /** connId -> tables that connection is viewing. */
  private connTables = new Map<string, Set<string>>();
  private lobbyListeners = new Set<LobbyFeedListener>();
  private lobbyTimer: TimerHandle | null = null;
  private lobbyRefreshTimer: TimerHandle | null = null;
  private unloadTimers = new Map<string, TimerHandle>();
  private shuttingDown = false;

  constructor(private readonly deps: RuntimeDeps) {}

  private logError(message: string, error?: unknown) {
    (this.deps.logger ?? ((m, e) => console.error(`[runtime] ${m}`, e ?? "")))(message, error);
  }

  // ---- Tables --------------------------------------------------------------------------------

  async getTable(tableId: string): Promise<Table> {
    if (this.shuttingDown) fail("SERVER_RESTARTING", "The server is restarting. Try again in a moment.");
    const existing = this.tables.get(tableId);
    if (existing) return existing;
    let pending = this.loading.get(tableId);
    if (!pending) {
      pending = (async () => {
        const record = await this.deps.lobby.loadTable(tableId);
        if (!record || record.closed) fail("TABLE_NOT_FOUND", "Table not found.");
        const table = this.createTable(record);
        this.tables.set(tableId, table);
        return table;
      })().finally(() => this.loading.delete(tableId));
      this.loading.set(tableId, pending);
    }
    return pending;
  }

  private createTable(record: TableRecord) {
    return new Table(record, {
      clock: this.deps.clock,
      rng: this.deps.rng,
      wallet: this.deps.wallet,
      hands: this.deps.hands,
      lobby: this.deps.lobby,
      gate: this.deps.gate,
      transport: this.deps.transport,
      timings: this.deps.timings,
      deckProvider: this.deps.deckProvider ? (n) => this.deps.deckProvider!(record.id, n) : undefined,
      onSummaryChanged: () => this.lobbyChanged(),
      onHostClosed: (tableId) => this.finishClose(tableId),
      logger: this.deps.logger,
    });
  }

  /** Table that must already be loaded and viewed by this connection's user. */
  private loaded(tableId: string) {
    const table = this.tables.get(tableId);
    if (!table) fail("NOT_JOINED", "Join the table first.");
    return table;
  }

  async idle() {
    for (let round = 0; round < 10; round += 1) {
      const busy = [...this.tables.values()].filter((t) => t.queue.size > 0);
      if (busy.length === 0) return;
      await Promise.all(busy.map((t) => t.idle()));
    }
  }

  // ---- Connections ---------------------------------------------------------------------------

  async join(connId: string, userId: string, tableId: string, options: { password?: string; inviteCode?: string }) {
    const table = await this.getTable(tableId);
    const view = await table.join(connId, userId, options);
    const set = this.connTables.get(connId) ?? new Set<string>();
    set.add(tableId);
    this.connTables.set(connId, set);
    this.cancelUnload(tableId);
    return view;
  }

  async leave(connId: string, tableId: string) {
    const table = this.tables.get(tableId);
    this.connTables.get(connId)?.delete(tableId);
    if (!table) return;
    await table.detach(connId);
    this.scheduleUnload(table);
  }

  async disconnect(connId: string) {
    const tableIds = [...(this.connTables.get(connId) ?? [])];
    this.connTables.delete(connId);
    await Promise.all(tableIds.map((id) => this.leave(connId, id)));
  }

  isViewing(connId: string, tableId: string) {
    return this.connTables.get(connId)?.has(tableId) ?? false;
  }

  private scheduleUnload(table: Table) {
    if (!table.isIdle() || this.unloadTimers.has(table.id)) return;
    this.unloadTimers.set(
      table.id,
      this.deps.clock.setTimeout(() => {
        this.unloadTimers.delete(table.id);
        if (table.isIdle() && this.tables.get(table.id) === table) this.tables.delete(table.id);
      }, this.deps.idleUnloadMs ?? 5 * 60_000),
    );
  }

  private cancelUnload(tableId: string) {
    this.deps.clock.clearTimeout(this.unloadTimers.get(tableId));
    this.unloadTimers.delete(tableId);
  }

  // ---- Commands (the socket layer checks the connection joined the table first) ---------------

  sit(userId: string, tableId: string, seat: number, buyIn: number, postNow?: boolean) {
    return this.loaded(tableId).sit(userId, seat, buyIn, postNow);
  }
  stand(userId: string, tableId: string) {
    return this.loaded(tableId).stand(userId);
  }
  sitOut(userId: string, tableId: string, sitOut: boolean) {
    return this.loaded(tableId).sitOut(userId, sitOut);
  }
  rebuy(userId: string, tableId: string, amount: number) {
    return this.loaded(tableId).rebuy(userId, amount);
  }
  start(userId: string, tableId: string) {
    return this.loaded(tableId).start(userId);
  }
  action(userId: string, tableId: string, handId: string, type: ActionType, amount?: number) {
    return this.loaded(tableId).action(userId, handId, type, amount);
  }
  straddle(userId: string, tableId: string, enabled: boolean) {
    return this.loaded(tableId).straddle(userId, enabled);
  }
  propose(userId: string, tableId: string, kind: VoteKind, action: "START" | "STOP") {
    return this.loaded(tableId).propose(userId, kind, action);
  }
  vote(userId: string, tableId: string, voteId: string, yes: boolean) {
    return this.loaded(tableId).vote(userId, voteId, yes);
  }
  show(userId: string, tableId: string, handId: string) {
    return this.loaded(tableId).show(userId, handId);
  }
  chat(userId: string, tableId: string, text?: string, emoteId?: string) {
    return this.loaded(tableId).chat(userId, text, emoteId);
  }

  async close(userId: string, tableId: string) {
    await this.closeTable(userId, this.loaded(tableId));
  }

  /**
   * Host closes a table from outside it (the lobby's "Your tables"). A table this process hasn't loaded holds
   * no live seats (a fresh actor starts empty and leftover stacks are refunded by boot recovery), so it is
   * loaded only to run the same close path: refund every stack (after any hand in progress), mark the lobby closed.
   */
  async closeAsHost(userId: string, tableId: string) {
    if (!this.tables.has(tableId)) {
      const record = await this.deps.lobby.loadTable(tableId);
      if (!record || record.closed) fail("TABLE_NOT_FOUND", "Table not found.");
      if (record.hostUserId !== userId) fail("NOT_HOST", "Only the host can close the table.");
    }
    await this.closeTable(userId, await this.getTable(tableId));
  }

  /** Closes now, or after the hand in progress (the table then calls finishClose itself). */
  private async closeTable(userId: string, table: Table) {
    const closedNow = await table.close(userId);
    if (!closedNow) return;
    if (!table.closed) fail("CLOSE_INCOMPLETE", "Some stacks could not be refunded yet; they will be on restart.");
    await this.finishClose(table.id);
  }

  private async finishClose(tableId: string) {
    // Stacks that could not be refunded keep the table loaded; boot recovery refunds them.
    if (!this.tables.get(tableId)?.closed) return;
    await this.deps.lobby.closeTable(tableId);
    this.tables.delete(tableId);
    this.lobbyChanged();
  }

  viewFor(tableId: string, userId: string): TableView | null {
    return this.tables.get(tableId)?.viewFor(userId) ?? null;
  }

  // ---- Lobby feed ----------------------------------------------------------------------------

  async lobbySummaries(): Promise<LobbyTableSummary[]> {
    const records = await this.deps.lobby.listOpenPublicTables();
    return records.map((record) => {
      const table = this.tables.get(record.id);
      const s = record.settings;
      const live = table?.liveStats();
      return {
        tableId: record.id,
        name: record.name,
        variant: s.variant,
        smallBlind: s.smallBlind,
        bigBlind: s.bigBlind,
        minBuyIn: s.minBuyIn,
        maxBuyIn: s.maxBuyIn,
        maxPlayers: s.maxPlayers,
        seated: live?.seated ?? 0,
        visibility: record.visibility,
        status: live?.status ?? "WAITING",
        features: getTableFeatures(s),
        avgPot: live?.avgPot ?? null,
        handsPerHour: live?.handsPerHour ?? null,
        hasPassword: record.passwordHash !== null,
        ante: s.ante,
      };
    });
  }

  subscribeLobby(listener: LobbyFeedListener) {
    this.lobbyListeners.add(listener);
    this.armLobbyRefresh();
    return () => {
      this.lobbyListeners.delete(listener);
    };
  }

  private armLobbyRefresh() {
    if (this.lobbyRefreshTimer || this.lobbyListeners.size === 0) return;
    this.lobbyRefreshTimer = this.deps.clock.setTimeout(() => {
      this.lobbyRefreshTimer = null;
      if (this.lobbyListeners.size === 0) return;
      this.lobbyChanged();
      this.armLobbyRefresh();
    }, this.deps.lobbyRefreshMs ?? 15_000);
  }

  /** Throttled push of the lobby list to subscribers. */
  lobbyChanged() {
    if (this.lobbyTimer || this.lobbyListeners.size === 0) return;
    this.lobbyTimer = this.deps.clock.setTimeout(() => {
      this.lobbyTimer = null;
      void this.lobbySummaries()
        .then((list) => {
          for (const listener of this.lobbyListeners) listener(list);
        })
        .catch((error) => this.logError("lobby feed failed", error));
    }, this.deps.lobbyThrottleMs ?? 1_000);
  }

  // ---- Boot recovery / shutdown --------------------------------------------------------------

  /** Refunds stacks left on tables by a previous process (crash), then resets the lobbies. */
  async recover() {
    const stacks = await this.deps.lobby.listSeatedStacks();
    let refunded = 0;
    for (const entry of stacks) {
      try {
        await this.deps.wallet.cashOut({
          userId: entry.userId,
          tableId: entry.tableId,
          amount: entry.stack,
          refKey: entry.refKey,
          reason: "RECOVERY",
        });
        refunded += 1;
      } catch (error) {
        this.logError(`recovery refund failed for ${entry.tableId}/${entry.userId}`, error);
      }
    }
    await this.deps.lobby.resetTables();
    return { refunded, total: stacks.length };
  }

  /** Graceful shutdown: no new hands, hands in progress are voided, every stack is refunded. */
  async shutdown() {
    this.shuttingDown = true;
    this.deps.clock.clearTimeout(this.lobbyTimer);
    this.deps.clock.clearTimeout(this.lobbyRefreshTimer);
    for (const timer of this.unloadTimers.values()) this.deps.clock.clearTimeout(timer);
    await Promise.all(
      [...this.tables.values()].map((table) =>
        table.shutdown().catch((error) => this.logError(`shutdown of ${table.id} failed`, error)),
      ),
    );
    await this.deps.lobby.resetTables().catch((error) => this.logError("reset tables failed", error));
  }

  isShuttingDown() {
    return this.shuttingDown;
  }
}

export { RuntimeError };
