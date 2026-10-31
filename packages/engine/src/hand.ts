// The hand state machine. One PokerHand instance = one hand. All state lives in a plain JSON object
// (HandState) so a hand can be persisted / restored with getState() / PokerHand.fromState().
import { effectiveButtonSeat } from "./button";
import { normalizeDeck, shuffledDeck, type Card } from "./cards";
import { EngineError } from "./errors";
import {
  canActCount,
  computeLegalActions,
  findNextActor,
  liveCount,
  needsAction,
  potTotal,
} from "./betting";
import { holeCardCount } from "./equity";
import { computePositions } from "./positions";
import { buildPots, splitAmount, splitBetweenBoards, type PotEntry } from "./pots";
import { evaluateBoardHand, oddChipOrder, showdownOrder } from "./showdown";
import { computeStats } from "./stats";
import type {
  ActionEvent,
  BoardHand,
  HandEvent,
  HandPhase,
  HandSnapshot,
  HandState,
  HandStatus,
  HandSummary,
  LegalActions,
  PlayerAction,
  PlayerState,
  Pot,
  PotSummary,
  PostKind,
  RecordedActionType,
  ShowReason,
  StartHandConfig,
  StartHandOptions,
  Street,
} from "./types";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewEvent = DistributiveOmit<HandEvent, "seq">;

const STREET_FOR_BOARD_SIZE: Record<number, Exclude<Street, "PREFLOP">> = { 0: "FLOP", 3: "TURN", 4: "RIVER" };

function isChipAmount(n: unknown, min = 0): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= min;
}

function invalid(message: string): never {
  throw new EngineError("INVALID_CONFIG", message);
}

type ShowdownDetails = {
  pots: PotSummary[];
  hands: Map<string, BoardHand[]>;
  mustShow: Map<string, ShowReason | null>;
};

export class PokerHand {
  private readonly s: HandState;

  private constructor(state: HandState) {
    this.s = state;
  }

  // ---- Construction ---------------------------------------------------------------------------

  /** Starts a hand: posts antes/blinds/straddle, deals hole cards (and the flop for bomb pots). */
  static start(config: StartHandConfig, options: StartHandOptions): PokerHand {
    const variant = config.variant;
    if (variant !== "NLHE" && variant !== "PLO") invalid(`Unknown variant ${String(variant)}`);
    const players = [...config.players].sort((a, b) => a.seat - b.seat);
    if (players.length < 2) invalid("At least two players are required");
    if (new Set(players.map((p) => p.id)).size !== players.length) invalid("Duplicate player ids");
    for (const p of players) {
      if (typeof p.id !== "string" || p.id.length === 0) invalid("Player id must be a non-empty string");
      if (!isChipAmount(p.seat, 1)) invalid(`Invalid seat ${p.seat}`);
      if (!isChipAmount(p.stack, 1)) invalid(`Invalid stack for ${p.id}`);
    }
    if (!isChipAmount(config.bigBlind, 1)) invalid("bigBlind must be a positive integer");
    if (!isChipAmount(config.smallBlind) || config.smallBlind > config.bigBlind) invalid("smallBlind must be 0..bigBlind");
    const ante = config.ante ?? 0;
    if (!isChipAmount(ante)) invalid("ante must be a non-negative integer");
    if (!isChipAmount(players.reduce((sum, p) => sum + p.stack, 0))) invalid("Total chips must be a safe integer");
    if (!isChipAmount(config.buttonSeat, 1)) invalid("Invalid buttonSeat");
    const bombPot = config.bombPot ?? null;
    if (bombPot && !isChipAmount(bombPot.ante, 1)) invalid("Bomb pot ante must be a positive integer");
    const doubleBoard = bombPot?.doubleBoard === true;
    const runItTwice = config.runItTwice === true && !doubleBoard;
    const holeCount = holeCardCount(variant);
    const boardCapacity = 8 * (doubleBoard || runItTwice ? 2 : 1);
    if (players.length * holeCount + boardCapacity > 52) invalid("Too many players for one deck");

    const positions = computePositions(
      players.map((p) => p.seat),
      config.buttonSeat,
    );
    const straddleRequested = bombPot ? null : (config.straddleSeat ?? null);
    if (straddleRequested !== null && straddleRequested !== positions.straddleSeat) {
      throw new EngineError("INVALID_STRADDLE", `Seat ${straddleRequested} may not straddle (UTG is ${positions.straddleSeat})`);
    }
    const extraIds = bombPot ? [] : (config.extraBlindPlayerIds ?? []);
    for (const id of extraIds) if (!players.some((p) => p.id === id)) invalid(`Unknown extra blind player ${id}`);

    let deck: Card[];
    if (options.deck) deck = normalizeDeck(options.deck, true);
    else if (options.randomInt) deck = shuffledDeck(options.randomInt);
    else invalid("Either randomInt or deck is required");

    const state: HandState = {
      version: 1,
      config: {
        handId: config.handId ?? null,
        variant,
        smallBlind: config.smallBlind,
        bigBlind: config.bigBlind,
        ante: bombPot ? 0 : ante,
        bombPot: bombPot ? { ante: bombPot.ante, doubleBoard } : null,
        runItTwice,
      },
      positions: {
        buttonSeat: config.buttonSeat,
        smallBlindSeat: bombPot ? null : positions.smallBlindSeat,
        bigBlindSeat: bombPot ? null : positions.bigBlindSeat,
        straddleSeat: null,
        extraBlindSeats: [],
      },
      deck,
      deckPos: 0,
      burns: [],
      players: players.map((p) => ({
        id: p.id,
        seat: p.seat,
        startingStack: p.stack,
        stack: p.stack,
        holeCards: [],
        streetBet: 0,
        committed: 0,
        folded: false,
        foldedStreet: null,
        allIn: false,
        hasActed: false,
        actedLevel: 0,
        lastAction: null,
        uncalledReturned: 0,
        won: 0,
      })),
      boards: doubleBoard ? [[], []] : [[]],
      street: "PREFLOP",
      status: "BETTING",
      toActPlayerId: null,
      currentBet: 0,
      minRaise: config.bigBlind,
      streetAggressorId: null,
      streetRaises: 0,
      finalAggressorId: null,
      runs: 1,
      allIn: null,
      events: [],
      summary: null,
    };
    const hand = new PokerHand(state);
    hand.begin(positions.dealOrder, straddleRequested, extraIds);
    return hand;
  }

