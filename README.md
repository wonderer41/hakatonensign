# Continuum

Continuum is a productivity dashboard that brings project activity together and helps recover the context of ongoing work.

The backend API for projects, activity events, and the "Resume My Work" context summary is implemented. The dashboard UI, integrations, authentication, and AI features are planned but not implemented yet. The agreed API shapes are in [`CONTINUUM_API_CONTRACTS.md`](CONTINUUM_API_CONTRACTS.md).

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

This also starts a short-lived `migrate` container. It waits for PostgreSQL to be healthy, applies every migration in `prisma/migrations`, and exits, so the tables are ready without any extra command. The first run takes a little longer while it installs Prisma inside the container. Check that it succeeded with:

```bash
docker compose logs migrate
```

PostgreSQL is available at `localhost:5432` by default. Set `POSTGRES_PORT` in `.env` if that port is already in use. The database data is stored in the named `continuum-postgres-data` Docker volume.

`TELEGRAM_ALLOWED_CHAT_IDS` is a comma-separated list of numeric Telegram chat IDs. An empty list denies all commands. See [docs/TELEGRAM_BOT.md](docs/TELEGRAM_BOT.md) for safe chat ID discovery.

## Start PostgreSQL and Prisma

Start PostgreSQL:

```bash
docker compose up -d
```

The schema defines three models:

- `Workspace`: the single demo workspace, created automatically on first use
- `Project`: belongs to a workspace
- `WorkEvent`: one normalized activity event (commit, PR, issue, task, or note). It is unique on `(projectId, source, externalId)` so the same source event is never stored twice, and indexed on `(projectId, timestamp)` for the timeline.

Only the backend owner changes `prisma/schema.prisma` or migrations. Migration files in `prisma/migrations` are committed so everyone gets the same tables. `docker compose up -d` applies them automatically.

After pulling new migrations, run `docker compose up -d` again (or `docker compose run --rm migrate`) to apply them.

When the backend owner changes the schema, they create a new migration and commit the generated folder:

```powershell
npm run db:migrate -- --name describe-the-change
```

```bash
npm run db:migrate -- --name describe-the-change
```

Open Prisma Studio with `npm run db:studio` to inspect the data.

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

## API

All endpoints return JSON in camelCase with UTC ISO 8601 timestamps. Errors always use the shape `{ "error": { "code": "...", "message": "..." } }`. Full request and response examples are in [`CONTINUUM_API_CONTRACTS.md`](CONTINUUM_API_CONTRACTS.md).

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service health check, no database needed |
| `GET` | `/api/projects` | List projects, most recently active first |
| `POST` | `/api/projects` | Create a project (`name` required, `description` optional) |
| `GET` | `/api/events?projectId=&limit=&cursor=` | Project activity, newest first, paginated with `nextCursor` |
| `POST` | `/api/events` | Ingest one event. Returns `201` when created, or `200` with `created: false` for a duplicate `externalId` |
| `GET` | `/api/context?projectId=` | "Resume My Work" summary: completed, in progress, blockers, next steps |

The context summary is rule-based and needs no AI keys. Every item cites the IDs of the events it is based on. Only merged, closed, or done events count as completed, never commits. Blockers come only from events that say so: a `blocked` label or status, or a note such as "waiting for…".

Shared TypeScript types live in `src/types/contracts.ts`. Import them instead of redefining response shapes.

Integrations should call the shared services directly instead of making HTTP requests to the API:

- `ingestEvent()` in `src/lib/db/events.ts` stores an event with deduplication.
- `getProjectContext()` in `src/lib/db/context.ts` builds the context summary.

Include `repository`, `prNumber` or `issueNumber`, `title`, and `branch` in event `metadata` when available, so related events are grouped correctly.

### Smoke test

With PostgreSQL running and the migration applied, replace `PROJECT_ID` with the ID returned by the first request:

```bash
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"Payment Migration","description":"Hackathon demo"}'

curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{"projectId":"PROJECT_ID","source":"manual","timestamp":"2026-10-10T05:20:00.000Z","actor":"demo-user","action":"note_added","summary":"Waiting for integration tests"}'

curl "http://localhost:3000/api/events?projectId=PROJECT_ID"
curl "http://localhost:3000/api/context?projectId=PROJECT_ID"
```

PowerShell users can use `curl.exe` with the same arguments, or `Invoke-RestMethod`.

Run the checks locally:

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
├── app/
│   ├── api/
│   │   ├── context/route.ts    # GET /api/context
│   │   ├── events/route.ts     # GET, POST /api/events
│   │   ├── health/route.ts     # GET /api/health
│   │   └── projects/route.ts   # GET, POST /api/projects
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── generated/                  # Generated Prisma client, ignored by Git
├── lib/
│   ├── api/
│   │   ├── http.ts             # Error responses and handler wrapper
│   │   └── validation.ts       # Request validation
│   ├── context/rules.ts        # Rule-based "Resume My Work" engine
│   └── db/
│       ├── context.ts          # getProjectContext()
│       ├── events.ts           # ingestEvent(), listEvents()
│       ├── mappers.ts          # Database rows → API types
│       ├── prisma.ts           # Reusable Prisma client singleton
│       └── projects.ts         # Projects and the demo workspace
└── types/contracts.ts          # Shared API types
prisma/
└── schema.prisma
CONTINUUM_API_CONTRACTS.md      # Agreed API contracts for the team
docker-compose.yml
prisma.config.ts
```

## Team workflow

For a team of 3–4 developers, create a focused feature branch from the latest `main`:

```bash
git switch main
git pull
git switch -c feature/short-description
```

Keep changes focused, run type checking, linting, and the production build before opening a pull request, then request review and merge through a pull request into `main`. Do not commit `.env` files or credentials.

## Planned features

These are not implemented yet:

- Customizable productivity dashboard and widgets
- GitHub sync and Telegram bot (`/status`, `/resume`)
- Jira and Microsoft Teams integrations
- Authentication and user workspaces. The API currently has no authentication, so do not deploy it publicly.
- Optional OpenAI or Anthropic assistance for the context summary

Do not commit credentials or deploy the local write endpoints publicly without authentication, authorization, rate limiting, and provider verification.
