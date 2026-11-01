# Poker Platform

[![CI](https://github.com/lucasarnaiz06-afk/Poker-Website/actions/workflows/ci.yml/badge.svg)](https://github.com/lucasarnaiz06-afk/Poker-Website/actions/workflows/ci.yml)

Multiplayer No-Limit Hold'em and Pot-Limit Omaha with play-money chips: a Next.js client, a server-authoritative
Socket.io game server and PostgreSQL. Real-money play is out of scope.

## Features

- **Poker engine** (`packages/engine`): pure TypeScript, shared by the server and the browser. 5–7 card evaluator
  checked against all 133,784,560 seven-card hands, PLO, side pots and split pots, straddles, run it twice, bomb pots
  with an optional double board. Tested with rule fixtures, adversarial cases and a 6,000-hand fuzz test.
- **Game server** (`server/src/table-runtime`): one actor per table with a sequential command queue. The client only
  sends intents. Other players' hole cards and undealt cards never leave the server.
- **Tamper-evident deck**: `crypto.randomInt` Fisher-Yates. Each hand publishes a commitment over salted per-card
  hashes, and after the hand every viewer gets a proof for the cards they were allowed to see, so they can check the
  deck wasn't changed mid-hand. It does not prove the shuffle itself was fair: that would need player-contributed
  entropy.
- **Chip ledger**: integer chips, every wallet/table movement in a DB transaction, balances can't go negative, and the
  runtime and end-to-end tests assert that chips are conserved, including side-game payments.
- **Side games** started by table vote: bomb pots, nit game, 7-2 bounty, run it twice.
- **Hand history and stats**: hand replayer, PokerStars-format export, VPIP/PFR and other player stats, all-in EV,
  leaderboards, and a browser equity/range calculator. Rule-based bots with five playing styles seed realistic hands
  for development and tests.
- **Accounts**: username/password (argon2id) with optional TOTP 2FA, email magic links, Google sign-in, email
  verification, rate limiting, and an admin command center.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create local environment values and an encryption key for 2FA secrets:

   ```bash
   cp .env.example .env
   echo "AUTH_ENCRYPTION_KEY=\"$(openssl rand -base64 32)\"" >> .env   # or fill in the empty value
   ```

3. Start PostgreSQL:

   ```bash
   docker compose up -d postgres
   ```

4. Generate Prisma client and run the initial migration:

   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

5. Run the client and server in separate terminals:

   ```bash
   npm run dev:client
   npm run dev:server
   ```

The client runs on `http://localhost:3000`. The standalone server defaults to `http://localhost:4000`.

### Realtime connection (WebSockets)

Browsers open their Socket.io connection in one of two ways:

- **Direct (local dev default):** `NEXT_PUBLIC_SOCKET_URL="http://localhost:4000"`. The browser connects to the
  game server itself, so the transport upgrades from long-polling to WebSocket. The game server accepts the page's
  Origin (`CLIENT_ORIGIN`/`CLIENT_ORIGINS`, plus any `http://localhost:3000-3999` outside production) and reads
  the session cookie, which the browser sends because `localhost:3000` and `localhost:4000` are the same site.
  When the page is opened from another host (a phone on the LAN, an ngrok tunnel), a loopback
  `NEXT_PUBLIC_SOCKET_URL` is ignored and the client falls back to the same-origin path below.
- **Same origin (`NEXT_PUBLIC_SOCKET_URL` empty):** the browser requests `/socket.io` on the app's own origin.
  The Next.js rewrite to the game server only proxies HTTP, so WebSocket upgrades through `next dev`/`next start`
  hang and clients stay on long-polling (it works, with higher latency).

**Production:** put a reverse proxy in front of both processes on one domain and route `/socket.io` (HTTP and
WebSocket upgrades) to the game server, everything else to Next. Leave `NEXT_PUBLIC_SOCKET_URL` empty so the
browser uses the same origin, and the session cookie is sent automatically. For example with nginx:

```nginx
location /socket.io/ {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 75s;
}
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Set `CLIENT_ORIGIN` on the game server to the public origin (e.g. `https://poker.example.com`), and
`TRUST_PROXY_HOPS=1` / `TRUSTED_PROXY_COUNT=1` for the single proxy hop. Prefer this over a separate realtime subdomain
(`NEXT_PUBLIC_SOCKET_URL="https://rt.example.com"`): the session cookie is host-only, so another host would not
receive it without changing the cookie domain.

## Accounts and sign-in

- Anyone can sign up. `ALLOWED_EMAIL_DOMAINS` is an optional allow-list (empty = open sign-up).
- Sign-in methods: username/email + password (argon2id, optional TOTP 2FA with recovery codes), email magic link,
  and Google (shown only when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set). All of them create a NextAuth
  database `Session` row and the standard NextAuth session cookie, which the Socket.io server also reads.
- New accounts pick a username + avatar at `/onboarding` and get 10,000 play-money chips once their email is
  verified (magic-link and Google sign-ins count as verified; password accounts get it after the email link). Daily bonus and a
  once-a-day refill live under `/account/wallet`.
- Emails (verification, password reset, magic links) are printed to the Next.js server console in development
  (`EMAIL_TRANSPORT=console`, the default unless `NODE_ENV=production`). Set `EMAIL_TRANSPORT=smtp` to send them.
- Auth endpoints are rate limited per account/email, site-wide for sign-ups, and per IP when the client IP is
  known (DB-backed). See "Security notes" below for proxy settings.
- If `NEXTAUTH_URL` is a public tunnel (ngrok), set `INTERNAL_APP_URL="http://localhost:3000"` so middleware
  session checks stay local.

### Security notes

Client IPs come from forwarding headers, which any client can forge unless a proxy you control sets them.
Both apps therefore ignore them by default; configure them to match your deployment:

- `TRUSTED_PROXY_COUNT` (Next.js, default `0`): number of reverse proxies in front of Next that append to
  `X-Forwarded-For` (e.g. `1` behind nginx, a load balancer or ngrok). The client IP is then the Nth entry from
  the right. With `0`, forwarding headers are ignored and per-IP auth limits are skipped; per-account, per-email
  and site-wide limits (`REGISTRATION_RATE_LIMIT_PER_MINUTE`, default 20 sign-ups/minute) still apply.
- `TRUST_PROXY_HOPS` (game server, default `0`): Express `trust proxy` hop count for `request.ip`. Leave it at
  `0` when the server is only reached through the Next `/socket.io` rewrite or directly; set it to the number of
  proxies in front of the server otherwise. The command center API (`/admin`) also has a site-wide
  wrong-password ceiling (30 per 15 minutes), so rotating IPs can't brute force it.
- `HOST` (game server, default `127.0.0.1`): interface the Socket.io/HTTP server binds to. Browsers reach it
  through the Next `/socket.io` rewrite, so loopback is enough when both run on one machine. Set
  `HOST=0.0.0.0` only if browsers connect to it directly (`NEXT_PUBLIC_SOCKET_URL`) or it runs on another host,
  and then firewall it.
- The command center (`/command`) needs `COMMAND_CENTER_PASSWORD` and `NEXTAUTH_SECRET`; sessions are signed,
  expire after 8 hours, and are invalidated by rotating either value.

### Tests

```bash
npm run test:engine                    # engine rules, evaluator, fuzz (no database needed)
npm test --workspace server            # table runtime, side games, sockets (in-memory ports)
npm test --workspace client            # client helpers
npm test --workspace packages/shared   # wallet, accounts, auth, hands, stats (uses the poker_platform_test database)
npm run e2e                            # Playwright against the running dev stack
```

CI runs typecheck, lint and every unit suite above (with a Postgres service) on each push.

The test database (`poker_platform_test` on the same server, or `TEST_DATABASE_URL`) is created and migrated
automatically; tests refuse to run against a database whose name doesn't end in `_test`.

### SMTP

For Gmail or Google Workspace SMTP, use the structured SMTP variables in `.env`. `EMAIL_SERVER_PASSWORD` usually needs to be an app password or an SMTP-specific credential, not the normal account password.

```bash
EMAIL_TRANSPORT="smtp"
EMAIL_SERVER_HOST="smtp.gmail.com"
EMAIL_SERVER_PORT="587"
EMAIL_SERVER_USER="name@example.com"
EMAIL_SERVER_PASSWORD="smtp-app-password"
EMAIL_SERVER_SECURE="false"
EMAIL_FROM="Poker Platform <name@example.com>"
```

Verify the SMTP login before testing sign-in:

```bash
npm run smtp:verify
```

## License

MIT. See [LICENSE](LICENSE).