  /** Restores a hand from getState() output (deep-copied). */
  static fromState(state: HandState): PokerHand {
    if (state.version !== 1) throw new EngineError("INVALID_CONFIG", `Unsupported hand state version ${String(state.version)}`);
    return new PokerHand(structuredClone(state));
  }

  private begin(dealOrder: number[], straddleSeat: number | null, extraIds: string[]): void {
    const s = this.s;
    const cfg = s.config;
    const pos = s.positions;
    this.emit({
      type: "HAND_START",
      handId: cfg.handId,
      variant: cfg.variant,
      buttonSeat: pos.buttonSeat,
      smallBlindSeat: pos.smallBlindSeat,
      bigBlindSeat: pos.bigBlindSeat,
      straddleSeat,
      smallBlind: cfg.smallBlind,
      bigBlind: cfg.bigBlind,
      ante: cfg.ante,
      bombPot: cfg.bombPot,
      runItTwiceAllowed: cfg.runItTwice,
      players: s.players.map((p) => ({ id: p.id, seat: p.seat, stack: p.startingStack })),
    });

    const inDealOrder = dealOrder.map((seat) => this.bySeat(seat));
    if (cfg.bombPot) {
      for (const p of inDealOrder) this.post(p, cfg.bombPot.ante, "BOMB_POT_ANTE", false);
    } else {
      if (cfg.ante > 0) for (const p of inDealOrder) this.post(p, cfg.ante, "ANTE", false);
      if (pos.smallBlindSeat !== null && cfg.smallBlind > 0) this.post(this.bySeat(pos.smallBlindSeat), cfg.smallBlind, "SMALL_BLIND", true);
      if (pos.bigBlindSeat !== null) this.post(this.bySeat(pos.bigBlindSeat), cfg.bigBlind, "BIG_BLIND", true);
      for (const p of inDealOrder) {
        if (!extraIds.includes(p.id) || p.seat === pos.smallBlindSeat || p.seat === pos.bigBlindSeat || p.seat === straddleSeat) continue;
        if (p.stack === 0) continue;
        this.post(p, cfg.bigBlind, "EXTRA_BLIND", true);
        pos.extraBlindSeats.push(p.seat);
      }
      if (straddleSeat !== null) {
        const straddler = this.bySeat(straddleSeat);
        // A straddle is only posted when it leaves the straddler with chips behind.
        if (straddler.stack > 2 * cfg.bigBlind) {
          this.post(straddler, 2 * cfg.bigBlind, "STRADDLE", true);
          pos.straddleSeat = straddleSeat;
        }
      }
    }

    // Hole cards: one at a time, starting left of the button.
    const holeCount = holeCardCount(cfg.variant);
    for (let r = 0; r < holeCount; r++) for (const p of inDealOrder) p.holeCards.push(this.draw());
    this.emit({
      type: "HOLE_CARDS",
      hands: inDealOrder.map((p) => ({ playerId: p.id, seat: p.seat, cards: p.holeCards.slice() })),
    });

    if (cfg.bombPot) {
      this.dealNextStreet();
      this.startStreet();
      return;
    }
    s.currentBet = Math.max(cfg.bigBlind, pos.straddleSeat !== null ? 2 * cfg.bigBlind : 0, ...s.players.map((p) => p.streetBet));
    s.minRaise = pos.straddleSeat !== null ? 2 * cfg.bigBlind : cfg.bigBlind;
    const from = pos.straddleSeat ?? pos.bigBlindSeat ?? pos.buttonSeat;
    this.setNextActorOrEndRound(from);
  }

