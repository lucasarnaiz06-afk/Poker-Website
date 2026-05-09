import {
  assertUniqueCards,
  createDeck,
  shuffleDeck,
  type Card,
  type RandomInt,
} from "./cards";
import {
  evaluateHoldemHand,
  findWinningEvaluations,
  type EvaluatedHand,
} from "./hand-evaluator";

export type PokerPhase =
  | "NOT_STARTED"
  | "PRE_FLOP"
  | "FLOP"
  | "TURN"
  | "RIVER"
  | "SHOWDOWN"
  | "COMPLETE";

export type PlayerSeatInput = {
  id: string;
  seat: number;
  stack: number;
};

export type PokerEngineOptions = {
  smallBlind: number;
  bigBlind: number;
  maxSeats?: number;
  randomInt?: RandomInt;
};

export type StartHandOptions = {
  buttonSeat?: number;
  deck?: readonly Card[];
};

export type PlayerSnapshot = {
  id: string;
  seat: number;
  stack: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  currentBet: number;
  committed: number;
  hasActed: boolean;
  inHand: boolean;
};

export type SidePotSnapshot = {
  amount: number;
  contributorPlayerIds: string[];
  eligiblePlayerIds: string[];
};

export type PotAwardSnapshot = {
  amount: number;
  winnerIds: string[];
  eligiblePlayerIds: string[];
  handName: string | null;
  handDescription: string | null;
};

export type PokerStateSnapshot = {
  phase: PokerPhase;
  buttonSeat: number | null;
  currentTurnSeat: number | null;
  currentTurnPlayerId: string | null;
  currentBet: number;
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  board: Card[];
  burnedCards: Card[];
  deckCount: number;
  players: PlayerSnapshot[];
  pot: {
    total: number;
    sidePots: SidePotSnapshot[];
    awards: PotAwardSnapshot[];
  };
  showdownHands: Array<{
    playerId: string;
    name: string;
    description: string;
    rank: number;
  }>;
};

type EnginePlayer = PlayerSnapshot;

const BETTING_PHASES = new Set<PokerPhase>([
  "PRE_FLOP",
  "FLOP",
  "TURN",
  "RIVER",
]);

export class PokerEngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PokerEngineError";
  }
}

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new PokerEngineError(
      "INVALID_INPUT",
      `${label} must be a positive integer.`,
    );
  }
}

function cloneCards(cards: readonly Card[]) {
  return cards.map((card) => ({ ...card }));
}

function isHandTerminal(phase: PokerPhase) {
  return phase === "SHOWDOWN" || phase === "COMPLETE";
}

export function buildSidePots(players: readonly PlayerSnapshot[]) {
  const committedLevels = [
    ...new Set(
      players
        .map((player) => player.committed)
        .filter((committed) => committed > 0),
    ),
  ].sort((left, right) => left - right);
  const sidePots: SidePotSnapshot[] = [];
  let previousLevel = 0;

  for (const committedLevel of committedLevels) {
    const contributors = players.filter(
      (player) => player.committed >= committedLevel,
    );
    const amount = (committedLevel - previousLevel) * contributors.length;

    if (amount > 0) {
      sidePots.push({
        amount,
        contributorPlayerIds: contributors.map((player) => player.id),
        eligiblePlayerIds: contributors
          .filter((player) => !player.folded)
          .map((player) => player.id),
      });
    }

    previousLevel = committedLevel;
  }

  return sidePots;
}

export class PokerEngine {
  private readonly smallBlind: number;
  private readonly bigBlind: number;
  private readonly maxSeats: number;
  private readonly randomInt?: RandomInt;
  private readonly players: EnginePlayer[] = [];

  private phase: PokerPhase = "NOT_STARTED";
  private buttonSeat: number | null = null;
  private currentTurnSeat: number | null = null;
  private currentBet = 0;
  private minRaise = 0;
  private deck: Card[] = [];
  private board: Card[] = [];
  private burnedCards: Card[] = [];
  private potAwards: PotAwardSnapshot[] = [];
  private showdownHands = new Map<string, EvaluatedHand>();

  constructor(options: PokerEngineOptions) {
    assertPositiveInteger(options.smallBlind, "Small blind");
    assertPositiveInteger(options.bigBlind, "Big blind");

    if (options.bigBlind < options.smallBlind) {
      throw new PokerEngineError(
        "INVALID_BLINDS",
        "Big blind must be at least the small blind.",
      );
    }

    this.smallBlind = options.smallBlind;
    this.bigBlind = options.bigBlind;
    this.maxSeats = options.maxSeats ?? 9;
    this.minRaise = options.bigBlind;
    this.randomInt = options.randomInt;
  }

