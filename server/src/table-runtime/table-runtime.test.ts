import assert from "node:assert/strict";
import type {
  LobbySummary,
  PublicHandCompletePayload,
} from "@poker-platform/shared/types";
import {
  cardToNotation,
  createDeck,
  parseCardNotation,
  type Card,
} from "../poker-engine";
import {
  TableRuntime,
  TableRuntimeError,
  type PersistCompletedHandInput,
  type PublicTableState,
  type TableRuntimeRecipient,
} from "./index";

function deckWithTopCards(topCards: string[]) {
  const forcedCards = topCards.map(parseCardNotation);
  const forcedCardKeys = new Set(forcedCards.map(cardToNotation));
  const remainingCards = createDeck().filter(
    (card) => !forcedCardKeys.has(cardToNotation(card)),
  );

  return [...forcedCards, ...remainingCards];
}

function createLobby(): LobbySummary {
  return {
    id: "lobby-1",
    name: "Runtime Test",
    visibility: "PUBLIC",
    status: "WAITING",
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 100,
    maxBuyIn: 1000,
    maxPlayers: 6,
    createdByUserId: "alice",
    createdAt: new Date("2026-04-29T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-04-29T00:00:00.000Z").toISOString(),
    playerCount: 3,
    players: [
      {
        id: "lobby-player-alice",
        userId: "alice",
        name: "Alice",
        email: "alice@example.edu",
        seatNumber: 1,
        stack: 1000,
        status: "JOINED",
        joinedAt: new Date("2026-04-29T00:00:00.000Z").toISOString(),
      },
      {
        id: "lobby-player-bob",
        userId: "bob",
        name: "Bob",
        email: "bob@example.edu",
        seatNumber: 2,
        stack: 100,
        status: "JOINED",
        joinedAt: new Date("2026-04-29T00:00:00.000Z").toISOString(),
      },
      {
        id: "lobby-player-carol",
        userId: "carol",
        name: "Carol",
        email: "carol@example.edu",
        seatNumber: 3,
        stack: 1000,
        status: "JOINED",
        joinedAt: new Date("2026-04-29T00:00:00.000Z").toISOString(),
      },
    ],
  };
}

function createRuntimeHarness(deck: readonly Card[]) {
  const lobby = createLobby();
  const emittedStates = new Map<string, PublicTableState[]>();
  const handCompletePayloads = new Map<string, PublicHandCompletePayload[]>();
  const persistedHands: PersistCompletedHandInput[] = [];
  const activatedLobbyIds: string[] = [];
  const recipients: TableRuntimeRecipient[] = lobby.players.map((player) => ({
    socketId: `socket-${player.userId}`,
    userId: player.userId,
    emitGameState(payload) {
      const states = emittedStates.get(player.userId) ?? [];

      states.push(payload);
      emittedStates.set(player.userId, states);
    },
    emitHandComplete(payload) {
      const payloads = handCompletePayloads.get(player.userId) ?? [];

      payloads.push(payload);
      handCompletePayloads.set(player.userId, payloads);
    },
  }));
  const runtime = new TableRuntime({
    loadLobby: async (lobbyId) => (lobbyId === lobby.id ? lobby : null),
    getRecipients: async () => recipients,
    deckProvider: () => deck,
    activateLobby: async (lobbyId) => {
      activatedLobbyIds.push(lobbyId);
    },
    persistCompletedHand: async (input) => {
      persistedHands.push(input);
    },
    handRestartDelayMs: 0,
  });

  return {
    activatedLobbyIds,
    handCompletePayloads,
    lobby,
    persistedHands,
    runtime,
    emittedStates,
  };
}

function latestState(
  emittedStates: Map<string, PublicTableState[]>,
  playerId: string,
) {
  const states = emittedStates.get(playerId) ?? [];
  const state = states.at(-1);

  assert.ok(state, `Expected a state emitted to ${playerId}.`);

  return state;
}

function assertNoPrivateDeckFields(state: PublicTableState) {
  const rawState = state as unknown as Record<string, unknown>;

  assert.equal("deckCount" in rawState, false);
  assert.equal("burnedCards" in rawState, false);
}

async function testCreatorAuthorization() {
  const { lobby, runtime } = createRuntimeHarness(deckWithTopCards(["As", "Ks"]));

  await assert.rejects(
    () => runtime.startGame(lobby.id, "bob"),
    (error) =>
      error instanceof TableRuntimeError &&
      error.code === "ONLY_CREATOR_CAN_START",
  );
}

