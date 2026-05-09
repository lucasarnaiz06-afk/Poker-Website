import assert from "node:assert/strict";
import {
  cardToNotation,
  createDeck,
  parseCardNotation,
  shuffleDeck,
  type Card,
} from "./cards";
import { evaluateHoldemHand, findWinningEvaluations } from "./hand-evaluator";
import { PokerEngine, PokerEngineError } from "./poker-engine";

function deckWithTopCards(topCards: string[]) {
  const forcedCards = topCards.map(parseCardNotation);
  const forcedCardKeys = new Set(forcedCards.map(cardToNotation));
  const remainingCards = createDeck().filter(
    (card) => !forcedCardKeys.has(cardToNotation(card)),
  );

  return [...forcedCards, ...remainingCards];
}

function getPlayerStack(state: ReturnType<PokerEngine["getState"]>, playerId: string) {
  const player = state.players.find((candidate) => candidate.id === playerId);

  assert.ok(player, `Expected player ${playerId} to exist.`);

  return player.stack;
}

function assertEngineErrorCode(error: unknown, code: string) {
  assert.ok(error instanceof PokerEngineError);
  assert.equal(error.code, code);
}

function testDeck() {
  const deck = createDeck();
  const uniqueCards = new Set(deck.map(cardToNotation));

  assert.equal(deck.length, 52);
  assert.equal(uniqueCards.size, 52);

  const reverseRandom = () => 0;
  const shuffled = shuffleDeck(deck, reverseRandom);

  assert.equal(shuffled.length, 52);
  assert.equal(new Set(shuffled.map(cardToNotation)).size, 52);
  assert.notDeepEqual(
    shuffled.map(cardToNotation),
    deck.map(cardToNotation),
  );
}

function testSimulatedSidePotShowdown() {
  const engine = new PokerEngine({ smallBlind: 10, bigBlind: 20 });
  const deck: Card[] = deckWithTopCards([
    "As", // Bob, seat 2
    "8h", // Carol, seat 3
    "9h", // Alice, seat 1
    "Ks", // Bob
    "8d", // Carol
    "9d", // Alice
    "4c", // flop burn
    "Qs",
    "Js",
    "Ts",
    "5c", // turn burn
    "2d",
    "6c", // river burn
    "3c",
  ]);

  engine.addPlayer({ id: "alice", seat: 1, stack: 1000 });
  engine.addPlayer({ id: "bob", seat: 2, stack: 100 });
  engine.addPlayer({ id: "carol", seat: 3, stack: 1000 });

  let state = engine.startHand({ buttonSeat: 1, deck });

  assert.equal(state.phase, "PRE_FLOP");
  assert.equal(state.currentTurnPlayerId, "alice");
  assert.deepEqual(
    state.players.map((player) => [
      player.id,
      player.holeCards.map(cardToNotation),
    ]),
    [
      ["alice", ["9h", "9d"]],
      ["bob", ["As", "Ks"]],
      ["carol", ["8h", "8d"]],
    ],
  );

  assert.throws(
    () => engine.check("alice"),
    (error) => {
      assertEngineErrorCode(error, "CHECK_NOT_ALLOWED");
      return true;
    },
  );
  assert.throws(
    () => engine.call("bob"),
    (error) => {
      assertEngineErrorCode(error, "OUT_OF_TURN");
      return true;
    },
  );
  assert.throws(
    () => engine.raise("alice", 30),
    (error) => {
      assertEngineErrorCode(error, "RAISE_TOO_SMALL");
      return true;
    },
  );

  state = engine.raise("alice", 200);
  assert.equal(state.currentTurnPlayerId, "bob");

  state = engine.call("bob");
  assert.equal(state.players.find((player) => player.id === "bob")?.allIn, true);
  assert.equal(state.currentTurnPlayerId, "carol");

  state = engine.call("carol");
  assert.equal(state.phase, "FLOP");
  assert.equal(state.currentTurnPlayerId, "carol");
  assert.deepEqual(state.board.map(cardToNotation), ["Qs", "Js", "Ts"]);
  assert.deepEqual(
    state.pot.sidePots.map((pot) => ({
      amount: pot.amount,
      eligiblePlayerIds: pot.eligiblePlayerIds,
    })),
    [
      { amount: 300, eligiblePlayerIds: ["alice", "bob", "carol"] },
      { amount: 200, eligiblePlayerIds: ["alice", "carol"] },
    ],
  );

  state = engine.check("carol");
  assert.equal(state.currentTurnPlayerId, "alice");
  state = engine.check("alice");
  assert.equal(state.phase, "TURN");
  assert.deepEqual(state.board.map(cardToNotation), ["Qs", "Js", "Ts", "2d"]);
  assert.equal(state.currentTurnPlayerId, "carol");

  state = engine.check("carol");
  state = engine.check("alice");
  assert.equal(state.phase, "RIVER");
  assert.deepEqual(state.board.map(cardToNotation), [
    "Qs",
    "Js",
    "Ts",
    "2d",
    "3c",
  ]);
  assert.equal(state.currentTurnPlayerId, "carol");

  state = engine.check("carol");
  state = engine.check("alice");

  assert.equal(state.phase, "SHOWDOWN");
  assert.equal(state.pot.total, 500);
  assert.deepEqual(state.pot.awards, [
    {
      amount: 300,
      winnerIds: ["bob"],
      eligiblePlayerIds: ["alice", "bob", "carol"],
      handName: "Straight Flush",
      handDescription: "Royal Flush",
    },
    {
      amount: 200,
      winnerIds: ["alice"],
      eligiblePlayerIds: ["alice", "carol"],
      handName: "Pair",
      handDescription: "Pair, 9's",
    },
  ]);
  assert.equal(getPlayerStack(state, "alice"), 1000);
  assert.equal(getPlayerStack(state, "bob"), 300);
  assert.equal(getPlayerStack(state, "carol"), 800);
}