  addPlayer(input: PlayerSeatInput) {
    if (BETTING_PHASES.has(this.phase)) {
      throw new PokerEngineError(
        "HAND_IN_PROGRESS",
        "Players cannot be seated while a betting round is active.",
      );
    }

    const playerId = input.id.trim();

    if (!playerId) {
      throw new PokerEngineError("INVALID_PLAYER", "Player ID is required.");
    }

    assertPositiveInteger(input.seat, "Seat");
    assertPositiveInteger(input.stack, "Stack");

    if (input.seat > this.maxSeats) {
      throw new PokerEngineError(
        "INVALID_SEAT",
        `Seat must be between 1 and ${this.maxSeats}.`,
      );
    }

    if (this.players.some((player) => player.id === playerId)) {
      throw new PokerEngineError(
        "PLAYER_ALREADY_SEATED",
        "Player is already seated.",
      );
    }

    if (this.players.some((player) => player.seat === input.seat)) {
      throw new PokerEngineError("SEAT_TAKEN", "Seat is already occupied.");
    }

    this.players.push({
      id: playerId,
      seat: input.seat,
      stack: input.stack,
      holeCards: [],
      folded: false,
      allIn: false,
      currentBet: 0,
      committed: 0,
      hasActed: false,
      inHand: false,
    });

    return this.getState();
  }

  startHand(options: StartHandOptions = {}) {
    if (BETTING_PHASES.has(this.phase)) {
      throw new PokerEngineError(
        "HAND_IN_PROGRESS",
        "Current hand must finish before starting another hand.",
      );
    }

    const eligiblePlayers = this.players.filter((player) => player.stack > 0);

    if (eligiblePlayers.length < 2) {
      throw new PokerEngineError(
        "NOT_ENOUGH_PLAYERS",
        "At least two players with chips are required.",
      );
    }

    this.resetHandState();
    this.phase = "PRE_FLOP";
    this.buttonSeat = this.resolveButtonSeat(options.buttonSeat);
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.board = [];
    this.burnedCards = [];
    this.potAwards = [];
    this.showdownHands.clear();
    this.deck = options.deck
      ? cloneCards(options.deck)
      : shuffleDeck(createDeck(), this.randomInt);

    assertUniqueCards(this.deck);

    const minimumDeckSize = this.handPlayers().length * 2 + 8;

    if (this.deck.length < minimumDeckSize) {
      throw new PokerEngineError(
        "DECK_TOO_SMALL",
        "Deck does not contain enough cards for a Hold'em hand.",
      );
    }

    const { bigBlindPlayer } = this.postBlinds();

    this.dealHoleCards();
    this.currentTurnSeat = this.findNextActionableSeatAfter(bigBlindPlayer.seat);

    if (!this.currentTurnSeat) {
      this.advanceRound();
    }

    return this.getState();
  }

  fold(playerId: string) {
    const player = this.requireActingPlayer(playerId);

    player.folded = true;
    player.hasActed = true;

    return this.afterAction(player.seat);
  }

  check(playerId: string) {
    const player = this.requireActingPlayer(playerId);

    if (player.currentBet !== this.currentBet) {
      throw new PokerEngineError(
        "CHECK_NOT_ALLOWED",
        "Player cannot check while facing a bet.",
      );
    }

    player.hasActed = true;

    return this.afterAction(player.seat);
  }

  call(playerId: string) {
    const player = this.requireActingPlayer(playerId);
    const amountToCall = this.currentBet - player.currentBet;

    if (amountToCall <= 0) {
      throw new PokerEngineError(
        "CALL_NOT_ALLOWED",
        "Player is not facing a bet.",
      );
    }

    this.commitChips(player, Math.min(amountToCall, player.stack));
    player.hasActed = true;

    return this.afterAction(player.seat);
  }

