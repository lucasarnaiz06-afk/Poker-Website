import assert from "node:assert/strict";
import type { LobbySummary } from "@poker-platform/shared/types";
import {
  cardToNotation,
  createDeck,
  parseCardNotation,
  type Card,
} from "../poker-engine";
import {
  TableRuntime,
  TableRuntimeError,
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
  const recipients: TableRuntimeRecipient[] = lobby.players.map((player) => ({
    socketId: `socket-${player.userId}`,
    userId: player.userId,
    emitGameState(payload) {
      const states = emittedStates.get(player.userId) ?? [];

      states.push(payload);
      emittedStates.set(player.userId, states);
    },
  }));
  const runtime = new TableRuntime({
    loadLobby: async (lobbyId) => (lobbyId === lobby.id ? lobby : null),
    getRecipients: async () => recipients,
    deckProvider: () => deck,
  });

  return { lobby, runtime, emittedStates };
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

await testCreatorAuthorization();
await testPlayerActionBroadcastsSanitizedState();

console.log("Table runtime mock socket test passed.");