  // ---- Queries --------------------------------------------------------------------------------

  /** Deep copy of the full state (includes the deck: keep it server-side). */
  getState(): HandState {
    return structuredClone(this.s);
  }

  get status(): HandStatus {
    return this.s.status;
  }

  get street(): Street {
    return this.s.street;
  }

  /** Wire-compatible phase (HandPhase). */
  get phase(): HandPhase {
    return this.s.status === "COMPLETE" ? "COMPLETE" : this.s.street;
  }

  get isComplete(): boolean {
    return this.s.status === "COMPLETE";
  }

  get toActPlayerId(): string | null {
    return this.s.toActPlayerId;
  }

  get boards(): Card[][] {
    return this.s.boards.map((b) => b.slice());
  }

  /** The full event log (copy). Contains HOLE_CARDS: redact before broadcasting. */
  get events(): HandEvent[] {
    return structuredClone(this.s.events);
  }

  /** Events with seq >= `seq`. */
  eventsSince(seq: number): HandEvent[] {
    return structuredClone(this.s.events.slice(Math.max(0, seq)));
  }

  /** Final summary, null until the hand is complete. */
  get summary(): HandSummary | null {
    return this.s.summary ? structuredClone(this.s.summary) : null;
  }

  getPlayer(playerId: string): PlayerState | null {
    const p = this.s.players.find((q) => q.id === playerId);
    return p ? structuredClone(p) : null;
  }

  /** Players still in the hand while waiting for the run-it-twice decision. */
  runoutDecisionPlayerIds(): string[] {
    if (this.s.status !== "RUNOUT_DECISION") return [];
    return this.s.players.filter((p) => !p.folded).map((p) => p.id);
  }

  /** Legal actions for `playerId`, or null when it is not their turn. */
  legalActions(playerId: string): LegalActions | null {
    if (this.s.status !== "BETTING" || this.s.toActPlayerId !== playerId) return null;
    return computeLegalActions(this.s, this.player(playerId));
  }

  /** Settled pots (current street bets excluded) while playing; final pots once complete. */
  pots(): Pot[] {
    if (this.s.summary) return this.s.summary.pots.map((p) => ({ amount: p.amount, eligiblePlayerIds: p.eligiblePlayerIds.slice() }));
    return buildPots(
      this.s.players.map((p) => ({
        id: p.id,
        committed: p.committed - p.streetBet,
        folded: p.folded,
        allIn: p.allIn && p.streetBet === 0,
      })),
    );
  }

  totalPot(): number {
    return potTotal(this.s);
  }

  /** Render-ready snapshot without the deck. Hole cards are included: redact per viewer. */
  snapshot(): HandSnapshot {
    const s = this.s;
    return {
      handId: s.config.handId,
      variant: s.config.variant,
      status: s.status,
      phase: this.phase,
      street: s.street,
      isBombPot: s.config.bombPot !== null,
      doubleBoard: s.config.bombPot?.doubleBoard === true,
      runs: s.runs,
      boards: this.boards,
      buttonSeat: s.positions.buttonSeat,
      smallBlindSeat: s.positions.smallBlindSeat,
      bigBlindSeat: s.positions.bigBlindSeat,
      straddleSeat: s.positions.straddleSeat,
      toActPlayerId: s.toActPlayerId,
      currentBet: s.currentBet,
      minRaise: s.minRaise,
      pots: this.pots(),
      totalPot: this.totalPot(),
      players: s.players.map((p) => ({
        id: p.id,
        seat: p.seat,
        stack: p.stack,
        holeCards: p.holeCards.slice(),
        streetBet: p.streetBet,
        committed: p.committed,
        folded: p.folded,
        foldedStreet: p.foldedStreet,
        allIn: p.allIn,
        lastAction: p.lastAction ? { ...p.lastAction } : null,
      })),
    };
  }

