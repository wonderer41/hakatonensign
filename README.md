# Continuum

Continuum is a productivity dashboard that brings project activity together and helps recover the context of ongoing work.

The current MVP includes a Next.js dashboard, PostgreSQL-backed projects and work events, GitHub activity synchronization, a deterministic Context Engine, and a Telegram bot for project status and resume context.

## Technology stack

- Next.js 16 App Router
- TypeScript
- React 19
- Tailwind CSS 4
- PostgreSQL 17 with Docker Compose
- Prisma ORM 7
- Native `fetch` for GitHub and Telegram APIs
- `tsx` for the standalone Telegram bot process

## Prerequisites

- Node.js 22.18 or newer
- npm
- Docker Desktop with Docker Compose

Check versions:

```powershell
node --version
npm --version
docker --version
docker compose version
```

## Installation

Install dependencies:

```bash
npm install
```

Create a local environment file:

```powershell
Copy-Item .env.example .env
```

```bash
cp .env.example .env
```

Never commit `.env` or provider tokens.

## Environment configuration

The application and bot use these server-side variables:

```dotenv
DATABASE_URL=postgresql://continuum:continuum_dev_password@localhost:5432/continuum?schema=public

# Optional for public repositories; recommended for higher GitHub API limits
GITHUB_TOKEN=

# Enables automatic GitHub polling in the Telegram bot process
GITHUB_SYNC_OWNER=
GITHUB_SYNC_REPO=
GITHUB_SYNC_INTERVAL_MS=60000

# Telegram bot
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_CHAT_IDS=

# Project used by the Telegram bot and automatic GitHub sync
CONTINUUM_DEMO_PROJECT_ID=
```

`GITHUB_SYNC_OWNER` and `GITHUB_SYNC_REPO` must both be set to enable automatic synchronization. If they are absent, the Telegram bot still runs normally.

`TELEGRAM_ALLOWED_CHAT_IDS` is a comma-separated list of numeric Telegram chat IDs. An empty list denies all commands. See [docs/TELEGRAM_BOT.md](docs/TELEGRAM_BOT.md) for safe chat ID discovery.

## Start PostgreSQL and Prisma

Start PostgreSQL:

```bash
docker compose up -d
```

Generate the Prisma client and apply the existing development migration:

```bash
npm run db:generate
npm run db:migrate
```

The database uses the named Docker volume `continuum-postgres-data`.

## Run the application

Start Next.js:

```bash
npm run dev
```

Open <http://localhost:3000>.

The standalone Telegram process must be started separately:

```bash
npm run bot:dev
```

The bot process starts Telegram long polling and, when GitHub repository configuration is present, automatic GitHub synchronization. The first successful GitHub sync establishes a baseline without sending notifications. Later syncs run at the configured interval and notify authorized chats about newly inserted PR opened, PR merged, and issue closed events.

Only one process should poll a given Telegram bot token. Do not configure a Telegram webhook while using long polling.

## API endpoints

- `GET /api/health` — service health check
- `GET /api/projects` — list projects
- `POST /api/projects` — create a project
- `GET /api/events?projectId=<uuid>` — list project activity
- `POST /api/events` — ingest a normalized work event
- `GET /api/context?projectId=<uuid>` — generate an evidence-linked context summary
- `POST /api/integrations/github/sync` — manually sync GitHub activity

The GitHub integration normalizes commits, pull requests, and basic issue activity into `WorkEvent` records. Stable external IDs and the shared ingestion service provide database-backed deduplication.

## Telegram commands

- `/start` — welcome message and command list
- `/help` — show supported commands
- `/status` — project name, recent activity, and pull request state
- `/resume` — completed work, in-progress work, blockers, and suggested next steps

Telegram uses the existing event and Context Engine services. It does not implement a second summary engine.

## Verification

Run type checking and linting:

```bash
npm run typecheck
npm run lint
```

The integration checks cover GitHub normalization, database deduplication behavior, Telegram command formatting, authorization handling, automatic sync baselining, overlap prevention, duplicate notification suppression, and provider failure handling.

Live Telegram and GitHub checks require valid local credentials, a running PostgreSQL instance, a configured demo project, and an allowlisted Telegram chat.

## Project structure

```text
src/
├── app/api/                  # Next.js API routes
├── components/               # Dashboard UI
├── lib/context/              # Deterministic Context Engine
├── lib/db/                   # Prisma and shared event/project services
└── lib/integrations/
    ├── github/               # Client, normalization, sync, auto-sync polling
    └── telegram/             # Client, commands, polling, notifications
scripts/
└── telegram-bot.ts           # Standalone Telegram and GitHub polling process
prisma/
└── schema.prisma
docs/
└── TELEGRAM_BOT.md
```

## Current limitations

- One configured demo project is supported by the Telegram bot and auto-sync process.
- GitHub synchronization uses polling; webhooks are not implemented.
- Jira, Teams, AI features, and Telegram webhook mode are not implemented.
- The local MVP does not provide authentication or production access control.

Do not commit credentials or deploy the local write endpoints publicly without authentication, authorization, rate limiting, and provider verification.
