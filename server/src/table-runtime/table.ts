// One actor per table: every command and timer callback runs through `queue`, strictly in order.
import {
  computePositions,
  EngineError,
  nextSeat,
  PokerHand,
  type HandEvent,
  type HandSummary,
  type StartHandConfig,
} from "@poker-platform/engine";
import type {
  ActionType,
  ChatMessage,
  HandResultView,
  LobbyTableSummary,
  TableEvent,
  TableLogEntry,
  TableView,
  VoteKind,
} from "@poker-platform/shared/types";
import { createDeckReveal, deckRevealCommitment } from "@poker-platform/shared/hands/deck-proof-node";
import type { Clock, TimerHandle } from "./clock";
import { fail, RuntimeError } from "./errors";
import {
  cardText,
  isSevenDeuce,
  positionNames,
  publicCards,
} from "./hand-utils";
import type {
  HandRecord,
  HandStorePort,
  LobbyStorePort,
  PlayGatePort,
  Profile,
  Rng,
  SidePayment,
  TableRecord,
  TableTransport,
  WalletPort,
} from "./ports";
import { SerialQueue } from "./serial-queue";
import {
  applyTransfers,
  bountyTransfers,
  evaluateVote,
  nitPenaltyTransfers,
  type Transfer,
} from "./side-games";
import {
  DEFAULT_TIMINGS,
  type ActiveHand,
  type LogKind,
  type NitState,
  type SeatState,
  type TableTimings,
  type VoteState,
} from "./table-state";
import { buildTableView } from "./view";
import { cleanChatText, maskProfanity } from "./chat-filter";

export type TableDeps = {
  clock: Clock;
  rng: Rng;
  wallet: WalletPort;
  hands: HandStorePort;
  lobby: LobbyStorePort;
  gate: PlayGatePort;
  transport: TableTransport;
  timings?: Partial<TableTimings>;
  /** Tests: fixed deck order per hand. */
  deckProvider?: (handNumber: number) => string[] | null;
  onSummaryChanged?: (tableId: string) => void;
  logger?: (message: string, error?: unknown) => void;
};

const LOG_CAP = 120;
const PASSWORD_MAX_FAILURES = 8;
const PASSWORD_LOCK_MS = 5 * 60_000;
const RECENT_HANDS = 30;
const SYSTEM_USER = "system";

type JoinOptions = { password?: string; inviteCode?: string };

function engineErrorToRuntime(error: unknown): never {
  if (error instanceof EngineError) {
    const messages: Record<string, string> = {
      NOT_YOUR_TURN: "It is not your turn.",
      CANNOT_CHECK: "You cannot check facing a bet.",
      NOTHING_TO_CALL: "There is nothing to call.",
      CANNOT_RAISE: "You cannot raise now.",
      INVALID_AMOUNT: "That amount is not allowed.",
      NOT_BETTING: "No betting round is open.",
      HAND_COMPLETE: "The hand is over.",
    };
    throw new RuntimeError(error.code, messages[error.code] ?? error.message);
  }
  throw error;
}

function walletErrorToRuntime(error: unknown): never {
  if (error instanceof RuntimeError) throw error;
  const code = (error as { code?: unknown })?.code;
  if (code === "INSUFFICIENT_FUNDS") fail("INSUFFICIENT_FUNDS", "Not enough chips in your wallet.");
  if (typeof code === "string" && error instanceof Error && error.name === "WalletError") {
    fail(code, error.message);
  }
  throw error;
}

export class Table {
  readonly id: string;
  record: TableRecord;
  readonly timings: TableTimings;
  readonly queue = new SerialQueue();

  seats = new Map<number, SeatState>();
  /** connId -> userId of everyone viewing the table (players and spectators). */
  conns = new Map<string, string>();
  connected = new Set<string>();
  graceTimers = new Map<string, TimerHandle>();
  profiles = new Map<string, Profile>();
  balances = new Map<string, number>();

  hand: ActiveHand | null = null;
  handNumber: number;
  buttonSeat: number | null = null;
  lastBigBlindSeat: number | null = null;
  started: boolean;
  closing = false;
  closed = false;
  nextHandAt: number | null = null;
  nextHandTimer: TimerHandle | null = null;
  version = 0;
  lastEvent: TableEvent | null = null;
  log: TableLogEntry[] = [];
  private logSeq = 0;