  // ---- Commands -------------------------------------------------------------------------------

  /**
   * Applies an action for the player to act. bet/raise take the street total in `amount` and are
   * interchangeable (the engine records the right one). "allin" commits the whole stack as a call,
   * bet or raise; it is rejected when that would exceed the limit (PLO) or a raise is not allowed.
   */
  act(playerId: string, action: PlayerAction): ActionEvent {
    return this.applyAction(playerId, action, null);
  }

  /** Acts for the player whose turn it is: check when possible, otherwise fold. */
  timeout(): ActionEvent {
    this.assertBetting();
    const id = this.s.toActPlayerId!;
    const legal = computeLegalActions(this.s, this.player(id));
    return this.applyAction(id, { type: legal.canCheck ? "check" : "fold" }, "timeout");
  }

  /**
   * Folds a player regardless of turn (they left the table). Returns false when nothing happened:
   * hand complete, already folded, or all-in (an all-in player's hand stays live).
   */
  foldOutOfTurn(playerId: string): boolean {
    const s = this.s;
    const p = this.player(playerId);
    if (s.status === "COMPLETE" || p.folded || p.allIn) return false;
    if (s.status === "BETTING" && s.toActPlayerId === playerId) {
      this.applyAction(playerId, { type: "fold" }, "left");
      return true;
    }
    this.recordFold(p, "left", true, { facingAmount: 0, couldRaise: false, raisesBefore: s.streetRaises });
    if (s.allIn) s.allIn.playerIds = s.allIn.playerIds.filter((id) => id !== playerId);
    if (liveCount(s) === 1) {
      this.awardUncontested();
      return true;
    }
    if (s.status === "BETTING" && s.toActPlayerId !== null) {
      const actor = this.player(s.toActPlayerId);
      if (!needsAction(s, actor)) this.setNextActorOrEndRound(actor.seat);
    }
    return true;
  }

  /** Resolves RUNOUT_DECISION: deal the rest of the board once or twice, then showdown. */
  chooseRunout(runs: 1 | 2): void {
    if (this.s.status !== "RUNOUT_DECISION") throw new EngineError("NOT_RUNOUT_DECISION", "No runout decision pending");
    if (runs !== 1 && runs !== 2) throw new EngineError("INVALID_ACTION", "runs must be 1 or 2");
    this.s.status = "BETTING";
    this.runOut(runs);
  }

  // ---- Internals: actions -----------------------------------------------------------------------

  private applyAction(playerId: string, action: PlayerAction, reason: "timeout" | "left" | null): ActionEvent {
    this.assertBetting();
    const s = this.s;
    const p = this.player(playerId);
    if (s.toActPlayerId !== playerId) throw new EngineError("NOT_YOUR_TURN", "It is not this player's turn");
    const legal = computeLegalActions(s, p);
    const ctx = { facingAmount: legal.callAmount, couldRaise: legal.canBetOrRaise, raisesBefore: s.streetRaises };

    let event: ActionEvent;
    switch (action.type) {
      case "fold":
        event = this.recordFold(p, reason, false, ctx);
        break;
      case "check":
        if (!legal.canCheck) throw new EngineError("CANNOT_CHECK", "Cannot check facing a bet");
        event = this.commit(p, 0, "check", ctx, reason);
        break;
      case "call":
        if (legal.callAmount === 0) throw new EngineError("NOTHING_TO_CALL", "Nothing to call; check instead");
        event = this.commit(p, legal.callAmount, "call", ctx, reason);
        break;
      case "bet":
      case "raise": {
        if (!legal.canBetOrRaise) throw new EngineError("CANNOT_RAISE", "Betting/raising is not allowed now");
        const to = action.amount;
        if (!isChipAmount(to)) throw new EngineError("INVALID_AMOUNT", "Bet/raise amount must be an integer");
        if (to < legal.minTo || to > legal.maxTo) {
          throw new EngineError("INVALID_AMOUNT", `Amount must be between ${legal.minTo} and ${legal.maxTo}`);
        }
        event = this.raiseTo(p, to, ctx, reason);
        break;
      }
      case "allin": {
        const allInTo = p.streetBet + p.stack;
        if (p.stack <= legal.callAmount) {
          event = this.commit(p, p.stack, "call", ctx, reason);
        } else if (legal.canBetOrRaise && allInTo <= legal.maxTo) {
          event = this.raiseTo(p, allInTo, ctx, reason);
        } else {
          throw new EngineError("CANNOT_RAISE", "All-in is not allowed here (raise not allowed or above the pot limit)");
        }
        break;
      }
      default:
        throw new EngineError("INVALID_ACTION", `Unknown action ${String((action as { type: unknown }).type)}`);
    }

    if (liveCount(s) === 1) this.awardUncontested();
    else this.setNextActorOrEndRound(p.seat);
    return event;
  }