async function testPlayerActionBroadcastsSanitizedState() {
  const { lobby, runtime, emittedStates } = createRuntimeHarness(
    deckWithTopCards([
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
    ]),
  );

  await runtime.startGame(lobby.id, "alice");
  assert.equal(latestState(emittedStates, "alice").currentTurnPlayerId, "alice");

  emittedStates.clear();

  await runtime.applyPlayerAction(lobby.id, "alice", {
    action: "raise",
    totalBet: 200,
  });

  const aliceState = latestState(emittedStates, "alice");
  const bobState = latestState(emittedStates, "bob");
  const carolState = latestState(emittedStates, "carol");

  assert.equal(aliceState.currentBet, 200);
  assert.equal(aliceState.currentTurnPlayerId, "bob");
  assert.equal(bobState.currentBet, 200);
  assert.equal(carolState.currentBet, 200);
  assert.deepEqual(
    aliceState.actionLog.map((event) => event.message),
    ["Hand 1 started. Dealing pre-flop.", "Alice raised to 200."],
  );

  for (const state of [aliceState, bobState, carolState]) {
    assertNoPrivateDeckFields(state);
  }

  assert.deepEqual(
    aliceState.players.map((player) => [
      player.id,
      player.holeCards.map(cardToNotation),
      player.hasHiddenHoleCards,
    ]),
    [
      ["alice", ["9h", "9d"], false],
      ["bob", [], true],
      ["carol", [], true],
    ],
  );
  assert.deepEqual(
    bobState.players.map((player) => [
      player.id,
      player.holeCards.map(cardToNotation),
      player.hasHiddenHoleCards,
    ]),
    [
      ["alice", [], true],
      ["bob", ["As", "Ks"], false],
      ["carol", [], true],
    ],
  );
}

async function testCompletedHandPersistsAndRestarts() {
  const {
    lobby,
    runtime,
    persistedHands,
    handCompletePayloads,
    activatedLobbyIds,
    emittedStates,
  } = createRuntimeHarness(
    deckWithTopCards([
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
    ]),
  );

  await runtime.startGame(lobby.id, "alice");
  assert.deepEqual(activatedLobbyIds, [lobby.id]);

  await runtime.applyPlayerAction(lobby.id, "alice", { action: "call" });
  await runtime.applyPlayerAction(lobby.id, "bob", { action: "call" });
  await runtime.applyPlayerAction(lobby.id, "carol", { action: "check" });
  await runtime.applyPlayerAction(lobby.id, "bob", { action: "check" });
  await runtime.applyPlayerAction(lobby.id, "carol", { action: "check" });
  await runtime.applyPlayerAction(lobby.id, "alice", { action: "check" });
  await runtime.applyPlayerAction(lobby.id, "bob", { action: "check" });
  await runtime.applyPlayerAction(lobby.id, "carol", { action: "check" });
  await runtime.applyPlayerAction(lobby.id, "alice", { action: "check" });
  await runtime.applyPlayerAction(lobby.id, "bob", { action: "check" });
  await runtime.applyPlayerAction(lobby.id, "carol", { action: "check" });
  const terminalState = await runtime.applyPlayerAction(lobby.id, "alice", {
    action: "check",
  });

  assert.equal(terminalState.phase, "SHOWDOWN");
  const aliceShowdownState = (emittedStates.get("alice") ?? []).find(
    (state) => state.phase === "SHOWDOWN",
  );

  assert.ok(aliceShowdownState, "Expected a showdown state emitted to Alice.");
  assert.deepEqual(
    aliceShowdownState.players.map((player) => [
      player.id,
      player.holeCards.map(cardToNotation),
      player.hasHiddenHoleCards,
    ]),
    [
      ["alice", ["9h", "9d"], false],
      ["bob", ["As", "Ks"], false],
      ["carol", ["8h", "8d"], false],
    ],
  );
  assert.deepEqual(
    aliceShowdownState.actionLog.map((event) => event.message).slice(-3),
    [
      "Alice checked.",
      "Showdown. Revealing live hands.",
      "Bob wins 60 with Royal Flush.",
    ],
  );
  assert.deepEqual(aliceShowdownState.handHistory.map((hand) => hand.handNumber), [
    1,
  ]);
  assert.equal(persistedHands.length, 1);
  assert.equal(persistedHands[0].handNumber, 1);
  assert.equal(persistedHands[0].potSize, 60);
  assert.deepEqual(persistedHands[0].winnerUserIds, ["bob"]);
  assert.deepEqual(
    persistedHands[0].playerStacks.map((player) => [
      player.userId,
      player.chipStack,
    ]),
    [
      ["alice", 980],
      ["bob", 140],
      ["carol", 980],
    ],
  );

  const bobPayload = handCompletePayloads.get("bob")?.at(-1);

  assert.ok(bobPayload && typeof bobPayload === "object");
  assert.deepEqual(bobPayload.winners, [
    {
      playerId: "bob",
      name: "Bob",
      amount: 60,
      handName: "Straight Flush",
      handDescription: "Royal Flush",
    },
  ]);
  assert.equal(runtime.getTableState(lobby.id).phase, "PRE_FLOP");
  const bobRestartState = latestState(emittedStates, "bob");

  assert.equal(bobRestartState.phase, "PRE_FLOP");
  assert.deepEqual(
    bobRestartState.actionLog.map((event) => event.message),
    ["Hand 2 started. Dealing pre-flop."],
  );
  assert.deepEqual(bobRestartState.handHistory.map((hand) => hand.handNumber), [1]);
}

await testCreatorAuthorization();
await testPlayerActionBroadcastsSanitizedState();
await testCompletedHandPersistsAndRestarts();

console.log("Table runtime mock socket test passed.");