  raise(playerId: string, totalBet: number) {
    const player = this.requireActingPlayer(playerId);

    if (!Number.isInteger(totalBet) || totalBet <= 0) {
      throw new PokerEngineError(
        "INVALID_RAISE",
        "Raise total must be a positive integer.",
      );
    }

    if (totalBet <= this.currentBet) {
      throw new PokerEngineError(
        "RAISE_NOT_ABOVE_CURRENT_BET",
        "Raise total must exceed the current bet.",
      );
    }

    const maximumTotalBet = player.currentBet + player.stack;

    if (totalBet > maximumTotalBet) {
      throw new PokerEngineError(
        "INSUFFICIENT_STACK",
        "Player does not have enough chips for that raise.",
      );
    }

    const raiseSize = totalBet - this.currentBet;
    const minimumRaise = this.currentBet === 0 ? this.bigBlind : this.minRaise;
    const isAllInRaise = totalBet === maximumTotalBet;

    if (raiseSize < minimumRaise && !isAllInRaise) {
      throw new PokerEngineError(
        "RAISE_TOO_SMALL",
        `Raise must increase the bet by at least ${minimumRaise}.`,
      );
    }

    this.commitChips(player, totalBet - player.currentBet);
    this.currentBet = totalBet;

    if (raiseSize >= minimumRaise) {
      this.minRaise = raiseSize;

      for (const otherPlayer of this.remainingContenders()) {
        if (otherPlayer.id !== player.id && !otherPlayer.allIn) {
          otherPlayer.hasActed = false;
        }
      }
    }

    player.hasActed = true;

    return this.afterAction(player.seat);
  }

  getState(): PokerStateSnapshot {
    const players = this.orderedPlayers().map((player) => ({
      ...player,
      holeCards: cloneCards(player.holeCards),
    }));
    const currentTurnPlayer =
      this.currentTurnSeat === null
        ? null
        : players.find((player) => player.seat === this.currentTurnSeat) ?? null;

    return {
      phase: this.phase,
      buttonSeat: this.buttonSeat,
      currentTurnSeat: this.currentTurnSeat,
      currentTurnPlayerId: currentTurnPlayer?.id ?? null,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      board: cloneCards(this.board),
      burnedCards: cloneCards(this.burnedCards),
      deckCount: this.deck.length,
      players,
      pot: {
        total: players.reduce((total, player) => total + player.committed, 0),
        sidePots: buildSidePots(players.filter((player) => player.inHand)),
        awards: this.potAwards.map((award) => ({ ...award })),
      },
      showdownHands: [...this.showdownHands.values()].map((hand) => ({
        playerId: hand.playerId,
        name: hand.name,
        description: hand.description,
        rank: hand.rank,
      })),
    };
  }

  private resetHandState() {
    for (const player of this.players) {
      player.holeCards = [];
      player.folded = false;
      player.allIn = false;
      player.currentBet = 0;
      player.committed = 0;
      player.hasActed = false;
      player.inHand = player.stack > 0;
    }
  }

  private resolveButtonSeat(requestedButtonSeat?: number) {
    if (requestedButtonSeat !== undefined) {
      const requestedButton = this.players.find(
        (player) =>
          player.seat === requestedButtonSeat && player.stack > 0 && player.inHand,
      );

      if (!requestedButton) {
        throw new PokerEngineError(
          "INVALID_BUTTON",
          "Button seat must belong to a player with chips.",
        );
      }

      return requestedButton.seat;
    }

    if (this.buttonSeat !== null) {
      const nextButton = this.findNextPlayerAfter(
        this.buttonSeat,
        (player) => player.stack > 0 && player.inHand,
      );

      if (nextButton) {
        return nextButton.seat;
      }
    }

    return this.handPlayers()[0].seat;
  }

  private postBlinds() {
    const buttonSeat = this.requireButtonSeat();
    const handPlayers = this.handPlayers();
    const isHeadsUp = handPlayers.length === 2;
    const smallBlindPlayer = isHeadsUp
      ? this.requirePlayerBySeat(buttonSeat)
      : this.requireNextPlayerAfter(buttonSeat, (player) => player.inHand);
    const bigBlindPlayer = this.requireNextPlayerAfter(
      smallBlindPlayer.seat,
      (player) => player.inHand,
    );

    this.postBlind(smallBlindPlayer, this.smallBlind);
    this.postBlind(bigBlindPlayer, this.bigBlind);

    return { smallBlindPlayer, bigBlindPlayer };
  }

  private postBlind(player: EnginePlayer, blindAmount: number) {
    this.commitChips(player, Math.min(blindAmount, player.stack));
    this.currentBet = Math.max(this.currentBet, player.currentBet);
  }