  private raiseTo(p: PlayerState, to: number, ctx: EventCtx, reason: "timeout" | "left" | null): ActionEvent {
    const s = this.s;
    const label: RecordedActionType = s.currentBet === 0 ? "bet" : "raise";
    const raiseSize = to - s.currentBet;
    const full = raiseSize >= s.minRaise;
    if (full) s.minRaise = raiseSize;
    s.currentBet = to;
    s.streetAggressorId = p.id;
    s.streetRaises++;
    return this.commit(p, to - p.streetBet, label, ctx, reason, full);
  }

  private commit(
    p: PlayerState,
    chips: number,
    action: RecordedActionType,
    ctx: EventCtx,
    reason: "timeout" | "left" | null,
    fullRaise = false,
  ): ActionEvent {
    const s = this.s;
    p.stack -= chips;
    p.streetBet += chips;
    p.committed += chips;
    if (p.stack === 0) p.allIn = true;
    p.hasActed = true;
    p.actedLevel = s.currentBet;
    const amountForDisplay = action === "check" ? null : action === "call" ? chips : p.streetBet;
    p.lastAction = { type: p.allIn ? "allin" : action, amount: amountForDisplay };
    return this.emit({
      type: "ACTION",
      playerId: p.id,
      seat: p.seat,
      street: s.street,
      action,
      amount: chips,
      to: p.streetBet,
      allIn: p.allIn,
      stackAfter: p.stack,
      potAfter: potTotal(s),
      currentBetAfter: s.currentBet,
      facingAmount: ctx.facingAmount,
      raisesBefore: ctx.raisesBefore,
      couldRaise: ctx.couldRaise,
      fullRaise: (action === "bet" || action === "raise") && fullRaise,
      reason,
      outOfTurn: false,
    }) as ActionEvent;
  }

  private recordFold(p: PlayerState, reason: "timeout" | "left" | null, outOfTurn: boolean, ctx: EventCtx): ActionEvent {
    const s = this.s;
    p.folded = true;
    p.foldedStreet = s.street;
    p.hasActed = true;
    p.lastAction = { type: "fold", amount: null };
    return this.emit({
      type: "ACTION",
      playerId: p.id,
      seat: p.seat,
      street: s.street,
      action: "fold",
      amount: 0,
      to: p.streetBet,
      allIn: false,
      stackAfter: p.stack,
      potAfter: potTotal(s),
      currentBetAfter: s.currentBet,
      facingAmount: ctx.facingAmount,
      raisesBefore: ctx.raisesBefore,
      couldRaise: ctx.couldRaise,
      fullRaise: false,
      reason,
      outOfTurn,
    }) as ActionEvent;
  }

  private post(p: PlayerState, amount: number, kind: PostKind, live: boolean): void {
    const chips = Math.min(amount, p.stack);
    p.stack -= chips;
    p.committed += chips;
    if (live) p.streetBet += chips;
    if (p.stack === 0) p.allIn = true;
    const type = kind === "ANTE" || kind === "BOMB_POT_ANTE" ? "ante" : kind === "STRADDLE" ? "straddle" : "post";
    p.lastAction = { type, amount: chips };
    this.emit({ type: "POST", playerId: p.id, seat: p.seat, kind, amount: chips, allIn: p.allIn, stackAfter: p.stack });
  }

  // ---- Internals: flow ----------------------------------------------------------------------------

