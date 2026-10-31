# @poker-platform/engine

A pure TypeScript poker engine for No-Limit Hold'em and Pot-Limit Omaha. It has no Node-only imports, so the
same code runs on the game server and in the browser (equity calculator). Randomness is injected. All chip
amounts are integers.

```
npm test --workspace packages/engine          # vitest: rules fixtures, exhaustive evaluator checks, 6,000-hand fuzz
npm run bench --workspace packages/engine     # evaluator / equity benchmark
npm run verify:7card --workspace packages/engine  # all 133,784,560 seven-card hands by category
```

Modules: `cards` (codes, deck, Fisher-Yates), `evaluator` (5-7 card), `omaha`, `betting` (legal actions),
`pots` (side pots, splits), `positions`, `showdown`, `stats`, `hand` (state machine), `equity`, `range`.

## Cards

Cards are strings: rank `23456789TJQKA` + suit `cdhs`, e.g. `"As"`, `"Td"`. `toPublicCard("Td")` gives the wire
`PublicCard` (`{ rank: "T", suit: "d" }`). `shuffledDeck(randomInt)` shuffles with an injected
`randomInt(maxExclusive)`; the server passes `crypto.randomInt`.

## Playing a hand

```ts
import { randomInt } from "node:crypto";
import { PokerHand, computePositions } from "@poker-platform/engine";

// Optional: find the UTG seat to know who may straddle (null heads-up).
const { straddleSeat } = computePositions(seats, buttonSeat);

const hand = PokerHand.start(
  {
    handId: "h_123",                       // echoed in events/summary
    variant: "NLHE",                       // or "PLO" (4 hole cards, pot limit)
    players: [{ id: "u1", seat: 1, stack: 1000 }, { id: "u2", seat: 4, stack: 800 }], // dealt-in players only
    buttonSeat: 1,                         // may be an empty seat (dead button)
    smallBlind: 5,
    bigBlind: 10,
    ante: 0,
    straddleSeat: null,                    // must equal computePositions(...).straddleSeat if set
    bombPot: null,                         // { ante: 20, doubleBoard: true } -> no blinds, flop dealt at once
    runItTwice: true,                      // allow the run-it-twice pause (ignored for double-board)
    extraBlindPlayerIds: [],               // players posting a live BB out of position (new players)
  },
  { randomInt },                           // or { deck: [...] } to inject a deck order (tests/replays)
);
```

The engine picks the blinds from the button (SB = first dealt-in seat left of the button, BB next; heads-up the
button posts the SB, acts first preflop and last postflop). A straddle is skipped (no event,
`snapshot().straddleSeat === null`) when the straddler would have no chips behind it; a wrong straddle seat
throws `INVALID_STRADDLE`. Straddle/extra blinds are ignored in bomb pots.

### Loop

```ts
while (!hand.isComplete) {
  if (hand.status === "BETTING") {
    const id = hand.toActPlayerId!;
    const legal = hand.legalActions(id);    // LegalActions (identical to the wire type), null if not their turn
    hand.act(id, { type: "raise", amount: 60 }); // see actions below; throws EngineError on illegal input
    // or hand.timeout()                       // check if possible, else fold (reason "timeout")
  } else if (hand.status === "RUNOUT_DECISION") {
    // Everyone (or all but one) is all-in before the river and runItTwice was allowed.
    hand.runoutDecisionPlayerIds();          // live players who vote
    hand.chooseRunout(2);                    // or 1: deals the rest (twice) and settles
  }
}
const summary = hand.summary!;
```

Actions (`act(playerId, action)`):

| type | meaning |
|---|---|
| `fold` | always legal on your turn |
| `check` | only when `legal.canCheck` |
| `call` | only when `legal.callAmount > 0` (calls all-in when short) |
| `bet` / `raise` | `amount` = street total ("to"), `minTo <= amount <= maxTo`; the two are interchangeable, the engine records the right one |
| `allin` | whole stack: becomes a call if the stack does not cover the call, else a bet/raise; rejected (`CANNOT_RAISE`) when a raise is not allowed or (PLO) the stack exceeds the pot limit |

`foldOutOfTurn(playerId)` folds a player who left the table at any time (returns false when the hand is over, the
player already folded, or is all-in: an all-in hand stays live). If it was their turn it is a normal fold.

Errors are `EngineError` with a `code`: `NOT_YOUR_TURN`, `CANNOT_CHECK`, `NOTHING_TO_CALL`, `CANNOT_RAISE`,
`INVALID_AMOUNT`, `NOT_BETTING`, `HAND_COMPLETE`, `NOT_RUNOUT_DECISION`, `UNKNOWN_PLAYER`, `INVALID_CONFIG`, ...
A rejected action never changes the state.

### Legal actions

`{ canFold, canCheck, callAmount, canBetOrRaise, isBet, minTo, maxTo, potTo }` — `minTo/maxTo/potTo` are 0 when
`canBetOrRaise` is false. Rules implemented:

- Min bet = BB; min raise = last full bet/raise size (straddle: min raise to 2x straddle). An all-in below the
  minimum is allowed (`minTo` is capped at the all-in total).
- An incomplete all-in raise does not reopen betting for players who already acted (call/fold only); players yet
  to act may raise. Several incomplete raises that add up to a full raise reopen it.
