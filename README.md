# Continuum

Continuum is a customizable productivity dashboard for tracking work, bringing activity from external services together, and recovering context about what you were working on.

The current repository is the project foundation. The dashboard, authentication, integrations, and AI features are planned but not implemented yet.

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

Start the local database:

```powershell
docker compose up -d
```

```bash
docker compose up -d
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

There are no application models yet. The Prisma schema contains only the PostgreSQL datasource and client generator so the team can add the product schema later. Once models exist, create a development migration with:

```powershell
npm run db:migrate -- --name init
```

```bash
npm run db:migrate -- --name init
```

Open Prisma Studio with `npm run db:studio` when you have models to inspect.

## Run the application

Start the development server:

```powershell
npm run dev
```

```bash
npm run dev
```

Open <http://localhost:3000>. The health endpoint is available at <http://localhost:3000/api/health>.

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
│   ├── api/health/route.ts
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── generated/             # Generated Prisma client, ignored by Git
└── lib/db/prisma.ts       # Reusable Prisma client singleton
prisma/
└── schema.prisma
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

These are future plans and are not implemented in this foundation:

- Customizable productivity dashboard and widgets
- Authentication and user workspaces
- GitHub, Jira, Microsoft Teams, and Telegram integrations
- Consolidated activity and context recovery
- Optional OpenAI or Anthropic assistance
- Product-specific PostgreSQL models

