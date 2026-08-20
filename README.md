# Blox Fruits Stock Bot

A Discord bot that tracks live Blox Fruits dealer stock, renders stock images,
publishes updates to Discord, and responds to `!stock`.

## Requirements

- Node.js 20 or newer
- pnpm 9 or newer
- PostgreSQL 14 or newer
- A Discord application with the Gateway intents required by the bot

## Setup

1. Copy `.env.example` to `.env`.
2. Set every required value in `.env`, then export it before starting locally
   (or provide the values through the hosting panel's environment-variable
   settings):

   ```sh
   set -a
   . ./.env
   set +a
   ```
3. Install dependencies:

   ```sh
   pnpm install --frozen-lockfile
   ```

4. Apply the database schema:

   ```sh
   pnpm --filter @workspace/db run push
   ```

5. Build and start the bot:

   ```sh
   pnpm run build
   pnpm start
   ```

The process listens on `PORT` and exposes a health endpoint at
`/api/healthz`. Pterodactyl can use `pnpm start` as its startup command. A
standard VPS can use the same command under systemd, supervisord, or pm2.

## Environment variables

`DISCORD_BOT_TOKEN`, all `DISCORD_*_CHANNEL_ID` values, `DATABASE_URL`, and
`STOCK_SOURCE_URL` are intentionally required at runtime and are never stored
in source code. `DISCORD_VOICE_CHANNEL_ID`, `DISCORD_TEST_CHANNEL_ID`,
`DISCORD_REPOST_ALLOWED_USER_ID`, and the reaction variables are optional.

## Useful commands

- `pnpm run build` — typecheck and build every package
- `pnpm run build:server` — build only the Discord/API service
- `pnpm start` — start the built service
- `pnpm --filter @workspace/status-page run build` — build the optional status page