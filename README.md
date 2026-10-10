# Continuum

Continuum is a customizable productivity dashboard for tracking work, bringing activity from external services together, and recovering context about what you were working on.

The backend API for projects, activity events, and the "Resume My Work" context summary is implemented. The dashboard UI, integrations, authentication, and AI features are planned but not implemented yet. The agreed API shapes are in [`CONTINUUM_API_CONTRACTS.md`](CONTINUUM_API_CONTRACTS.md).

## Technology stack

- Next.js 16 with the App Router
- TypeScript
- React 19
- Tailwind CSS 4
- PostgreSQL 17 with Docker Compose
- Prisma ORM 7
- npm

## Prerequisites

Install the following tools:

- Node.js 22.18 or newer
- npm
- Docker Desktop with Docker Compose

Check your versions:

```powershell
node --version
npm --version
docker --version
docker compose version
```

## Installation

Install dependencies from the repository root:

```powershell
npm install
```

```bash
npm install
```

Create a local environment file. PowerShell:

```powershell
Copy-Item .env.example .env
```

Unix-like shells:

```bash
cp .env.example .env
```

The example values are development-only local credentials. External API keys are optional and are not needed to run the current application.

## Start PostgreSQL

Build and start the app and local database:

```powershell
docker compose up --build -d
```

```bash
docker compose up --build -d
```

This starts the `app` and `postgres` containers. A short-lived `migrate` container waits for PostgreSQL to be healthy, applies every migration in `prisma/migrations`, and exits before the app starts. The first run takes longer while Docker builds the app and installs Prisma in the migration container. Check that migration succeeded with:

```bash
docker compose logs migrate
```

PostgreSQL is available at `localhost:5432` by default. Set `POSTGRES_PORT` in `.env` if that port is already in use. The database data is stored in the named `continuum-postgres-data` Docker volume.

## Set up Prisma

Generate the Prisma client:

```powershell
npm run db:generate
```

```bash
npm run db:generate
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

The Docker app is available at <http://localhost:3000>. To use Next.js hot reload on the host instead, stop the app container and start the development server:

```powershell
docker compose stop app
npm run dev
```

```bash
docker compose stop app
npm run dev
```

The health endpoint is available at <http://localhost:3000/api/health>.

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

```powershell
npm run typecheck
npm run lint
npm run build
```

```bash
npm run typecheck
npm run lint
npm run build
```

Stop PostgreSQL when finished:

```powershell
docker compose down
```

```bash
docker compose down
```

This stops the container and keeps the named volume. To remove the local database data as well, use `docker compose down -v` deliberately.

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