  votes: VoteState[] = [];
  voteCooldowns = new Map<string, number>();
  bombPotQueued = false;
  handsSinceBomb = 0;
  bountyActive = false;
  nit: NitState = { active: false, roundRunning: false, participants: [], nits: [] };
  /** Persisted id of the last completed hand (side payments after the hand amend it). */
  lastPersistedHandId: string | null = null;
  recentHands: Array<{ at: number; pot: number }> = [];
  private passwordFailures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    record: TableRecord,
    private readonly deps: TableDeps,
  ) {
    this.id = record.id;
    this.record = record;
    this.handNumber = record.lastHandNumber;
    this.timings = { ...DEFAULT_TIMINGS, ...deps.timings };
    this.started = record.settings.autoStart;
  }

  get settings() {
    return this.record.settings;
  }

  private get clock() {
    return this.deps.clock;
  }

  private now() {
    return this.deps.clock.now();
  }

  private logError(message: string, error?: unknown) {
    (this.deps.logger ?? ((m, e) => console.error(`[table ${this.id}] ${m}`, e ?? "")))(message, error);
  }

  /** Runs a command on the actor queue. */
  run<T>(task: () => T | Promise<T>): Promise<T> {
    return this.queue.run(task);
  }

  idle() {
    return this.queue.idle();
  }

  /** Queues internal work (timers, post-hand steps); failures are logged, never unhandled. */
  private detached(task: () => unknown) {
    this.queue.run(task).catch((error) => this.logError("background task failed", error));
  }

  // ---------------------------------------------------------------------------------------------
  // Lookup helpers
  // ---------------------------------------------------------------------------------------------

  seatOf(userId: string): SeatState | null {
    for (const seat of this.seats.values()) if (seat.userId === userId) return seat;
    return null;
  }

  private requireSeat(userId: string) {
    const seat = this.seatOf(userId);
    if (!seat) fail("NOT_SEATED", "You are not seated at this table.");
    return seat;
  }

  private requireViewer(userId: string) {
    if (![...this.conns.values()].includes(userId)) fail("NOT_JOINED", "Join the table first.");
  }

  private requireOpen() {
    if (this.closing || this.closed) fail("TABLE_CLOSED", "This table is closed.");
  }

  isLive(): boolean {
    return this.hand !== null && !this.hand.engine.isComplete;
  }

  private isDealtIn(userId: string) {
    return this.hand?.dealt.some((d) => d.userId === userId) ?? false;
  }

  private inLiveHand(userId: string) {
    return this.isLive() && this.isDealtIn(userId);
  }

  private nameOf(userId: string) {
    return this.profiles.get(userId)?.displayName ?? this.seatOf(userId)?.profile.displayName ?? "Player";
  }

  private freeSeatCount() {
    return this.settings.maxPlayers - this.seats.size;
  }

  private activeCount() {
    let count = 0;
    for (const seat of this.seats.values()) {
      if (seat.status === "ACTIVE" && seat.stack > 0 && !seat.leaving) count += 1;
    }
    return count;
  }

  isIdle() {
    return this.conns.size === 0 && this.seats.size === 0 && !this.isLive() && this.queue.size === 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------------------------

  addLog(text: string, kind: LogKind) {
    this.logSeq += 1;
    this.log.push({
      id: `${this.id}:${this.logSeq}`,
      handNumber: this.hand && !this.hand.completedAt ? this.hand.number : this.hand?.number ?? null,
      at: new Date(this.now()).toISOString(),
      text,
      kind,
    });
    if (this.log.length > LOG_CAP) this.log.splice(0, this.log.length - LOG_CAP);
  }

  viewFor(userId: string): TableView {
    return buildTableView(this, userId, this.now());
  }

  broadcast(event?: TableEvent | null) {
    if (event !== undefined) this.lastEvent = event;
    this.version += 1;
    const byUser = new Map<string, TableView>();
    for (const [connId, userId] of this.conns) {
      let view = byUser.get(userId);
      if (!view) {
        view = this.viewFor(userId);
        byUser.set(userId, view);
      }
      this.deps.transport.sendState(connId, view);
    }
    this.deps.onSummaryChanged?.(this.id);
  }

  private sendBalance(userId: string, balance: number) {
    this.balances.set(userId, balance);
    this.deps.transport.sendBalance(userId, balance);
  }

  private notifyUser(userId: string, code: string, message: string) {
    for (const [connId, viewer] of this.conns) {
      if (viewer === userId) this.deps.transport.sendError(connId, { tableId: this.id, code, message });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Viewers
  // ---------------------------------------------------------------------------------------------

  join(connId: string, userId: string, options: JoinOptions): Promise<TableView> {
    return this.run(async () => {
      this.requireOpen();
      const seated = this.seatOf(userId) !== null;
      const isHost = this.record.hostUserId === userId;
      const alreadyViewing = [...this.conns.values()].includes(userId);

      if (!seated && !isHost && !alreadyViewing) {
        await this.checkAccess(userId, options);
        if (!this.settings.allowSpectators && this.freeSeatCount() <= 0) {
          fail("SPECTATORS_NOT_ALLOWED", "This table does not allow spectators.");
        }
      }

      if (!this.profiles.has(userId)) {
        const [profile] = await this.deps.lobby.getProfiles([userId]);
        if (profile) this.profiles.set(userId, profile);
      }
      try {
        this.balances.set(userId, await this.deps.wallet.getBalance(userId));
      } catch (error) {
        this.logError("balance lookup failed", error);
      }

      this.conns.set(connId, userId);
      const graceTimer = this.graceTimers.get(userId);
      if (graceTimer) {
        this.clock.clearTimeout(graceTimer);
        this.graceTimers.delete(userId);
      }
      const wasConnected = this.connected.has(userId);
      this.connected.add(userId);
      if (seated && !wasConnected) this.broadcast({ type: "SEAT", seat: this.seatOf(userId)!.seat, action: null, amount: null });
      return this.viewFor(userId);
    });
  }

  private async checkAccess(userId: string, options: JoinOptions) {
    const { visibility, passwordHash, inviteCode } = this.record;
    if (visibility === "PUBLIC" && !passwordHash) return;
    if (inviteCode && options.inviteCode && options.inviteCode === inviteCode) {
      await this.deps.lobby.addMember(this.id, userId);
      return;
    }
    if (await this.deps.lobby.isMember(this.id, userId)) return;
    if (passwordHash) {
      const failures = this.passwordFailures.get(userId);
      if (failures && failures.lockedUntil > this.now()) {
        fail("RATE_LIMITED", "Too many wrong passwords. Try again in a few minutes.");
      }
      if (!options.password) fail("PASSWORD_REQUIRED", "This table needs a password.");
      if (await this.deps.lobby.verifyPassword(options.password, passwordHash)) {
        this.passwordFailures.delete(userId);
        await this.deps.lobby.addMember(this.id, userId);
        return;
      }
      const count = (failures?.count ?? 0) + 1;
      this.passwordFailures.set(userId, {
        count: count >= PASSWORD_MAX_FAILURES ? 0 : count,
        lockedUntil: count >= PASSWORD_MAX_FAILURES ? this.now() + PASSWORD_LOCK_MS : 0,
      });
      fail("INVALID_PASSWORD", "That password is incorrect.");
    }
    // Private table without password: only reachable through the invite link.
    fail("TABLE_NOT_FOUND", "Table not found.");
  }

  /** A connection left the table view (navigation or socket disconnect). Seats stay. */
  detach(connId: string): Promise<void> {
    return this.run(() => {
      const userId = this.conns.get(connId);
      if (!userId) return;
      this.conns.delete(connId);
      if ([...this.conns.values()].includes(userId)) return;
      if (!this.seatOf(userId)) {
        this.connected.delete(userId);
        return;
      }
      if (this.graceTimers.has(userId)) return;
      this.graceTimers.set(
        userId,
        this.clock.setTimeout(() => {
          this.detached(() => {
            this.graceTimers.delete(userId);
            if ([...this.conns.values()].includes(userId)) return;
            this.connected.delete(userId);
            const seat = this.seatOf(userId);
            if (seat) this.broadcast({ type: "SEAT", seat: seat.seat, action: null, amount: null });
          });
        }, this.timings.disconnectGraceMs),
      );
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Seating
  // ---------------------------------------------------------------------------------------------

  sit(userId: string, seatNumber: number, buyIn: number, postNow = false): Promise<void> {
    return this.run(async () => {
      this.requireOpen();
      this.requireViewer(userId);
      if (this.seatOf(userId)) fail("ALREADY_SEATED", "You already have a seat at this table.");
      if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > this.settings.maxPlayers) {
        fail("INVALID_SEAT", "That seat does not exist.");
      }
      if (this.seats.has(seatNumber)) fail("SEAT_TAKEN", "That seat is taken.");
      const { minBuyIn, maxBuyIn } = this.settings;
      if (!Number.isSafeInteger(buyIn) || buyIn < minBuyIn || buyIn > maxBuyIn) {
        fail("INVALID_BUY_IN", `Buy in between ${minBuyIn} and ${maxBuyIn} chips.`);
      }
      const gate = await this.deps.gate.check(userId);
      if (!gate.ok) fail(gate.code, gate.message);

      const seatSessionId = this.deps.rng.uuid();
      let balance: number;
      try {
        balance = await this.deps.wallet.buyIn({
          userId,
          tableId: this.id,
          seat: seatNumber,
          amount: buyIn,
          refKey: `buyin:${this.id}:${userId}:${seatSessionId}`,
        });
      } catch (error) {
        walletErrorToRuntime(error);
      }

      let profile = this.profiles.get(userId);
      if (!profile) {
        [profile] = await this.deps.lobby.getProfiles([userId]);
        profile ??= { userId, username: "player", displayName: "Player", avatarUrl: null };
        this.profiles.set(userId, profile);
      }
      // Join a running game: wait for the big blind unless nobody else can play anyway.
      const gameRunning = this.activeCount() >= 2 && this.hand !== null;
      this.seats.set(seatNumber, {
        seat: seatNumber,
        userId,
        profile,
        stack: buyIn,
        status: gameRunning ? "WAITING_BB" : "ACTIVE",
        sitOutReason: null,
        sitOutSince: null,
        sitOutTimer: null,
        wantsStraddle: false,
        postNow: gameRunning && postNow,
        timeBankMs: this.settings.timeBankSec * 1000,
        handsTowardsBank: 0,
        consecutiveTimeouts: 0,
        leaving: false,
        pendingTopUp: 0,
        seatSessionId,
        topUps: 0,
        missedHand: false,
      });
      this.connected.add(userId);
      this.sendBalance(userId, balance);
      this.addLog(`${profile.displayName} sits in seat ${seatNumber} with ${buyIn}`, "seat");
      this.broadcast({ type: "SEAT", seat: seatNumber, action: null, amount: buyIn });
      this.maybeScheduleNextHand();
    });
  }

  stand(userId: string, reason: "user" | "auto" = "user"): Promise<void> {
    return this.run(async () => {
      const seat = this.seatOf(userId);
      if (!seat) {
        if (reason === "auto") return;
        fail("NOT_SEATED", "You are not seated at this table.");
      }
      await this.standSeat(seat, reason);
    });
  }

  private async standSeat(seat: SeatState, reason: "user" | "auto" | "restricted") {
    if (seat.leaving) return;
    if (this.inLiveHand(seat.userId)) {
      seat.leaving = true;
      this.clearSitOutTimer(seat);
      const hand = this.hand!;
      if (hand.engine.status === "RUNOUT_DECISION") {
        // Folding now would forfeit their claim to the pot: run it once instead and leave after the hand.
        const rit = this.votes.find((v) => v.kind === "RUN_IT_TWICE" && v.status === "OPEN");
        if (rit) this.resolveVote(rit, "FAILED");
        else hand.engine.chooseRunout(1);
        this.addLog(`${seat.profile.displayName} will leave after the hand`, "seat");
        this.afterEngineChange({ type: "SEAT", seat: seat.seat, action: null, amount: null });
        return;
      }
      const folded = hand.engine.foldOutOfTurn(seat.userId);
      this.addLog(
        folded ? `${seat.profile.displayName} folds and leaves the table` : `${seat.profile.displayName} will leave after the hand`,
        "seat",
      );
      this.removeFromVotes(seat.userId);
      this.afterEngineChange({ type: "SEAT", seat: seat.seat, action: folded ? "fold" : null, amount: null });
      return;
    }
    await this.leaveSeatNow(seat, reason === "restricted" ? "Removed from the table (account restriction)" : null);
  }

  /** Pays any nit penalty, cashes out the stack and frees the seat. Only between hands for this player. */
  private async leaveSeatNow(seat: SeatState, note: string | null) {
    const transfers = this.nitPenaltyOnLeave(seat);
    if (transfers.length > 0) {
      await this.recordLateSidePayments(transfers, "NIT_GAME");
    }
    this.nit.participants = this.nit.participants.filter((id) => id !== seat.userId);

    let balance: number;
    try {
      balance = await this.deps.wallet.cashOut({
        userId: seat.userId,
        tableId: this.id,
        amount: seat.stack,
        refKey: `cashout:${this.id}:${seat.userId}:${seat.seatSessionId}`,
        reason: "STAND",
      });
    } catch (error) {
      // Keep the seat (and its chips) rather than lose them; retried on the next stand / shutdown.
      seat.leaving = false;
      this.setSittingOut(seat, "user");
      this.logError("cash out failed", error);
      this.broadcast(null);
      fail("CASH_OUT_FAILED", "Could not cash out right now. Please try again.");
    }
    this.clearSitOutTimer(seat);
    this.seats.delete(seat.seat);
    this.removeFromVotes(seat.userId);
    if (!this.conns.size || ![...this.conns.values()].includes(seat.userId)) this.connected.delete(seat.userId);
    this.sendBalance(seat.userId, balance);
    this.addLog(note ?? `${seat.profile.displayName} leaves the table with ${seat.stack}`, "seat");
    this.broadcast({ type: "SEAT", seat: seat.seat, action: null, amount: seat.stack });
  }

  sitOut(userId: string, sitOut: boolean): Promise<void> {
    return this.run(async () => {
      this.requireOpen();
      const seat = this.requireSeat(userId);
      if (seat.leaving) fail("LEAVING", "You are leaving the table.");
      if (sitOut) {
        if (seat.status === "SITTING_OUT") return;
        this.setSittingOut(seat, "user");
        this.addLog(`${seat.profile.displayName} sits out`, "seat");
        if (this.isLive() && this.hand!.engine.toActPlayerId === userId) {
          this.afterEngineChange({ type: "SEAT", seat: seat.seat, action: null, amount: null });
          return;
        }
        this.broadcast({ type: "SEAT", seat: seat.seat, action: null, amount: null });
        return;
      }
      if (seat.status !== "SITTING_OUT") return;
      if (seat.stack <= 0) fail("REBUY_REQUIRED", "Add chips before sitting back in.");
      const gate = await this.deps.gate.check(userId);
      if (!gate.ok) fail(gate.code, gate.message);
      this.sitIn(seat);
      this.addLog(`${seat.profile.displayName} is back`, "seat");
      this.broadcast({ type: "SEAT", seat: seat.seat, action: null, amount: null });
      this.maybeScheduleNextHand();
    });
  }

  private sitIn(seat: SeatState) {
    this.clearSitOutTimer(seat);
    const othersActive = [...this.seats.values()].filter(
      (s) => s !== seat && s.status === "ACTIVE" && s.stack > 0 && !s.leaving,
    ).length;
    seat.status = seat.missedHand && othersActive >= 2 ? "WAITING_BB" : "ACTIVE";
    seat.sitOutReason = null;
    seat.sitOutSince = null;
    seat.consecutiveTimeouts = 0;
    seat.missedHand = false;
  }

  private setSittingOut(seat: SeatState, reason: Exclude<SeatState["sitOutReason"], null>) {
    seat.status = "SITTING_OUT";
    seat.sitOutReason = reason;
    seat.postNow = false;
    if (seat.sitOutSince === null) seat.sitOutSince = this.now();
    if (!seat.sitOutTimer) {
      const userId = seat.userId;
      seat.sitOutTimer = this.clock.setTimeout(() => {
        this.detached(async () => {
          const current = this.seatOf(userId);
          if (!current || current.status !== "SITTING_OUT") return;
          current.sitOutTimer = null;
          await this.standSeat(current, "auto").catch((error) => this.logError("auto stand failed", error));
        });
      }, this.timings.sitOutAutoStandMs);
    }
  }

  private clearSitOutTimer(seat: SeatState) {
    this.clock.clearTimeout(seat.sitOutTimer);
    seat.sitOutTimer = null;
  }

  rebuy(userId: string, amount: number): Promise<void> {
    return this.run(async () => {
      this.requireOpen();
      const seat = this.requireSeat(userId);
      if (seat.leaving) fail("LEAVING", "You are leaving the table.");
      const { minBuyIn, maxBuyIn } = this.settings;
      const base = seat.stack + seat.pendingTopUp;
      if (!Number.isSafeInteger(amount) || amount < 1) fail("INVALID_AMOUNT", "Enter a whole number of chips.");
      if (base + amount > maxBuyIn) fail("INVALID_AMOUNT", `Your stack can be at most ${maxBuyIn}.`);
      if (base === 0 && amount < minBuyIn) fail("INVALID_AMOUNT", `Buy in at least ${minBuyIn}.`);

      if (this.inLiveHand(userId)) {
        // Applied (and paid) at the next hand boundary; checked again then.
        if ((this.balances.get(userId) ?? Number.POSITIVE_INFINITY) < seat.pendingTopUp + amount) {
          fail("INSUFFICIENT_FUNDS", "Not enough chips in your wallet.");
        }
        seat.pendingTopUp += amount;
        this.addLog(`${seat.profile.displayName} adds ${amount} after this hand`, "seat");
        this.broadcast({ type: "SEAT", seat: seat.seat, action: null, amount });
        return;
      }
      await this.applyTopUp(seat, amount);
      this.broadcast({ type: "SEAT", seat: seat.seat, action: null, amount });
      this.maybeScheduleNextHand();
    });
  }

  private async applyTopUp(seat: SeatState, amount: number) {
    seat.topUps += 1;
    let balance: number;
    try {
      balance = await this.deps.wallet.topUp({
        userId: seat.userId,
        tableId: this.id,
        amount,
        newStack: seat.stack + amount,
        refKey: `rebuy:${this.id}:${seat.userId}:${seat.seatSessionId}:${seat.topUps}`,
      });
    } catch (error) {
      walletErrorToRuntime(error);
    }
    seat.stack += amount;
    this.sendBalance(seat.userId, balance);
    this.addLog(`${seat.profile.displayName} adds ${amount} (stack ${seat.stack})`, "seat");
    if (seat.status === "SITTING_OUT" && seat.sitOutReason === "busted") {
      this.sitIn(seat);
      seat.status = "ACTIVE";
    }
  }

  straddle(userId: string, enabled: boolean): Promise<void> {
    return this.run(() => {
      if (!this.settings.straddle) fail("STRADDLE_DISABLED", "Straddles are off at this table.");
      const seat = this.requireSeat(userId);
      seat.wantsStraddle = enabled;
      this.broadcast(null);
    });
  }

  start(userId: string): Promise<void> {
    return this.run(() => {
      this.requireOpen();
      if (userId !== this.record.hostUserId) fail("NOT_HOST", "Only the host can start the table.");
      const ready = [...this.seats.values()].filter(
        (s) => s.status !== "SITTING_OUT" && s.stack > 0 && !s.leaving,
      ).length;
      if (ready < 2) fail("NOT_ENOUGH_PLAYERS", "At least two seated players are needed.");
      this.started = true;
      this.addLog("The host started the game", "system");
      this.maybeScheduleNextHand();
      this.broadcast(null);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Hands
  // ---------------------------------------------------------------------------------------------

  private canDealCount() {
    return [...this.seats.values()].filter(
      (s) => (s.status === "ACTIVE" || s.status === "WAITING_BB") && s.stack > 0 && !s.leaving,
    ).length;
  }

  maybeScheduleNextHand() {
    if (this.closing || this.closed || this.isLive() || this.nextHandTimer) return;
    if (!this.started) return;
    if (this.canDealCount() < 2) {
      this.nextHandAt = null;
      return;
    }
    const now = this.now();
    let at = now + this.timings.firstHandDelayMs;
    if (this.hand?.completedAt) {
      const extra = this.hand.engine.summary?.showdown ? this.timings.showdownExtraDelayMs : 0;
      at = Math.max(at, this.hand.completedAt + this.timings.nextHandDelayMs + extra);
    }
    this.nextHandAt = at;
    this.nextHandTimer = this.clock.setTimeout(() => {
      this.detached(() => this.startHand());
    }, at - now);
  }

  private async startHand() {
    this.nextHandTimer = null;
    this.nextHandAt = null;
    if (this.closing || this.closed || this.isLive() || !this.started) return;

    // Account restrictions (self-exclusion, cool-off, loss limit): stand those players up.
    for (const seat of [...this.seats.values()]) {
      if (seat.status === "SITTING_OUT" || seat.leaving || seat.stack <= 0) continue;
      const gate = await this.deps.gate.check(seat.userId).catch(() => ({ ok: true }) as const);
      if (!gate.ok) {
        this.notifyUser(seat.userId, gate.code, gate.message);
        await this.standSeat(seat, "restricted").catch((error) => this.logError("restricted stand failed", error));
      }
    }

    const dealt = this.choosePlayers();
    if (!dealt) {
      this.broadcast(null);
      return;
    }
    const { players, extraBlindIds } = dealt;
    let { button } = dealt;
    const settings = this.settings;
    const autoBomb =
      settings.bombPot.enabled &&
      settings.bombPot.everyNHands > 0 &&
      this.handsSinceBomb + 1 >= settings.bombPot.everyNHands;
    const isBomb = settings.bombPot.enabled && (this.bombPotQueued || autoBomb);
    let positions = computePositions(
      players.map((p) => p.seat),
      button,
    );
    if (players.length === 2 && this.lastBigBlindSeat !== null && positions.bigBlindSeat === this.lastBigBlindSeat) {
      // Going heads-up: the last big blind must not post it again; they take the button (small blind).
      button = this.lastBigBlindSeat;
      positions = computePositions(
        players.map((p) => p.seat),
        button,
      );
    }
    let straddleSeat: number | null = null;
    if (!isBomb && settings.straddle && positions.straddleSeat !== null) {
      const candidate = this.seats.get(positions.straddleSeat);
      if (candidate?.wantsStraddle && !extraBlindIds.includes(candidate.userId)) straddleSeat = candidate.seat;
    }

    this.handNumber += 1;
    const handId = this.deps.rng.uuid();
    const config: StartHandConfig = {
      handId,
      variant: settings.variant,
      players: players.map((p) => ({ id: p.userId, seat: p.seat, stack: p.stack })),
      buttonSeat: button,
      smallBlind: settings.smallBlind,
      bigBlind: settings.bigBlind,
      ante: settings.ante,
      straddleSeat,
      bombPot: isBomb ? { ante: settings.bombPot.anteBB * settings.bigBlind, doubleBoard: settings.bombPot.doubleBoard } : null,
      runItTwice: settings.runItTwice && !(settings.variant === "PLO" && players.length > 9),
      extraBlindPlayerIds: isBomb ? [] : extraBlindIds,
    };
    const deck = this.deps.deckProvider?.(this.handNumber) ?? null;
    let engine: PokerHand;
    try {
      engine = PokerHand.start(config, deck ? { deck } : { randomInt: (max) => this.deps.rng.randomInt(max) });
    } catch (error) {
      this.handNumber -= 1;
      this.logError("engine refused to start a hand", error);
      return;
    }
    const state = engine.getState();
    // Shuffle commitment: an independent 16-byte salt per deck position (scheme in shared/hands/deck-proof.ts).
    const reveal = createDeckReveal(state.deck, (bytes) => this.deps.rng.randomHex(bytes));

    this.buttonSeat = button;
    this.lastBigBlindSeat = isBomb ? this.lastBigBlindSeat : positions.bigBlindSeat;
    this.bombPotQueued = false;
    this.handsSinceBomb = isBomb ? 0 : this.handsSinceBomb + 1;

    for (const p of players) {
      const seat = this.seats.get(p.seat)!;
      seat.status = "ACTIVE";
      seat.postNow = false;
      seat.missedHand = false;
      seat.handsTowardsBank += 1;
      if (seat.handsTowardsBank >= this.timings.timeBankReplenishEveryHands) {
        seat.handsTowardsBank = 0;
        seat.timeBankMs = Math.min(settings.timeBankSec * 1000, seat.timeBankMs + this.timings.timeBankReplenishMs);
      }
    }
    for (const seat of this.seats.values()) {
      if (!players.some((p) => p.userId === seat.userId)) seat.missedHand = true;
    }

    // Nit game round begins with the players dealt into this hand.
    if (this.nit.active && !this.nit.roundRunning && players.length >= 2) {
      this.nit.roundRunning = true;
      this.nit.participants = players.map((p) => p.userId);
      this.nit.nits = [...this.nit.participants];
      this.addLog(`Nit game round starts with ${players.length} players`, "side_game");
    }

    this.hand = {
      id: handId,
      number: this.handNumber,
      engine,
      startedAt: this.now(),
      completedAt: null,
      deck: state.deck,
      reveal,
      commitment: deckRevealCommitment(reveal),
      lastSeq: 0,
      dealt: players.map((p) => ({ userId: p.userId, seat: p.seat })),
      positions: positionNames(
        players.map((p) => p.seat),
        button,
      ),
      bountyActive: this.bountyActive && settings.variant === "NLHE",
      nitRound: this.nit.active && this.nit.roundRunning,
      clock: { token: null, actorId: null, deadline: null, usingBank: false, bankStartedAt: null, timer: null },
      shown: new Map(),
      result: null,
      sidePayments: [],
      bountyClaimableBy: null,
      persisted: false,
    };
    this.addLog(
      `Hand #${this.handNumber}${isBomb ? " (bomb pot)" : ""} - button seat ${button}`,
      "deal",
    );
    this.afterEngineChange({ type: "HAND_START", seat: button, action: null, amount: null });
  }

  /** Dealt-in players for the next hand and the new button, or null when fewer than two can play. */
  private choosePlayers() {
    const eligible = [...this.seats.values()].filter((s) => s.stack > 0 && !s.leaving && s.status !== "SITTING_OUT");
    let active = eligible.filter((s) => s.status === "ACTIVE");
    const waiting = eligible.filter((s) => s.status === "WAITING_BB");
    if (active.length < 2) {
      active = eligible;
      for (const seat of waiting) seat.status = "ACTIVE";
      if (active.length < 2) return null;
      const seats = active.map((s) => s.seat).sort((a, b) => a - b);
      const button =
        this.buttonSeat === null ? seats[this.deps.rng.randomInt(seats.length)]! : nextSeat(seats, this.buttonSeat);
      return { players: active, button, extraBlindIds: [] as string[] };
    }
    const activeSeats = active.map((s) => s.seat).sort((a, b) => a - b);
    const button = this.buttonSeat === null ? activeSeats[0]! : nextSeat(activeSeats, this.buttonSeat);
    const players = [...active];
    const extraBlindIds: string[] = [];
    for (const candidate of waiting.sort((a, b) => a.seat - b.seat)) {
      const seats = [...players, candidate].map((s) => s.seat);
      const positions = computePositions(seats, button);
      if (positions.bigBlindSeat === candidate.seat) {
        players.push(candidate);
      } else if (candidate.postNow) {
        players.push(candidate);
        if (positions.smallBlindSeat !== candidate.seat) extraBlindIds.push(candidate.userId);
      }
    }
    // Waiting players can shift the blinds: only keep extra blinds for players not in the blinds now.
    const finalPositions = computePositions(
      players.map((s) => s.seat),
      button,
    );
    const finalExtra = extraBlindIds.filter((id) => {
      const seat = players.find((p) => p.userId === id)!.seat;
      return seat !== finalPositions.smallBlindSeat && seat !== finalPositions.bigBlindSeat;
    });
    return { players, button, extraBlindIds: finalExtra };
  }

  action(userId: string, handId: string, type: ActionType, amount?: number): Promise<void> {
    return this.run(() => {
      const hand = this.hand;
      if (!hand || hand.id !== handId) fail("STALE_HAND", "That hand is over.");
      if (hand.engine.isComplete) fail("HAND_COMPLETE", "The hand is over.");
      if (hand.engine.toActPlayerId !== userId) fail("NOT_YOUR_TURN", "It is not your turn.");
      const seat = this.requireSeat(userId);
      let request: { type: ActionType; amount?: number } = amount === undefined ? { type } : { type, amount };
      if (type === "allin") {
        // An all-in that cannot be a raise is a call (the engine rejects it otherwise).
        const legal = hand.engine.legalActions(userId);
        if (legal && !legal.canBetOrRaise && legal.callAmount > 0) request = { type: "call" };
      }
      try {
        hand.engine.act(userId, request);
      } catch (error) {
        engineErrorToRuntime(error);
      }
      if (hand.clock.usingBank && hand.clock.bankStartedAt !== null) {
        seat.timeBankMs = Math.max(0, seat.timeBankMs - (this.now() - hand.clock.bankStartedAt));
      }
      seat.consecutiveTimeouts = 0;
      const last = hand.engine.events.filter((e) => e.type === "ACTION").at(-1);
      this.afterEngineChange({
        type: "ACTION",
        seat: seat.seat,
        action: last?.type === "ACTION" ? (last.allIn ? "allin" : last.action) : type,
        amount: last?.type === "ACTION" ? last.to : null,
      });
    });
  }

  /** Processes new engine events, then arms the clock, opens the RIT vote or settles the hand. */
  private afterEngineChange(event: TableEvent | null) {
    const hand = this.hand;
    if (!hand) return;
    let lastEvent = event;
    for (let guard = 0; guard < 64; guard += 1) {
      lastEvent = this.consumeEngineEvents(hand) ?? lastEvent;
      if (hand.engine.isComplete) {
        this.settleHand(hand);
        lastEvent = { type: "HAND_END", seat: null, action: null, amount: hand.engine.summary?.totalPot ?? null };
        break;
      }
      if (hand.engine.status === "RUNOUT_DECISION") {
        this.clearTurnClock(hand);
        this.openRunItTwiceVote(hand);
        break;
      }
      const actorId = hand.engine.toActPlayerId;
      const actor = actorId ? this.seatOf(actorId) : null;
      if (actor && (actor.status === "SITTING_OUT" || actor.leaving)) {
        // Away players check/fold instantly instead of burning the clock.
        hand.engine.timeout();
        continue;
      }
      this.armTurnClock(hand);
      break;
    }
    this.broadcast(lastEvent);
  }

  private consumeEngineEvents(hand: ActiveHand): TableEvent | null {
    const events = hand.engine.eventsSince(hand.lastSeq + 1);
    let last: TableEvent | null = null;
    for (const event of events) {
      hand.lastSeq = event.seq;
      last = this.describeEvent(hand, event) ?? last;
    }
    return last;
  }

  private describeEvent(hand: ActiveHand, event: HandEvent): TableEvent | null {
    const name = (id: string) => this.nameOf(id);
    switch (event.type) {
      case "POST": {
        const labels: Record<string, string> = {
          ANTE: "posts ante",
          BOMB_POT_ANTE: "posts bomb pot ante",
          SMALL_BLIND: "posts small blind",
          BIG_BLIND: "posts big blind",
          EXTRA_BLIND: "posts a big blind",
          STRADDLE: "straddles",
        };
        this.addLog(`${name(event.playerId)} ${labels[event.kind] ?? "posts"} ${event.amount}${event.allIn ? " (all-in)" : ""}`, "action");
        return null;
      }
      case "ACTION": {
        const who = name(event.playerId);
        const suffix = event.reason === "timeout" ? " (timed out)" : event.reason === "left" ? " (left)" : "";
        const text =
          event.action === "fold"
            ? `${who} folds`
            : event.action === "check"
              ? `${who} checks`
              : event.action === "call"
                ? `${who} calls ${event.amount}`
                : `${who} ${event.action === "bet" ? "bets" : "raises to"} ${event.to}`;
        this.addLog(`${text}${event.allIn ? " (all-in)" : ""}${suffix}`, "action");
        return {
          type: event.reason === "timeout" ? "TIMEOUT" : "ACTION",
          seat: event.seat,
          action: event.allIn ? "allin" : event.action,
          amount: event.action === "bet" || event.action === "raise" ? event.to : event.amount,
        };
      }
      case "STREET": {
        const label = event.street.charAt(0) + event.street.slice(1).toLowerCase();
        const board = hand.engine.boards.length > 1 ? ` (board ${event.boardIndex + 1})` : "";
        this.addLog(`${label}${board}: ${cardText(event.board)}`, "deal");
        return { type: "STREET", seat: null, action: null, amount: null };
      }
      case "UNCALLED_RETURN":
        this.addLog(`${event.amount} returned to ${name(event.playerId)}`, "action");
        return null;
      case "RUNOUT_DECISION":
        for (const playerId of event.playerIds) {
          const player = hand.engine.getPlayer(playerId);
          if (player) hand.shown.set(playerId, { cards: player.holeCards.slice(), handName: null });
        }
        return { type: "SHOWDOWN", seat: null, action: null, amount: null };
      case "RUNOUT":
        if (event.runs === 2) this.addLog("Running it twice", "deal");
        return null;
      case "SHOWDOWN": {
        for (const shown of event.hands) {
          if (!shown.mustShow) continue;
          const handName = shown.boards[0]?.name ?? null;
          hand.shown.set(shown.playerId, { cards: shown.cards.slice(), handName });
          this.addLog(`${name(shown.playerId)} shows ${cardText(shown.cards)}${handName ? ` (${handName})` : ""}`, "showdown");
        }
        return { type: "SHOWDOWN", seat: null, action: null, amount: null };
      }
      case "POT_AWARD": {
        const potLabel = event.potIndex === 0 ? "the main pot" : `side pot ${event.potIndex}`;
        const boardLabel = hand.engine.boards.length > 1 ? ` on board ${event.boardIndex + 1}` : "";
        for (const winner of event.winners) {
          this.addLog(
            `${name(winner.playerId)} wins ${winner.amount} from ${potLabel}${boardLabel}${winner.handName ? ` with ${winner.handName}` : ""}`,
            "award",
          );
        }
        return null;
      }
      default:
        return null;
    }
  }

  // ---- Action clock --------------------------------------------------------------------------

  private clearTurnClock(hand: ActiveHand) {
    this.clock.clearTimeout(hand.clock.timer);
    hand.clock = { token: null, actorId: null, deadline: null, usingBank: false, bankStartedAt: null, timer: null };
  }

  private armTurnClock(hand: ActiveHand) {
    const actorId = hand.engine.toActPlayerId;
    const token = `${hand.id}:${hand.lastSeq}:${actorId}`;
    if (hand.clock.token === token) return;
    this.clearTurnClock(hand);
    if (!actorId) return;
    const deadline = this.now() + this.settings.actionTimeSec * 1000;
    hand.clock = {
      token,
      actorId,
      deadline,
      usingBank: false,
      bankStartedAt: null,
      timer: this.clock.setTimeout(() => {
        this.detached(() => this.onTurnTimer(token));
      }, deadline - this.now()),
    };
  }

  private onTurnTimer(token: string) {
    const hand = this.hand;
    if (!hand || hand.clock.token !== token || hand.engine.isComplete) return;
    const seat = this.seatOf(hand.clock.actorId!);
    if (seat && !hand.clock.usingBank && seat.timeBankMs > 0) {
      const now = this.now();
      hand.clock.usingBank = true;
      hand.clock.bankStartedAt = now;
      hand.clock.deadline = now + seat.timeBankMs;
      hand.clock.timer = this.clock.setTimeout(() => {
        this.detached(() => this.onTurnTimer(token));
      }, seat.timeBankMs);
      this.broadcast({ type: "TIMEOUT", seat: seat.seat, action: null, amount: null });
      return;
    }
    if (seat) {
      if (hand.clock.usingBank) seat.timeBankMs = 0;
      seat.consecutiveTimeouts += 1;
    }
    this.clearTurnClock(hand);
    hand.engine.timeout();
    if (seat && seat.consecutiveTimeouts >= this.timings.autoSitOutAfterTimeouts && seat.status !== "SITTING_OUT") {
      this.setSittingOut(seat, "timeout");
      this.addLog(`${seat.profile.displayName} is sitting out (timed out)`, "seat");
    }
    this.afterEngineChange(null);
  }

  // ---- Settlement ----------------------------------------------------------------------------

  private settleHand(hand: ActiveHand) {
    if (hand.completedAt !== null) return;
    this.clearTurnClock(hand);
    this.closeVote("RUN_IT_TWICE", "FAILED");
    const summary = hand.engine.summary!;
    const now = this.now();
    hand.completedAt = now;

    const stacks = new Map<string, number>();
    for (const player of summary.players) stacks.set(player.id, player.endingStack);
    const transfers: Array<Transfer & { reason: SidePayment["reason"] }> = [];

    // 7-2 bounty
    if (hand.bountyActive) {
      const bounty = this.settings.bountyGame.bountyBB * this.settings.bigBlind;
      for (const player of summary.players) {
        if (player.won <= 0 || !isSevenDeuce(player.holeCards)) continue;
        if (hand.shown.has(player.id)) {
          const payouts = bountyTransfers(
            { userId: player.id, seat: player.seat, stack: stacks.get(player.id)! },
            summary.players.map((p) => ({ userId: p.id, seat: p.seat, stack: stacks.get(p.id)! })),
            bounty,
          );
          applyTransfers(stacks, payouts);
          transfers.push(...payouts.map((t) => ({ ...t, reason: "BOUNTY_7_2" as const })));
        } else if (!summary.showdown) {
          hand.bountyClaimableBy = player.id;
        }
      }
    }

    // Nit game
    if (hand.nitRound && this.nit.active && this.nit.roundRunning) {
      const safe = summary.players.filter((p) => p.won > 0).map((p) => p.id);
      this.nit.nits = this.nit.nits.filter((id) => !safe.includes(id));
      for (const id of safe) {
        if (this.nit.participants.includes(id)) this.addLog(`${this.nameOf(id)} is safe (nit game)`, "side_game");
      }
      if (this.nit.nits.length === 1) {
        const payerId = this.nit.nits[0]!;
        const payerSeat = this.seatOf(payerId);
        if (payerSeat) {
          const penalty = this.settings.nitGame.penaltyBB * this.settings.bigBlind;
          const recipients = this.nit.participants
            .filter((id) => id !== payerId)
            .map((id) => this.seatOf(id))
            .filter((s): s is SeatState => s !== null)
            .map((s) => ({ userId: s.userId, seat: s.seat, stack: stacks.get(s.userId) ?? s.stack }));
          for (const r of recipients) if (!stacks.has(r.userId)) stacks.set(r.userId, r.stack);
          if (!stacks.has(payerId)) stacks.set(payerId, payerSeat.stack);
          const payouts = nitPenaltyTransfers(
            { userId: payerId, seat: payerSeat.seat, stack: stacks.get(payerId)! },
            recipients,
            penalty,
          );
          applyTransfers(stacks, payouts);
          transfers.push(...payouts.map((t) => ({ ...t, reason: "NIT_GAME" as const })));
          this.addLog(`${this.nameOf(payerId)} is the last nit and pays ${penalty} to each player`, "side_game");
        }
        this.endNitRound();
      } else if (this.nit.nits.length === 0) {
        this.addLog("Nit game round ends: nobody left to pay", "side_game");
        this.endNitRound();
      }
    }

    const sidePayments: SidePayment[] = transfers.map((t) => ({
      fromSeat: t.fromSeat,
      toSeat: t.toSeat,
      amount: t.amount,
      reason: t.reason,
      fromUserId: t.fromUserId,
      toUserId: t.toUserId,
    }));
    for (const payment of sidePayments) {
      this.addLog(
        `${this.nameOf(payment.fromUserId)} pays ${payment.amount} to ${this.nameOf(payment.toUserId)} (${payment.reason === "NIT_GAME" ? "nit game" : "7-2 bounty"})`,
        "side_game",
      );
    }
    hand.sidePayments = sidePayments;

    // Apply results to seats.
    for (const [userId, stack] of stacks) {
      const seat = this.seatOf(userId);
      if (seat) seat.stack = stack;
    }
    for (const { userId } of hand.dealt) {
      const seat = this.seatOf(userId);
      if (seat && seat.stack === 0 && !seat.leaving) {
        this.setSittingOut(seat, "busted");
        this.addLog(`${seat.profile.displayName} is out of chips`, "seat");
        this.notifyUser(userId, "BUSTED", "You are out of chips. Rebuy to keep playing.");
      }
    }

    hand.result = this.buildResult(hand, summary);
    this.recentHands.push({ at: now, pot: summary.totalPot });
    if (this.recentHands.length > RECENT_HANDS) this.recentHands.shift();

    const record = this.buildHandRecord(hand, summary);
    this.detached(() => this.finalizeHand(hand, record));
  }

  private endNitRound() {
    this.nit.roundRunning = false;
    this.nit.participants = [];
    this.nit.nits = [];
  }

  private buildResult(hand: ActiveHand, summary: HandSummary): HandResultView {
    const winners: HandResultView["winners"] = [];
    let uncalledReturn: HandResultView["uncalledReturn"] = null;
    for (const event of hand.engine.events) {
      if (event.type === "POT_AWARD") {
        for (const winner of event.winners) {
          winners.push({
            seat: winner.seat,
            userId: winner.playerId,
            amount: winner.amount,
            potIndex: event.potIndex,
            boardIndex: event.boardIndex,
            handName: winner.handName,
          });
        }
      } else if (event.type === "UNCALLED_RETURN") {
        uncalledReturn = { seat: event.seat, amount: event.amount };
      }
    }
    void summary;
    return {
      winners,
      shown: this.shownList(hand),
      uncalledReturn,
      sidePayments: hand.sidePayments.map(({ fromSeat, toSeat, amount, reason }) => ({ fromSeat, toSeat, amount, reason })),
    };
  }

  shownList(hand: ActiveHand) {
    return [...hand.shown.entries()].map(([userId, shown]) => ({
      seat: hand.dealt.find((d) => d.userId === userId)?.seat ?? 0,
      cards: publicCards(shown.cards),
      handName: shown.handName,
    }));
  }

  private buildHandRecord(hand: ActiveHand, summary: HandSummary): HandRecord {
    const mustShow = new Set(summary.players.filter((p) => p.mustShow).map((p) => p.id));
    const positions: Record<string, string> = {};
    for (const p of summary.players) positions[p.id] = hand.positions.get(p.seat) ?? "?";
    return {
      handId: hand.id,
      tableId: this.id,
      handNumber: hand.number,
      startedAt: new Date(hand.startedAt),
      endedAt: new Date(hand.completedAt ?? this.now()),
      summary,
      events: hand.engine.events,
      sidePayments: hand.sidePayments.slice(),
      shownPlayerIds: [...hand.shown.keys()].filter((id) => !mustShow.has(id)),
      deckCommitment: hand.commitment,
      deckReveal: { v: 2, cards: hand.reveal.cards.slice(), salts: hand.reveal.salts.slice() },
      positions,
      stacks: [...this.seats.values()].map((s) => ({ userId: s.userId, stack: s.stack })),
    };
  }

  /** Queued right after settlement: persists the hand, then cashes out leavers and applies top-ups. */
  private async finalizeHand(hand: ActiveHand, record: HandRecord) {
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
      try {
        await this.deps.hands.saveHand(record);
        saved = true;
      } catch (error) {
        this.logError(`saving hand #${record.handNumber} failed (attempt ${attempt + 1})`, error);
      }
    }
    hand.persisted = saved;
    // Never amend an older hand with payments that belong to this one.
    this.lastPersistedHandId = saved ? hand.id : null;

    for (const seat of [...this.seats.values()]) {
      if (seat.leaving) {
        await this.leaveSeatNow(seat, null).catch((error) => this.logError("cash out after hand failed", error));
      }
    }
    for (const seat of [...this.seats.values()]) {
      if (seat.pendingTopUp > 0) {
        const amount = Math.min(seat.pendingTopUp, this.settings.maxBuyIn - seat.stack);
        seat.pendingTopUp = 0;
        if (amount > 0) {
          await this.applyTopUp(seat, amount).catch((error) => {
            this.notifyUser(seat.userId, error instanceof RuntimeError ? error.code : "REBUY_FAILED", "Your top-up failed.");
          });
        }
      }
    }
    this.maybeScheduleNextHand();
    this.broadcast(null);
  }

  // ---- Showing cards / late side payments ----------------------------------------------------

  show(userId: string, handId: string): Promise<void> {
    return this.run(async () => {
      const hand = this.hand;
      if (!hand || hand.id !== handId) fail("STALE_HAND", "That hand is over.");
      if (!hand.completedAt) fail("HAND_IN_PROGRESS", "You can show your cards after the hand.");
      if (!this.isDealtIn(userId)) fail("NOT_IN_HAND", "You were not dealt into this hand.");
      if (hand.shown.has(userId)) return;
      const summaryPlayer = hand.engine.summary!.players.find((p) => p.id === userId)!;
      hand.shown.set(userId, { cards: summaryPlayer.holeCards.slice(), handName: summaryPlayer.hands[0]?.name ?? null });
      this.addLog(`${this.nameOf(userId)} shows ${cardText(summaryPlayer.holeCards)}`, "showdown");

      let payouts: Transfer[] = [];
      if (hand.bountyClaimableBy === userId && hand.bountyActive) {
        hand.bountyClaimableBy = null;
        const winnerSeat = this.seatOf(userId);
        if (winnerSeat) {
          const payers = hand.dealt
            .filter((d) => d.userId !== userId)
            .map((d) => this.seatOf(d.userId))
            .filter((s): s is SeatState => s !== null && !s.leaving)
            .map((s) => ({ userId: s.userId, seat: s.seat, stack: s.stack }));
          payouts = bountyTransfers(
            { userId, seat: winnerSeat.seat, stack: winnerSeat.stack },
            payers,
            this.settings.bountyGame.bountyBB * this.settings.bigBlind,
          );
          if (payouts.length > 0) this.addLog(`${this.nameOf(userId)} claims the 7-2 bounty`, "side_game");
        }
      }
      await this.recordLateSidePayments(payouts, "BOUNTY_7_2", hand.persisted ? [userId] : []);
      if (hand.result) hand.result.shown = this.shownList(hand);
      this.broadcast({ type: "SHOWDOWN", seat: summaryPlayer.seat, action: null, amount: null });
    });
  }

  private nitPenaltyOnLeave(seat: SeatState): Transfer[] {
    if (!this.nit.active || !this.nit.roundRunning || !this.nit.nits.includes(seat.userId)) return [];
    const recipients = this.nit.participants
      .filter((id) => id !== seat.userId)
      .map((id) => this.seatOf(id))
      .filter((s): s is SeatState => s !== null && !s.leaving)
      .map((s) => ({ userId: s.userId, seat: s.seat, stack: s.stack }));
    const payouts = nitPenaltyTransfers(
      { userId: seat.userId, seat: seat.seat, stack: seat.stack },
      recipients,
      this.settings.nitGame.penaltyBB * this.settings.bigBlind,
    );
    this.addLog(`${seat.profile.displayName} leaves as a nit and pays the penalty`, "side_game");
    this.nit.nits = this.nit.nits.filter((id) => id !== seat.userId);
    if (this.nit.nits.length <= 1) {
      this.addLog("Nit game round ends", "side_game");
      this.endNitRound();
    }
    return payouts;
  }

  /**
   * Side payments (and voluntary shows) between hands: applied to seat stacks and persisted as an amendment
   * of the last saved hand. In-memory stacks stay authoritative if the write fails (the next hand save or
   * cash out persists them).
   */
  private async recordLateSidePayments(transfers: Transfer[], reason: SidePayment["reason"], shownPlayerIds: string[] = []) {
    if (transfers.length === 0 && shownPlayerIds.length === 0) return;
    const stacks = new Map<string, number>();
    for (const seat of this.seats.values()) stacks.set(seat.userId, seat.stack);
    applyTransfers(stacks, transfers);
    const payments: SidePayment[] = transfers.map((t) => ({
      fromSeat: t.fromSeat,
      toSeat: t.toSeat,
      amount: t.amount,
      reason,
      fromUserId: t.fromUserId,
      toUserId: t.toUserId,
    }));
    const affected = new Set(payments.flatMap((p) => [p.fromUserId, p.toUserId]));
    try {
      await this.deps.hands.amendHand({
        tableId: this.id,
        handId: this.lastPersistedHandId,
        payments,
        shownPlayerIds,
        stacks: [...affected].map((userId) => ({ userId, stack: stacks.get(userId)! })),
        at: new Date(this.now()),
      });
    } catch (error) {
      this.logError("saving side payments failed", error);
    }
    for (const [userId, stack] of stacks) {
      const seat = this.seatOf(userId);
      if (seat) seat.stack = stack;
    }
    const hand = this.hand;
    if (hand?.completedAt && hand.id === this.lastPersistedHandId && payments.length > 0) {
      hand.sidePayments.push(...payments);
      if (hand.result) {
        hand.result.sidePayments.push(...payments.map(({ fromSeat, toSeat, amount, reason: r }) => ({ fromSeat, toSeat, amount, reason: r })));
      }
    }
    for (const payment of payments) {
      this.addLog(
        `${this.nameOf(payment.fromUserId)} pays ${payment.amount} to ${this.nameOf(payment.toUserId)} (${reason === "NIT_GAME" ? "nit game" : "7-2 bounty"})`,
        "side_game",
      );
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Votes
  // ---------------------------------------------------------------------------------------------

  private kindEnabled(kind: VoteKind) {
    const s = this.settings;
    if (kind === "BOMB_POT") return s.bombPot.enabled;
    if (kind === "NIT_GAME") return s.nitGame.enabled;
    if (kind === "BOUNTY_GAME") return s.bountyGame.enabled;
    return false;
  }

  private voteRuleFor(kind: VoteKind) {
    if (kind === "BOMB_POT") return this.settings.bombPot.voteRule;
    if (kind === "NIT_GAME") return this.settings.nitGame.voteRule;
    if (kind === "BOUNTY_GAME") return this.settings.bountyGame.voteRule;
    return "unanimous" as const;
  }

  private voteEligibleIds() {
    return [...this.seats.values()].filter((s) => s.status !== "SITTING_OUT" && !s.leaving).map((s) => s.userId);
  }

  propose(userId: string, kind: VoteKind, action: "START" | "STOP"): Promise<void> {
    return this.run(() => {
      this.requireOpen();
      if (kind === "RUN_IT_TWICE") fail("INVALID_VOTE", "Run it twice is offered automatically.");
      if (!this.kindEnabled(kind)) fail("VOTE_DISABLED", "That side game is off at this table.");
      const seat = this.requireSeat(userId);
      const eligible = this.voteEligibleIds();
      if (!eligible.includes(userId)) fail("NOT_ELIGIBLE", "Sit in to propose a vote.");
      if (this.votes.some((v) => v.kind === kind && v.status === "OPEN")) fail("VOTE_OPEN", "A vote on that is already open.");
      const cooldownUntil = this.voteCooldowns.get(`${userId}:${kind}`) ?? 0;
      if (cooldownUntil > this.now()) {
        fail("VOTE_COOLDOWN", `Wait ${Math.ceil((cooldownUntil - this.now()) / 1000)}s before proposing that again.`);
      }
      const active =
        kind === "BOMB_POT" ? this.bombPotQueued : kind === "NIT_GAME" ? this.nit.active : this.bountyActive;
      if (action === "START" && active) fail("ALREADY_ACTIVE", kind === "BOMB_POT" ? "A bomb pot is already queued." : "That game is already running.");
      if (action === "STOP" && !active) fail("NOT_ACTIVE", "That is not running.");

      const vote = this.createVote(kind, action, userId, seat.profile.displayName, this.voteRuleFor(kind), eligible, this.timings.voteMs);
      vote.yesUserIds.push(userId);
      const label = kind === "BOMB_POT" ? "a bomb pot" : kind === "NIT_GAME" ? "the nit game" : "the 7-2 bounty";
      this.addLog(`${seat.profile.displayName} proposes to ${action === "START" ? "start" : "stop"} ${label}`, "vote");
      this.evaluate(vote, false);
      this.broadcast({ type: "VOTE", seat: seat.seat, action: null, amount: null });
    });
  }

  vote(userId: string, voteId: string, yes: boolean): Promise<void> {
    return this.run(() => {
      const vote = this.votes.find((v) => v.id === voteId);
      if (!vote || vote.status !== "OPEN") fail("VOTE_CLOSED", "That vote is closed.");
      if (!vote.eligibleUserIds.includes(userId)) fail("NOT_ELIGIBLE", "You cannot vote on this.");
      vote.yesUserIds = vote.yesUserIds.filter((id) => id !== userId);
      vote.noUserIds = vote.noUserIds.filter((id) => id !== userId);
      (yes ? vote.yesUserIds : vote.noUserIds).push(userId);
      this.evaluate(vote, false);
      const seat = this.seatOf(userId);
      if (vote.kind === "RUN_IT_TWICE" && vote.status !== "OPEN") {
        this.afterEngineChange({ type: "VOTE", seat: seat?.seat ?? null, action: null, amount: null });
        return;
      }
      this.broadcast({ type: "VOTE", seat: seat?.seat ?? null, action: null, amount: null });
    });
  }

  private createVote(
    kind: VoteKind,
    action: "START" | "STOP",
    proposerId: string,
    proposerName: string,
    rule: "majority" | "unanimous",
    eligible: string[],
    durationMs: number,
  ): VoteState {
    const now = this.now();
    const vote: VoteState = {
      id: this.deps.rng.uuid(),
      kind,
      action,
      proposedByUserId: proposerId,
      proposedByName: proposerName,
      rule,
      eligibleUserIds: eligible,
      yesUserIds: [],
      noUserIds: [],
      status: "OPEN",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + durationMs).toISOString(),
      createdAtMs: now,
      expiresAtMs: now + durationMs,
      resolvedAtMs: null,
      timer: null,
    };
    vote.timer = this.clock.setTimeout(() => {
      this.detached(() => {
        if (vote.status !== "OPEN") return;
        this.evaluate(vote, true);
        if (vote.kind === "RUN_IT_TWICE") this.afterEngineChange({ type: "VOTE", seat: null, action: null, amount: null });
        else this.broadcast({ type: "VOTE", seat: null, action: null, amount: null });
      });
    }, durationMs);
    this.votes.push(vote);
    return vote;
  }

  private evaluate(vote: VoteState, expired: boolean) {
    if (vote.status !== "OPEN") return;
    const eligible = vote.eligibleUserIds;
    const outcome = evaluateVote(
      vote.rule,
      {
        eligible: eligible.length,
        yes: vote.yesUserIds.filter((id) => eligible.includes(id)).length,
        no: vote.noUserIds.filter((id) => eligible.includes(id)).length,
      },
      expired,
    );
    if (outcome === "OPEN") return;
    this.resolveVote(vote, outcome);
  }

  private resolveVote(vote: VoteState, outcome: "PASSED" | "FAILED") {
    vote.status = outcome;
    vote.resolvedAtMs = this.now();
    this.clock.clearTimeout(vote.timer);
    vote.timer = this.clock.setTimeout(() => {
      this.detached(() => {
        this.votes = this.votes.filter((v) => v !== vote);
        this.broadcast(null);
      });
    }, this.timings.resolvedVoteVisibleMs);

    if (vote.kind === "RUN_IT_TWICE") {
      const hand = this.hand;
      if (hand && hand.engine.status === "RUNOUT_DECISION") {
        hand.engine.chooseRunout(outcome === "PASSED" ? 2 : 1);
        this.addLog(outcome === "PASSED" ? "Everyone agreed to run it twice" : "Running it once", "vote");
      }
      return;
    }
    if (outcome === "FAILED") {
      this.voteCooldowns.set(`${vote.proposedByUserId}:${vote.kind}`, this.now() + this.timings.voteCooldownMs);
      this.addLog(`Vote failed`, "vote");
      return;
    }
    const start = vote.action === "START";
    if (vote.kind === "BOMB_POT") {
      this.bombPotQueued = start;
      this.addLog(start ? "Vote passed: the next hand is a bomb pot" : "Vote passed: bomb pot cancelled", "vote");
    } else if (vote.kind === "NIT_GAME") {
      this.nit = { active: start, roundRunning: false, participants: [], nits: [] };
      this.addLog(start ? "Vote passed: nit game starts next hand" : "Vote passed: nit game stopped", "vote");
    } else if (vote.kind === "BOUNTY_GAME") {
      this.bountyActive = start;
      this.addLog(start ? "Vote passed: 7-2 bounty is on from the next hand" : "Vote passed: 7-2 bounty is off", "vote");
    }
  }

  private closeVote(kind: VoteKind, outcome: "PASSED" | "FAILED") {
    for (const vote of this.votes) {
      if (vote.kind === kind && vote.status === "OPEN") {
        vote.status = outcome;
        vote.resolvedAtMs = this.now();
        this.clock.clearTimeout(vote.timer);
        vote.timer = null;
        this.votes = this.votes.filter((v) => v !== vote);
      }
    }
  }

  private openRunItTwiceVote(hand: ActiveHand) {
    if (this.votes.some((v) => v.kind === "RUN_IT_TWICE" && v.status === "OPEN")) return;
    const eligible = hand.engine.runoutDecisionPlayerIds();
    this.createVote("RUN_IT_TWICE", "START", SYSTEM_USER, "Dealer", "unanimous", eligible, this.timings.ritVoteMs);
    this.addLog("All in: run it twice? Everyone must agree", "vote");
  }

  private removeFromVotes(userId: string) {
    for (const vote of this.votes) {
      if (vote.status !== "OPEN" || vote.kind === "RUN_IT_TWICE") continue;
      if (!vote.eligibleUserIds.includes(userId)) continue;
      vote.eligibleUserIds = vote.eligibleUserIds.filter((id) => id !== userId);
      vote.yesUserIds = vote.yesUserIds.filter((id) => id !== userId);
      vote.noUserIds = vote.noUserIds.filter((id) => id !== userId);
      if (vote.eligibleUserIds.length === 0) this.resolveVote(vote, "FAILED");
      else this.evaluate(vote, false);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------------------------

  chat(userId: string, text: string | undefined, emoteId: string | undefined): Promise<void> {
    return this.run(() => {
      this.requireOpen();
      this.requireViewer(userId);
      if (!this.settings.chatEnabled) fail("CHAT_DISABLED", "Chat is off at this table.");
      const clean = text ? maskProfanity(cleanChatText(text)).slice(0, 200) : "";
      if (!clean && !emoteId) fail("EMPTY_MESSAGE", "Message is empty.");
      const message: ChatMessage = {
        id: this.deps.rng.uuid(),
        tableId: this.id,
        userId,
        displayName: this.nameOf(userId),
        text: clean || null,
        emoteId: emoteId ?? null,
        sentAt: new Date(this.now()).toISOString(),
      };
      this.deps.transport.sendChat([...this.conns.keys()], message);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Closing / shutdown
  // ---------------------------------------------------------------------------------------------

  /** Host closes the table: void any hand in progress and refund every stack. */
  close(userId: string): Promise<void> {
    return this.run(async () => {
      if (userId !== this.record.hostUserId) fail("NOT_HOST", "Only the host can close the table.");
      await this.shutdownNow("The host closed the table");
    });
  }

  /**
   * Stops the table: no new hands, a hand in progress is voided (seat stacks still hold the pre-hand
   * amounts persisted at the last boundary), every stack is cashed out.
   */
  shutdown(reason = "The server is restarting"): Promise<void> {
    return this.run(() => this.shutdownNow(reason));
  }

  private async shutdownNow(reason: string) {
    if (this.closed) return;
    this.closing = true;
    this.clock.clearTimeout(this.nextHandTimer);
    this.nextHandTimer = null;
    this.nextHandAt = null;
    for (const vote of this.votes) this.clock.clearTimeout(vote.timer);
    this.votes = [];
    for (const timer of this.graceTimers.values()) this.clock.clearTimeout(timer);
    this.graceTimers.clear();
    if (this.hand && !this.hand.engine.isComplete) {
      this.clearTurnClock(this.hand);
      this.addLog(`Hand #${this.hand.number} voided: chips returned`, "system");
      this.hand = null;
    }
    let failures = 0;
    for (const seat of [...this.seats.values()]) {
      this.clearSitOutTimer(seat);
      try {
        const balance = await this.deps.wallet.cashOut({
          userId: seat.userId,
          tableId: this.id,
          amount: seat.stack,
          refKey: `cashout:${this.id}:${seat.userId}:${seat.seatSessionId}`,
          reason: "SHUTDOWN",
        });
        this.seats.delete(seat.seat);
        this.sendBalance(seat.userId, balance);
      } catch (error) {
        failures += 1;
        this.logError("refund on shutdown failed (recovered on next boot)", error);
      }
    }
    this.addLog(reason, "system");
    this.closed = failures === 0;
    this.broadcast(null);
  }

  // ---------------------------------------------------------------------------------------------
  // Summaries
  // ---------------------------------------------------------------------------------------------

  status(): TableView["status"] {
    if (this.closing || this.closed) return "CLOSED";
    if (this.isLive() || this.nextHandAt !== null) return "RUNNING";
    if (this.hand && this.started) return "PAUSED";
    return "WAITING";
  }

  liveStats(): Pick<LobbyTableSummary, "seated" | "status" | "avgPot" | "handsPerHour"> {
    const now = this.now();
    const hourAgo = now - 3_600_000;
    const lastHour = this.recentHands.filter((h) => h.at >= hourAgo);
    const avgPot =
      this.recentHands.length > 0
        ? Math.round(this.recentHands.reduce((sum, h) => sum + h.pot, 0) / this.recentHands.length)
        : null;
    let handsPerHour: number | null = null;
    if (lastHour.length >= 2) {
      const span = Math.max(now - lastHour[0]!.at, 60_000);
      handsPerHour = Math.round((lastHour.length / span) * 3_600_000);
    }
    return { seated: this.seats.size, status: this.status(), avgPot, handsPerHour };
  }
}