function testAllInBetStillRequiresNextPlayerToCall() {
  const engine = new PokerEngine({ smallBlind: 10, bigBlind: 20 });
  const deck: Card[] = deckWithTopCards([
    "Ah", // Bob, seat 2
    "Ks", // Alice, seat 1
    "Ad", // Bob
    "Kc", // Alice
    "2s", // flop burn
    "7h",
    "4d",
    "2c",
    "3s", // turn burn
    "9c",
    "5s", // river burn
    "Qd",
  ]);

  engine.addPlayer({ id: "alice", seat: 1, stack: 1000 });
  engine.addPlayer({ id: "bob", seat: 2, stack: 100 });

  let state = engine.startHand({ buttonSeat: 1, deck });

  state = engine.call("alice");
  assert.equal(state.currentTurnPlayerId, "bob");
  state = engine.check("bob");
  assert.equal(state.phase, "FLOP");
  assert.equal(state.currentTurnPlayerId, "bob");

  state = engine.raise("bob", 80);
  assert.equal(state.phase, "FLOP");
  assert.equal(state.currentTurnPlayerId, "alice");
  assert.equal(state.players.find((player) => player.id === "bob")?.allIn, true);
  assert.equal(state.players.find((player) => player.id === "alice")?.currentBet, 0);

  state = engine.call("alice");
  assert.equal(state.phase, "SHOWDOWN");
  assert.deepEqual(state.board.map(cardToNotation), [
    "7h",
    "4d",
    "2c",
    "9c",
    "Qd",
  ]);
}

function testShortAllInRaiseStillRequiresRemainingAction() {
  const engine = new PokerEngine({ smallBlind: 10, bigBlind: 20 });
  const deck: Card[] = deckWithTopCards([
    "Ah", // Bob, seat 2
    "Qs", // Carol, seat 3
    "Ks", // Alice, seat 1
    "Ad", // Bob
    "Qd", // Carol
    "Kc", // Alice
    "2s", // flop burn
    "7h",
    "4d",
    "2c",
    "3s", // turn burn
    "9c",
    "5s", // river burn
    "Td",
  ]);

  engine.addPlayer({ id: "alice", seat: 1, stack: 1000 });
  engine.addPlayer({ id: "bob", seat: 2, stack: 130 });
  engine.addPlayer({ id: "carol", seat: 3, stack: 1000 });

  let state = engine.startHand({ buttonSeat: 1, deck });

  state = engine.call("alice");
  state = engine.call("bob");
  state = engine.check("carol");
  assert.equal(state.phase, "FLOP");
  assert.equal(state.currentTurnPlayerId, "bob");

  state = engine.check("bob");
  state = engine.check("carol");
  state = engine.raise("alice", 100);
  assert.equal(state.currentTurnPlayerId, "bob");

  state = engine.raise("bob", 110);
  assert.equal(state.phase, "FLOP");
  assert.equal(state.currentTurnPlayerId, "carol");
  assert.equal(state.players.find((player) => player.id === "bob")?.allIn, true);

  state = engine.call("carol");
  assert.equal(state.phase, "FLOP");
  assert.equal(state.currentTurnPlayerId, "alice");

  state = engine.call("alice");
  assert.equal(state.phase, "TURN");
  assert.equal(state.currentTurnPlayerId, "carol");
}

function testRiverCheckStillGivesInPositionPlayerAction() {
  const engine = new PokerEngine({ smallBlind: 10, bigBlind: 20 });
  const deck: Card[] = deckWithTopCards([
    "Ah", // Bob, seat 2
    "Ks", // Alice, seat 1
    "Qd", // Bob
    "Jc", // Alice
    "2s", // flop burn
    "7h",
    "4d",
    "2c",
    "3s", // turn burn
    "9c",
    "5s", // river burn
    "Td",
  ]);

  engine.addPlayer({ id: "alice", seat: 1, stack: 1000 });
  engine.addPlayer({ id: "bob", seat: 2, stack: 1000 });

  let state = engine.startHand({ buttonSeat: 1, deck });

  state = engine.call("alice");
  state = engine.check("bob");
  state = engine.check("bob");
  state = engine.check("alice");
  state = engine.check("bob");
  state = engine.check("alice");

  assert.equal(state.phase, "RIVER");
  assert.equal(state.currentTurnPlayerId, "bob");

  state = engine.check("bob");
  assert.equal(state.phase, "RIVER");
  assert.equal(state.currentTurnPlayerId, "alice");

  state = engine.check("alice");
  assert.equal(state.phase, "SHOWDOWN");
}

function testFlushBeatsStraight() {
  const straight = evaluateHoldemHand("straight", [
    "As",
    "Kd",
    "Qc",
    "Jh",
    "Ts",
    "2c",
    "3d",
  ].map(parseCardNotation));
  const flush = evaluateHoldemHand("flush", [
    "Ah",
    "Qh",
    "8h",
    "4h",
    "2h",
    "Kc",
    "3d",
  ].map(parseCardNotation));

  assert.deepEqual(
    findWinningEvaluations([straight, flush]).map((hand) => hand.playerId),
    ["flush"],
  );
}

testDeck();
testSimulatedSidePotShowdown();
testAllInBetStillRequiresNextPlayerToCall();
testShortAllInRaiseStillRequiresRemainingAction();
testRiverCheckStillGivesInPositionPlayerAction();
testFlushBeatsStraight();

console.log("Poker engine tests passed.");