  private setNextActorOrEndRound(fromSeat: number): void {
    const next = findNextActor(this.s, fromSeat);
    if (next) {
      this.s.toActPlayerId = next.id;
      return;
    }
    this.s.toActPlayerId = null;
    this.endBettingRound();
  }

  private startStreet(): void {
    const s = this.s;
    for (const p of s.players) {
      p.streetBet = 0;
      p.hasActed = false;
      p.actedLevel = 0;
      // Street labels reset; "fold"/"allin" stay visible.
      if (!p.folded && !p.allIn) p.lastAction = null;
    }
    s.currentBet = 0;
    s.minRaise = s.config.bigBlind;
    s.streetAggressorId = null;
    s.streetRaises = 0;
    if (canActCount(s) <= 1) {
      // Nobody can bet (all-in bomb pot antes): straight to the runout.
      this.endBettingRound();
      return;
    }
    this.setNextActorOrEndRound(effectiveButtonSeat(s));
  }

  private endBettingRound(): void {
    const s = this.s;
    s.toActPlayerId = null;
    const hadAction = s.events.some((e) => e.type === "ACTION" && e.street === s.street && !e.outOfTurn);
    if (hadAction) s.finalAggressorId = s.streetAggressorId;
    this.returnUncalled();
    for (const p of s.players) p.streetBet = 0;
    s.currentBet = 0;
    if (liveCount(s) === 1) {
      this.awardUncontested();
      return;
    }
    if (s.boards[0]!.length >= 5) {
      this.showdown();
      return;
    }
    if (canActCount(s) <= 1) {
      this.beginRunout();
      return;
    }
    this.dealNextStreet();
    this.startStreet();
  }

  private returnUncalled(): void {
    const s = this.s;
    let top: PlayerState | null = null;
    let second = 0;
    for (const p of s.players) {
      if (!top || p.committed > top.committed) {
        if (top) second = Math.max(second, top.committed);
        top = p;
      } else {
        second = Math.max(second, p.committed);
      }
    }
    if (top && !top.folded && top.committed > second) this.giveBack(top, top.committed - second);
    this.returnUnwinnable();
  }

  /**
   * When every live player is all-in, chips a folded player put in above the largest live all-in can
   * never be won by anyone (an all-in player wins at most what they matched from each opponent). This
   * only happens after out-of-turn folds; those chips go back to their owners as uncalled.
   */
  private returnUnwinnable(): void {
    const live = this.s.players.filter((p) => !p.folded);
    if (live.length === 0 || live.some((p) => !p.allIn)) return;
    const cap = Math.max(...live.map((p) => p.committed));
    for (const p of this.s.players) if (p.folded && p.committed > cap) this.giveBack(p, p.committed - cap);
  }

  private giveBack(p: PlayerState, amount: number): void {
    p.committed -= amount;
    p.streetBet = Math.max(0, p.streetBet - amount);
    p.stack += amount;
    p.uncalledReturned += amount;
    if (p.stack > 0) p.allIn = false;
    this.emit({ type: "UNCALLED_RETURN", playerId: p.id, seat: p.seat, amount });
  }

  private beginRunout(): void {
    const s = this.s;
    s.allIn = { street: s.street, board: s.boards[0]!.slice(), playerIds: s.players.filter((p) => !p.folded).map((p) => p.id) };
    if (s.config.runItTwice && s.boards.length === 1) {
      s.status = "RUNOUT_DECISION";
      this.emit({ type: "RUNOUT_DECISION", playerIds: s.allIn.playerIds.slice(), street: s.street });
      return;
    }
    this.runOut(1);
  }

  private runOut(runs: 1 | 2): void {
    const s = this.s;
    this.emit({ type: "RUNOUT", runs });
    if (runs === 2) {
      const base = s.boards[0]!.slice();
      this.completeBoard(0);
      s.boards.push(base);
      this.completeBoard(1);
      s.runs = 2;
      s.street = "RIVER";
    } else {
      while (s.boards[0]!.length < 5) this.dealNextStreet();
    }
    this.showdown();
  }

  private completeBoard(boardIndex: number): void {
    const board = this.s.boards[boardIndex]!;
    while (board.length < 5) this.dealOnBoard(boardIndex);
  }

  /** Deals the next street on every board. */
  private dealNextStreet(): void {
    const s = this.s;
    let street: Street = s.street;
    for (let b = 0; b < s.boards.length; b++) street = this.dealOnBoard(b);
    s.street = street;
  }