- A short all-in BB: others still call the full BB. No raising when nobody else can respond.
- PLO: `maxTo` = pot after calling (`currentBet + pot + (currentBet - myStreetBet)`); `potTo === maxTo`.
  NLHE: `maxTo` = all-in, `potTo` = the pot-sized raise capped to `[minTo, maxTo]`.

### Reading state

- `hand.snapshot()` — render-ready `HandSnapshot` (no deck): status, `phase` (wire `HandPhase`; the engine
  never rests in `SHOWDOWN`, use `summary.showdown`), street, boards, positions, `toActPlayerId`, `currentBet`,
  settled `pots` (main first, `eligiblePlayerIds`), `totalPot` (pots + current bets), players with `stack`,
  `streetBet`, `committed`, `folded`, `allIn`, `holeCards` (**redact per viewer**) and `lastAction`
  (wire-compatible: `{ type, amount }`, reset each street except fold/all-in).
- `hand.legalActions(id)`, `hand.pots()`, `hand.totalPot()`, `hand.getPlayer(id)`, `hand.boards`.
- Persistence: `hand.getState()` returns a JSON-safe `HandState` (**contains the deck**: server only);
  `PokerHand.fromState(state)` resumes it. `state.deck` is the shuffled deck for the commitment hash.

### Events

`hand.events` / `hand.eventsSince(seq)` (each has `seq`): `HAND_START`, `POST` (`ANTE`, `BOMB_POT_ANTE`,
`SMALL_BLIND`, `BIG_BLIND`, `EXTRA_BLIND`, `STRADDLE`), `HOLE_CARDS` (**private**), `ACTION` (action, chips
added, `to`, `allIn`, `stackAfter`, `potAfter`, `facingAmount`, `raisesBefore`, `couldRaise`, `fullRaise`,
`reason: "timeout" | "left" | null`, `outOfTurn`), `STREET` (per board: `boardIndex`, new cards, full board),
`UNCALLED_RETURN` (its own event; never counted as winnings), `RUNOUT_DECISION`, `RUNOUT` (`runs`),
`SHOWDOWN` (showing order, cards, `mustShow`/`showReason`, hand per board), `POT_AWARD` (per pot per board,
winners with amounts and hand names), `HAND_END` (final stacks). Typical runtime pattern: remember the last
`seq` you processed and call `eventsSince(lastSeq + 1)` after each command.

### Showdown and splitting

- Order: last aggressor of the final betting round (if still in), else first live player left of the button.
- `mustShow`: winners (`WINNER`), all-in players / all-in runouts (`ALL_IN`, everyone shows), the called last
  aggressor (`CALLED`). Everyone else may muck.
- Side pots are layered by all-in amounts; folded chips are dead money. Each pot is split per board (double
  board / run it twice; odd chip to board 1), each board evaluated independently; odd chips go to the first
  winner left of the button.

### Summary (`hand.summary`, set when complete)

Hand: variant, positions, blinds/ante (bomb ante for bomb pots), `isBombPot`, `doubleBoard`, `runs`, `boards`,
`endedOn`, `showdown`, `isWalk`, `preflopStatsEligible` (false for bomb pots), `totalPot`, `pots` (with awards
per board), `allIn` (street/board/players when an all-in closed the action: use for all-in EV).

Per player: `startingStack`, `endingStack`, `net`, `committed`, `uncalledReturned`, `won`, `wonPerPot`
(`{potIndex, boardIndex, amount}`), `holeCards`, `folded`, `foldedStreet`, `allIn`, `wentToShowdown`,
`wonAtShowdown`, `mustShow`, `showReason`, `hands` (per board), position flags and `stats`:
`vpip`, `pfr`, `threeBet`, `threeBetOpportunity`, `facedThreeBet`, `foldedToThreeBet`, `cbet`,
`cbetOpportunity`, `sawFlop`, postflop bet/raise/call/check/fold counts (PokerTracker definitions; preflop
flags are false in bomb pots).

## Evaluator

```ts
evaluateHand(["As", "Ks", "Qs", "Js", "Ts", "2c", "3d"]); // { value, category, categoryName, name, description, bestFive }
evaluateOmaha(hole4, board);   // exactly 2 hole + 3 board
compareHands(a, b);            // > 0 when a wins
```

`value` is a comparable integer (higher wins, equal ties). Fast index API for hot loops: `cardToIndex`,
`evaluate7(a..g)`, `evaluateIndices(arr)`, `evaluate5`, `evaluateOmahaIndices`. Names look like
`"Full House, Kings full of Sevens"`, `"Two Pair, Kings and Sevens"`, `"Straight, Five high"`, `"Royal Flush"`.

## Equity

```ts
calculateEquity({ hands: [["Ah","Ad"], ["Ks","Kc"]], board: [], dead: [], variant: "NLHE" });
// { exact: true, samples: 1712304, results: [{ win, tie, equity }, ...] }
```

Exact enumeration when `boards x hands x cost <= maxExactEvaluations` (default 4M; PLO costs 60 per hand), else
Monte Carlo (`iterations`, default 20,000, `randomInt` defaults to Math.random). `parseRange("AKs, TT+, A5s-A2s")`
returns combos; `calculateRangeEquity({ ranges, board, variant })` runs Monte Carlo range vs range.

## Known limits

No rake, no limit games, no dead/missed-blind accounting beyond `extraBlindPlayerIds`, run it twice is limited to
two runs, and RIT is not offered on double-board bomb pots.