  private dealHoleCards() {
    const buttonSeat = this.requireButtonSeat();
    const recipients = this.playersAfterSeat(buttonSeat).filter(
      (player) => player.inHand,
    );

    for (let round = 0; round < 2; round += 1) {
      for (const player of recipients) {
        player.holeCards.push(this.drawCard());
      }
    }
  }

  private dealFlop() {
    this.burnedCards.push(this.drawCard());
    this.board.push(this.drawCard(), this.drawCard(), this.drawCard());
    this.phase = "FLOP";
  }

  private dealTurn() {
    this.burnedCards.push(this.drawCard());
    this.board.push(this.drawCard());
    this.phase = "TURN";
  }

  private dealRiver() {
    this.burnedCards.push(this.drawCard());
    this.board.push(this.drawCard());
    this.phase = "RIVER";
  }

  private drawCard() {
    const card = this.deck.shift();

    if (!card) {
      throw new PokerEngineError("DECK_EMPTY", "Deck is empty.");
    }

    return card;
  }

  private requireActingPlayer(playerId: string) {
    if (!BETTING_PHASES.has(this.phase)) {
      throw new PokerEngineError(
        "NO_ACTIVE_BETTING_ROUND",
        "No betting action is currently available.",
      );
    }

    if (this.currentTurnSeat === null) {
      throw new PokerEngineError(
        "NO_PLAYER_TO_ACT",
        "There is no player waiting to act.",
      );
    }

    const player = this.requirePlayerById(playerId);

    if (!player.inHand || player.folded || player.allIn) {
      throw new PokerEngineError(
        "PLAYER_CANNOT_ACT",
        "Player is not eligible to act.",
      );
    }

    if (player.seat !== this.currentTurnSeat) {
      throw new PokerEngineError("OUT_OF_TURN", "Player is acting out of turn.");
    }

    return player;
  }

  private afterAction(actingSeat: number) {
    if (this.remainingContenders().length === 1) {
      this.awardUncontestedPot();
      return this.getState();
    }

    if (this.isBettingRoundComplete()) {
      this.advanceRound();
      return this.getState();
    }

    this.currentTurnSeat = this.findNextActionableSeatAfter(actingSeat);

    if (this.currentTurnSeat === null) {
      this.advanceRound();
    }

    return this.getState();
  }

  private isBettingRoundComplete() {
    const contenders = this.remainingContenders();

    if (contenders.length <= 1) {
      return true;
    }

    return contenders.every(
      (player) =>
        player.allIn ||
        (player.hasActed && player.currentBet === this.currentBet),
    );
  }

  private advanceRound() {
    while (!isHandTerminal(this.phase)) {
      this.resetBettingRound();

      if (this.phase === "PRE_FLOP") {
        this.dealFlop();
      } else if (this.phase === "FLOP") {
        this.dealTurn();
      } else if (this.phase === "TURN") {
        this.dealRiver();
      } else if (this.phase === "RIVER") {
        this.settleShowdown();
        return;
      }

      if (this.remainingContenders().length === 1) {
        this.awardUncontestedPot();
        return;
      }

      if (this.remainingContenders().filter((player) => !player.allIn).length <= 1) {
        continue;
      }

      this.currentTurnSeat = this.findNextActionableSeatAfter(
        this.requireButtonSeat(),
      );
      return;
    }
  }

  private resetBettingRound() {
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.currentTurnSeat = null;

    for (const player of this.handPlayers()) {
      player.currentBet = 0;
      player.hasActed = false;
    }
  }

