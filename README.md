# Poker Platform

Proof-of-concept Texas Hold'em platform. Phase 2 currently supports authenticated lobby creation, lobby joining, and static waiting rooms.

## Current Scope

- Next.js App Router client with NextAuth.
- PostgreSQL persistence through Prisma.
- Email-domain-gated sign-in.
- Prisma models for NextAuth, optional wallets, lobbies, and lobby membership.
- Shared database/session helpers for both the Next.js app and the standalone server.
- Express server shell with health and authenticated session endpoints.
- Public and private lobby creation through Next.js server actions.
- Private lobby password hashing and verification.
- Seat assignment persisted through Prisma.
- Static waiting room at `/lobby/[id]`.

Poker gameplay, realtime Socket.io handlers, card shuffling, hand evaluation, and table runtime are intentionally not implemented yet.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create local environment values:

   ```bash
   cp .env.example .env
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

## Email Sign-In SMTP

Set `ALLOWED_EMAIL_DOMAINS` to the email domain users are allowed to use, for example:

```bash
ALLOWED_EMAIL_DOMAINS="mymail.pomona.edu"
```

For Gmail or Google Workspace SMTP, use the structured SMTP variables in `.env`. `EMAIL_SERVER_PASSWORD` usually needs to be an app password or an SMTP-specific credential, not the normal account password.

```bash
EMAIL_SERVER_HOST="smtp.gmail.com"
EMAIL_SERVER_PORT="587"
EMAIL_SERVER_USER="name@mymail.pomona.edu"
EMAIL_SERVER_PASSWORD="smtp-app-password"
EMAIL_SERVER_SECURE="false"
EMAIL_FROM="Poker Platform <name@mymail.pomona.edu>"
```

Verify the SMTP login before testing sign-in:

```bash
npm run smtp:verify
```