  private dealOnBoard(boardIndex: number): Exclude<Street, "PREFLOP"> {
    const board = this.s.boards[boardIndex]!;
    const street = STREET_FOR_BOARD_SIZE[board.length];
    if (!street) throw new Error(`Cannot deal on a board of ${board.length} cards`);
    this.s.burns.push(this.draw());
    const cards: Card[] = [];
    for (let i = 0; i < (street === "FLOP" ? 3 : 1); i++) cards.push(this.draw());
    board.push(...cards);
    this.s.street = street;
    this.emit({ type: "STREET", street, boardIndex, cards, board: board.slice() });
    return street;
  }

  private draw(): Card {
    const s = this.s;
    const card = s.deck[s.deckPos];
    if (card === undefined) throw new EngineError("DECK_EXHAUSTED", "The deck is exhausted");
    s.deckPos++;
    return card;
  }

  // ---- Internals: settlement ----------------------------------------------------------------------

  private potEntries(): PotEntry[] {
    return this.s.players.map((p) => ({ id: p.id, committed: p.committed, folded: p.folded, allIn: p.allIn }));
  }

  private awardUncontested(): void {
    const s = this.s;
    s.toActPlayerId = null;
    this.returnUncalled();
    for (const p of s.players) p.streetBet = 0;
    s.currentBet = 0;
    const winner = s.players.find((p) => !p.folded)!;
    const pots: PotSummary[] = buildPots(this.potEntries()).map((pot, index) => ({
      ...pot,
      index,
      awards: [
        {
          boardIndex: 0,
          amount: pot.amount,
          winners: [{ playerId: winner.id, seat: winner.seat, amount: pot.amount, handName: null }],
        },
      ],
    }));
    for (const pot of pots) {
      winner.stack += pot.amount;
      winner.won += pot.amount;
      this.emit({
        type: "POT_AWARD",
        potIndex: pot.index,
        boardIndex: 0,
        amount: pot.amount,
        eligiblePlayerIds: pot.eligiblePlayerIds.slice(),
        winners: pot.awards[0]!.winners.map((w) => ({ ...w })),
        uncontested: true,
      });
    }
    this.complete({ pots, hands: new Map(), mustShow: new Map() }, false);
  }

  private showdown(): void {
    const s = this.s;
    s.toActPlayerId = null;
    this.returnUnwinnable(); // a player may have left during the runout decision
    const order = showdownOrder(s);
    const hands = new Map<string, BoardHand[]>();
    for (const p of order) {
      hands.set(
        p.id,
        s.boards.map((board, b) => evaluateBoardHand(s.config.variant, p.holeCards, board, b)),
      );
    }
    const pots: PotSummary[] = [];
    const winners = new Set<string>();
    buildPots(this.potEntries()).forEach((pot, index) => {
      const shares = splitBetweenBoards(pot.amount, s.boards.length);
      const summary: PotSummary = { ...pot, index, awards: [] };
      shares.forEach((share, b) => {
        let best = -1;
        for (const id of pot.eligiblePlayerIds) best = Math.max(best, hands.get(id)![b]!.value);
        const ids = pot.eligiblePlayerIds.filter((id) => hands.get(id)![b]!.value === best);
        const split = splitAmount(share, oddChipOrder(s, ids));
        summary.awards.push({
          boardIndex: b,
          amount: share,
          winners: split.map(({ id, amount }) => {
            const p = this.player(id);
            p.stack += amount;
            p.won += amount;
            if (amount > 0) winners.add(id);
            return { playerId: id, seat: p.seat, amount, handName: hands.get(id)![b]!.name };
          }),
        });
      });
      pots.push(summary);
    });

    const mustShow = new Map<string, ShowReason | null>();
    const calledAggressor = order[0] && order[0].id === s.finalAggressorId ? order[0].id : null;
    for (const p of order) {
      let reason: ShowReason | null = null;
      if (winners.has(p.id)) reason = "WINNER";
      else if (p.allIn || s.allIn !== null) reason = "ALL_IN";
      else if (p.id === calledAggressor) reason = "CALLED";
      mustShow.set(p.id, reason);
    }

    this.emit({
      type: "SHOWDOWN",
      order: order.map((p) => p.id),
      hands: order.map((p) => ({
        playerId: p.id,
        seat: p.seat,
        cards: p.holeCards.slice(),
        mustShow: mustShow.get(p.id) !== null,
        showReason: mustShow.get(p.id) ?? null,
        boards: structuredClone(hands.get(p.id)!),
      })),
    });
    for (const pot of pots) {
      for (const award of pot.awards) {
        this.emit({
          type: "POT_AWARD",
          potIndex: pot.index,
          boardIndex: award.boardIndex,
          amount: award.amount,
          eligiblePlayerIds: pot.eligiblePlayerIds.slice(),
          winners: award.winners.map((w) => ({ ...w })),
          uncontested: pot.eligiblePlayerIds.length === 1,
        });
      }
    }
    this.complete({ pots, hands, mustShow }, true);
  }

