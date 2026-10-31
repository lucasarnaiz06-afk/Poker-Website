# Architecture and build plan

Multiplayer poker site (play-money chips) built to grow into a real product. Read this before changing code.

## Stack (keep it)
- `client/` Next.js 14 App Router, React 18, Tailwind 3, NextAuth v4 (Prisma adapter, database sessions).
  Pages read/write the DB through server components, server actions and route handlers using `@poker-platform/shared`.
- `server/` Express + Socket.io game server (port 4000). Realtime only: tables, actions, votes, chat.
  The browser reaches it through the Next rewrite `/socket.io` (same origin, the NextAuth session cookie is sent).
- `packages/shared/` Prisma client, auth/session helpers, domain services (lobbies, wallet, hands, stats), wire types.
- PostgreSQL 16 via `docker compose up -d postgres`; schema `server/prisma/schema.prisma`, migrations with
  `npm run prisma:migrate -- --name <name>` (never edit an applied migration).

## Non-negotiables
1. **Server-authoritative.** The client only sends intents; the server validates everything. Never trust client amounts,
   seats, user ids or timing.
2. **Hidden information.** Other players' hole cards never leave the server unless shown at showdown or voluntarily.
   The deck, burn cards and future board cards are never sent before they are dealt.
3. **Chips are conserved.** Every chip movement between a user's wallet and a table goes through the ledger
   (`packages/shared/src/wallet`), inside a DB transaction, with `balance >= 0` enforced in SQL. Sum of wallet balances +
   chips on tables only changes via explicit ledger entry types (signup bonus, daily bonus, admin adjustment).
   A server crash mid-hand voids the hand: stacks are persisted only at hand boundaries.
4. **Fair shuffle.** `crypto.randomInt` Fisher-Yates. Each hand publishes a commitment over per-position salted leaf
   hashes at the start; after the hand each viewer gets a proof opening only the cards they were entitled to see
   (leaf hashes for the rest), so they can verify the deck wasn't changed mid-hand without learning mucked cards.
   The full reveal stays server-side. Scheme: `packages/shared/src/hands/deck-proof.ts`.
5. **Validate every input** (sockets, server actions, route handlers) with zod schemas; reject unknown fields.
6. **Security basics:** httpOnly/secure/SameSite cookies, Origin checks on sockets and mutations, per-user and per-IP rate
   limits (auth, chat, actions), no secrets in code or logs, CSP/security headers, generic auth errors (no account
   enumeration), parameterized queries only (Prisma), audit log for money and account events.
7. **Integers only** for chips. No floats in game or ledger math.
8. Real-money play is out of scope (it needs licensing, KYC, geofencing). Keep chips play-money and never add payments.

## Wire contract
- Table settings: `packages/shared/src/types/table-settings.ts` (stored as `Lobby.settings` JSON).
- Realtime: `packages/shared/src/types/table-view.ts`: full per-viewer `TableView` snapshots on `table:state`,
  ack-based client events. Old `PublicTableState` / `game_state_update` types are legacy and will be removed.
- Engine: `packages/engine` (`@poker-platform/engine`, pure TS, also used in the browser for equity). API in its README.
- Game runtime: `server/src/table-runtime` (one actor per table with a sequential command queue; ports for wallet,
  hand store, lobby store, clock, RNG). Hands are persisted with `persistCompletedHand` (`packages/shared/src/hands`).
- Change these files only additively.

## Side games (table-level, toggled in settings, started/stopped by vote)
- **Bomb pot**: a passed vote (or every N hands) makes the next hand a bomb pot: every dealt-in player antes
  `anteBB`, no preflop betting, flop dealt immediately, action starts left of the button; optional double board
  (each pot split in half per board, odd chip to board 1).
- **Nit game**: when started, every dealt-in active player is a "nit". Winning any pot (or a share of one) makes you safe.
  When exactly one nit is left, that player pays `penaltyBB` to every other participant (capped by their stack, paid
  after the hand), and the round ends. Players who join after the start aren't in that round. A nit who stands up
  pays the penalty on leaving. Shown on seats with a badge.
- **7-2 bounty**: while active, a player who wins a pot holding 7-2 (any suits) and shows it collects `bountyBB` from
  every other player dealt into that hand (capped by each payer's stack). Must show; winning uncontested lets you
  click "Show" to claim.
- **Run it twice**: when all players are all-in before the river and RIT is enabled, all-in players get a short vote;
  if all accept, the remaining board is dealt twice and each pot is split per board.
- Votes: one open vote per kind; 20 s to vote; `majority` = more than half of eligible yes, `unanimous` = all yes
  (any no fails fast); eligible = seated players not sitting out; 60 s cooldown per proposer per kind after a fail.

## Code map
| Area | Paths |
|---|---|
| Engine | `packages/engine/**` |
| Data + accounts | `server/prisma/**`, `packages/shared/src/{auth,db,accounts,wallet,users}/**`, `client/app/{auth,account,u,settings}/**`, `client/lib/auth/**`, `client/app/api/auth/**`, `client/middleware.ts` |
| Design system + shell + lobby | `client/components/ui/**`, `client/components/shell/**`, `client/components/lobby/**` (not poker-table.tsx), `client/app/{layout,page,providers}.tsx`, `client/app/lobby/**`, `packages/shared/src/lobbies/**` |
| Table UI | `client/components/table/**`, `client/app/dev/**` |
| Runtime + realtime | `server/src/{table-runtime,realtime,http,security,config}/**` |
| History, stats, leaderboards | `packages/shared/src/{hands,stats}/**`, `client/app/{hands,stats,leaderboard,tools}/**`, `client/components/{hands,stats}/**` |

## Conventions
- TypeScript strict, no `any`. Match surrounding style. Small focused modules.
- Tests: vitest (`npm test --workspace <ws>`). Every rule and money path gets tests.
- UI: tokens and rules in `docs/DESIGN.md`. Use `lucide-react` icons. Every screen must work at 375 px wide.

## Testing
- Unit: `npm test --workspace packages/engine|packages/shared|server|client` (shared tests use the `poker_platform_test` DB).
- E2E: `npm run e2e` (Playwright, real dev servers on :3000/:4000, creates its own users, asserts chip conservation).

## Scaling to production (not done yet)
- **Table ownership across instances.** Tables live in one game-server process. With several instances, add a table
  lease (e.g. a `TableLease` row or Redis lock with heartbeat) so exactly one instance runs a table and boot recovery
  never refunds a table another live instance owns; route sockets by table id (sticky sessions or a router), and use
  the Socket.io Redis adapter for lobby broadcasts.
- **Rate limits** are in-process (game server) or Postgres-backed (auth); move hot ones to Redis.
- **WebSockets** must be routed by the reverse proxy (`/socket.io` → game server); the Next dev rewrite only long-polls.
- **Framework upgrade.** Next 14 / NextAuth v4 carry advisories only fixed in Next 15+/Auth.js v5; plan that migration.
- **Observability.** Structured logs (pino) with request ids, metrics for hands/min, action latency, socket counts; alerting on
  ledger invariants (sum of wallets + table stacks vs. issued chips).