  private settleShowdown() {
    if (this.board.length !== 5) {
      throw new PokerEngineError(
        "BOARD_INCOMPLETE",
        "Showdown requires a complete five-card board.",
      );
    }

    this.phase = "SHOWDOWN";
    this.currentTurnSeat = null;
    this.potAwards = [];
    this.showdownHands.clear();

    for (const player of this.remainingContenders()) {
      this.showdownHands.set(
        player.id,
        evaluateHoldemHand(player.id, [...player.holeCards, ...this.board]),
      );
    }

    for (const sidePot of buildSidePots(this.handPlayers())) {
      const eligibleEvaluations = sidePot.eligiblePlayerIds.map((playerId) => {
        const evaluation = this.showdownHands.get(playerId);

        if (!evaluation) {
          throw new PokerEngineError(
            "INVALID_SIDE_POT",
            "Side pot includes a player without a showdown hand.",
          );
        }

        return evaluation;
      });

      const winningEvaluations = findWinningEvaluations(eligibleEvaluations);
      const winners = this.sortPlayerIdsBySeat(
        winningEvaluations.map((evaluation) => evaluation.playerId),
      );
      const share = Math.floor(sidePot.amount / winners.length);
      let remainder = sidePot.amount % winners.length;

      for (const winnerId of winners) {
        const winner = this.requirePlayerById(winnerId);
        const extraChip = remainder > 0 ? 1 : 0;

        winner.stack += share + extraChip;
        remainder -= extraChip;
      }

      this.potAwards.push({
        amount: sidePot.amount,
        winnerIds: winners,
        eligiblePlayerIds: [...sidePot.eligiblePlayerIds],
        handName: winningEvaluations[0]?.name ?? null,
        handDescription: winningEvaluations[0]?.description ?? null,
      });
    }
  }

  private awardUncontestedPot() {
    const winner = this.remainingContenders()[0];
    const amount = this.handPlayers().reduce(
      (total, player) => total + player.committed,
      0,
    );

    winner.stack += amount;
    this.phase = "COMPLETE";
    this.currentTurnSeat = null;
    this.potAwards = [
      {
        amount,
        winnerIds: [winner.id],
        eligiblePlayerIds: [winner.id],
        handName: null,
        handDescription: null,
      },
    ];
  }

  private commitChips(player: EnginePlayer, amount: number) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new PokerEngineError(
        "INVALID_CHIP_AMOUNT",
        "Chip amount must be a non-negative integer.",
      );
    }

    if (amount > player.stack) {
      throw new PokerEngineError(
        "INSUFFICIENT_STACK",
        "Player does not have enough chips.",
      );
    }

    player.stack -= amount;
    player.currentBet += amount;
    player.committed += amount;

    if (player.stack === 0) {
      player.allIn = true;
    }
  }

  private findNextActionableSeatAfter(seat: number) {
    return (
      this.findNextPlayerAfter(
        seat,
        (player) => player.inHand && !player.folded && !player.allIn,
      )?.seat ?? null
    );
  }

  private requireNextPlayerAfter(
    seat: number,
    predicate: (player: EnginePlayer) => boolean,
  ) {
    const player = this.findNextPlayerAfter(seat, predicate);

    if (!player) {
      throw new PokerEngineError("NO_NEXT_PLAYER", "No next player was found.");
    }

    return player;
  }

  private findNextPlayerAfter(
    seat: number,
    predicate: (player: EnginePlayer) => boolean,
  ) {
    return this.playersAfterSeat(seat).find(predicate) ?? null;
  }

  private playersAfterSeat(seat: number) {
    const orderedPlayers = this.orderedPlayers().filter((player) => player.inHand);
    const seatIndex = orderedPlayers.findIndex((player) => player.seat === seat);
    const startIndex = seatIndex === -1 ? 0 : seatIndex + 1;

    return [
      ...orderedPlayers.slice(startIndex),
      ...orderedPlayers.slice(0, startIndex),
    ];
  }

  private orderedPlayers() {
    return [...this.players].sort((left, right) => left.seat - right.seat);
  }

  private handPlayers() {
    return this.orderedPlayers().filter((player) => player.inHand);
  }

  private remainingContenders() {
    return this.handPlayers().filter((player) => !player.folded);
  }

  private requirePlayerById(playerId: string) {
    const player = this.players.find((candidate) => candidate.id === playerId);

    if (!player) {
      throw new PokerEngineError("PLAYER_NOT_FOUND", "Player was not found.");
    }

    return player;
  }

  private requirePlayerBySeat(seat: number) {
    const player = this.players.find((candidate) => candidate.seat === seat);

    if (!player) {
      throw new PokerEngineError("PLAYER_NOT_FOUND", "Player was not found.");
    }

    return player;
  }

  private requireButtonSeat() {
    if (this.buttonSeat === null) {
      throw new PokerEngineError(
        "BUTTON_NOT_SET",
        "Dealer button has not been assigned.",
      );
    }

    return this.buttonSeat;
  }

  private sortPlayerIdsBySeat(playerIds: string[]) {
    const playerIdSet = new Set(playerIds);

    return this.orderedPlayers()
      .filter((player) => playerIdSet.has(player.id))
      .map((player) => player.id);
  }
}