  private complete(details: ShowdownDetails, showdown: boolean): void {
    const s = this.s;
    s.status = "COMPLETE";
    s.toActPlayerId = null;
    this.emit({ type: "HAND_END", stacks: s.players.map((p) => ({ playerId: p.id, seat: p.seat, stack: p.stack })) });
    const { stats, isWalk } = computeStats(s);
    const pos = s.positions;
    s.summary = {
      handId: s.config.handId,
      variant: s.config.variant,
      buttonSeat: pos.buttonSeat,
      smallBlindSeat: pos.smallBlindSeat,
      bigBlindSeat: pos.bigBlindSeat,
      straddleSeat: pos.straddleSeat,
      smallBlind: s.config.smallBlind,
      bigBlind: s.config.bigBlind,
      ante: s.config.bombPot ? s.config.bombPot.ante : s.config.ante,
      isBombPot: s.config.bombPot !== null,
      doubleBoard: s.config.bombPot?.doubleBoard === true,
      runs: s.runs,
      boards: s.boards.map((b) => b.slice()),
      endedOn: s.street,
      showdown,
      isWalk,
      preflopStatsEligible: s.config.bombPot === null,
      totalPot: details.pots.reduce((sum, p) => sum + p.amount, 0),
      pots: details.pots,
      allIn: s.allIn ? structuredClone(s.allIn) : null,
      players: s.players.map((p) => {
        const wonPerPot: Array<{ potIndex: number; boardIndex: number; amount: number }> = [];
        for (const pot of details.pots) {
          for (const award of pot.awards) {
            for (const w of award.winners) {
              if (w.playerId === p.id && w.amount > 0) wonPerPot.push({ potIndex: pot.index, boardIndex: award.boardIndex, amount: w.amount });
            }
          }
        }
        const atShowdown = showdown && !p.folded;
        const reason = details.mustShow.get(p.id) ?? null;
        return {
          id: p.id,
          seat: p.seat,
          isButton: p.seat === pos.buttonSeat,
          isSmallBlind: p.seat === pos.smallBlindSeat,
          isBigBlind: p.seat === pos.bigBlindSeat,
          isStraddle: p.seat === pos.straddleSeat,
          startingStack: p.startingStack,
          endingStack: p.stack,
          net: p.stack - p.startingStack,
          committed: p.committed,
          uncalledReturned: p.uncalledReturned,
          won: p.won,
          wonPerPot,
          holeCards: p.holeCards.slice(),
          folded: p.folded,
          foldedStreet: p.foldedStreet,
          allIn: p.allIn,
          wentToShowdown: atShowdown,
          wonAtShowdown: atShowdown && p.won > 0,
          mustShow: reason !== null,
          showReason: reason,
          hands: details.hands.get(p.id) ?? [],
          stats: stats.get(p.id)!,
        };
      }),
    };
  }

  // ---- Helpers ------------------------------------------------------------------------------------

  private emit(event: NewEvent): HandEvent {
    const full = { ...event, seq: this.s.events.length } as HandEvent;
    this.s.events.push(full);
    return structuredClone(full);
  }

  private assertBetting(): void {
    if (this.s.status === "COMPLETE") throw new EngineError("HAND_COMPLETE", "The hand is complete");
    if (this.s.status !== "BETTING" || this.s.toActPlayerId === null) {
      throw new EngineError("NOT_BETTING", "No betting action is pending");
    }
  }

  private player(id: string): PlayerState {
    const p = this.s.players.find((q) => q.id === id);
    if (!p) throw new EngineError("UNKNOWN_PLAYER", `Unknown player ${id}`);
    return p;
  }

  private bySeat(seat: number): PlayerState {
    const p = this.s.players.find((q) => q.seat === seat);
    if (!p) throw new Error(`No player in seat ${seat}`);
    return p;
  }
}

type EventCtx = { facingAmount: number; couldRaise: boolean; raisesBefore: number };

