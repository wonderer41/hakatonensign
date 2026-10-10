# Continuum --- API Contracts (Hackathon MVP)

**Version:** 1.0 --- October 10, 2026\
**Status:** Agreed baseline / implementation pending\
**Stack:** Next.js App Router · TypeScript · Prisma · PostgreSQL\
**Base URL:** `http://localhost:3000`\
**Deadline:** Target integration by 4:00 AM; stable demo by 8:00 AM

> **Scope:** This document defines the interfaces for parallel
> development. It does not claim these endpoints have been implemented.
> Do not replace previously discussed features; Jira, Teams, AI, and
> richer customization remain future options.

## 1. Ownership

  ----------------------------------------------------------------------------------
  Owner                   Responsibility          Owns
  ----------------------- ----------------------- ----------------------------------
  **Dev 1 --- Backend**   Prisma                  `/api/projects`, `/api/events`,
                          schema/migrations,      `/api/context`; `src/lib/db/**`,
                          database, event         `prisma/**`,
                          ingestion, context      `src/types/contracts.ts`
                          engine, API contracts   

  **Dev 2 --- Frontend**  Dashboard, project      `src/app/page.tsx`,
                          selector, activity      `src/components/**`, frontend-only
                          timeline, context       fixtures
                          panel, basic widget     
                          visibility              

  **Dev 3 ---             GitHub                  `/api/integrations/github/sync`,
  Integrations**          fetch/normalization,    `/api/telegram/webhook`,
                          manual sync endpoint,   `src/lib/integrations/**`
                          Telegram bot commands   
                          and notifications       
  ----------------------------------------------------------------------------------

**Coordination rule:** Dev 1 publishes `src/types/contracts.ts` first.
Others import these types; do not independently redefine response
shapes. Only Dev 1 changes Prisma schema or migrations. Coordinate edits
to `package.json` and `.env.example`.

## 2. MVP boundaries and shared assumptions

-   **Single demo workspace**, no authentication or multi-tenant
    authorization in this hackathon MVP. `workspaceId` and `projectId`
    are UUID strings. IDs are returned by APIs; never hardcode
    production IDs.
-   Store timestamps in UTC ISO 8601, e.g. `2026-10-10T05:20:00.000Z`.
    UI may display local time.
-   JSON uses **camelCase**.
-   A `WorkEvent` is evidence of activity, **not proof that work is
    completed**. Context summaries must distinguish observations from
    recommendations.
-   The GitHub connector should use a **public or authorized demo
    repository**, never scrape or expose private workplace data.
-   **AI is optional.** A deterministic context summary must work
    without OpenAI/Anthropic keys.
-   Telegram is an **output/interaction channel**, not a project
    activity source by default.
-   Endpoints are local-demo oriented; **do not publicly deploy write
    endpoints without authentication, access control, rate limiting, and
    webhook verification**.
-   Use an optional seed script or manual project creation for the demo.
    Do not depend on a hardcoded project UUID.

## 3. Shared TypeScript contracts

Create `src/types/contracts.ts` with these exported types:

``` ts
export type EventSource = "github" | "jira" | "manual";
export type EventAction =
  | "commit_pushed"
  | "pr_opened"
  | "pr_merged"
  | "pr_reviewed"
  | "issue_opened"
  | "issue_updated"
  | "issue_closed"
  | "task_updated"
  | "note_added";

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkEvent {
  id: string;
  projectId: string;
  source: EventSource;
  externalId: string | null;
  timestamp: string;
  actor: string;
  action: EventAction;
  summary: string;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ContextItem {
  text: string;
  evidenceEventIds: string[];
}

export interface ContextSummary {
  projectId: string;
  generatedAt: string;
  completed: ContextItem[];
  inProgress: ContextItem[];
  blockers: ContextItem[];
  nextSteps: ContextItem[];
  activityCount: number;
  mode: "rules" | "ai";
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedEvents {
  data: WorkEvent[];
  nextCursor: string | null;
}
```

**Important:** `metadata` is for source-specific non-secret details such
as GitHub PR number or commit SHA. Do not store access tokens or
sensitive message contents.

## 4. Endpoint contracts

### A. `GET /api/health` --- existing

**Owner:** Foundation (already implemented)\
**Response `200`:**

``` json
{
  "status": "ok",
  "service": "continuum"
}
```

No database check required.

### B. `GET /api/projects`

**Owner:** Dev 1\
**Purpose:** List demo workspace projects, newest updated first.\
**Query:** `workspaceId` optional for MVP (default demo workspace).

**Response `200`:**

``` json
{
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "workspaceId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "name": "Payment Migration",
      "description": "Move payment processing to a new service",
      "createdAt": "2026-10-10T04:00:00.000Z",
      "updatedAt": "2026-10-10T05:20:00.000Z"
    }
  ]
}
```

### C. `POST /api/projects`

**Owner:** Dev 1\
**Purpose:** Create a project in the demo workspace.

**Request:**

``` json
{
  "name": "Payment Migration",
  "description": "Move payment processing to a new service"
}
```

`name` required, trimmed, 1--120 chars. `description` optional, max 1000
chars. Workspace assigned server-side.

**Response `201`:**

``` json
{
  "data": {
    "id": "11111111-1111-4111-8111-111111111111",
    "workspaceId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "name": "Payment Migration",
    "description": "Move payment processing to a new service",
    "createdAt": "2026-10-10T04:00:00.000Z",
    "updatedAt": "2026-10-10T04:00:00.000Z"
  }
}
```

### D. `GET /api/events?projectId=<uuid>&limit=50&cursor=<opaque>`

**Owner:** Dev 1\
**Purpose:** Fetch a project's activity, newest first.

-   `projectId`: required UUID
-   `limit`: optional, default 50, max 100
-   `cursor`: optional, opaque cursor returned by previous page

**Response `200`:**

``` json
{
  "data": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "projectId": "11111111-1111-4111-8111-111111111111",
      "source": "github",
      "externalId": "github:demo/repo:pr:42:opened",
      "timestamp": "2026-10-10T05:20:00.000Z",
      "actor": "demo-dev",
      "action": "pr_opened",
      "summary": "Opened PR #42 to add payment validation",
      "sourceUrl": "https://github.com/example/repo/pull/42",
      "metadata": { "repository": "example/repo", "prNumber": 42 },
      "createdAt": "2026-10-10T05:20:05.000Z"
    }
  ],
  "nextCursor": null
}
```

Return `data: []` and `nextCursor: null` for no events. Return `404` if
project doesn't exist.

### E. `POST /api/events`

**Owner:** Dev 1\
**Purpose:** Ingest one normalized activity event. Used by Dev 3 and
manual demo entries.

**Request:**

``` json
{
  "projectId": "11111111-1111-4111-8111-111111111111",
  "source": "github",
  "externalId": "github:demo/repo:pr:42:opened",
  "timestamp": "2026-10-10T05:20:00.000Z",
  "actor": "demo-dev",
  "action": "pr_opened",
  "summary": "Opened PR #42 to add payment validation",
  "sourceUrl": "https://github.com/example/repo/pull/42",
  "metadata": { "repository": "example/repo", "prNumber": 42 }
}
```

Required: `projectId`, `source`, `timestamp`, `actor`, `action`,
`summary`. `externalId`, `sourceUrl`, `metadata` optional; default
`null`, `null`, `{}` respectively.

**Idempotency:** Unique constraint on `(projectId, source, externalId)`
when `externalId` is non-null. Duplicate ingest returns existing event
with `200`; newly inserted event returns `201`. For source-generated
records, **Dev 3 must provide a stable `externalId`**.

**Response `201` or `200`:**

``` json
{
  "data": {
    "id": "22222222-2222-4222-8222-222222222222",
    "projectId": "11111111-1111-4111-8111-111111111111",
    "source": "github",
    "externalId": "github:demo/repo:pr:42:opened",
    "timestamp": "2026-10-10T05:20:00.000Z",
    "actor": "demo-dev",
    "action": "pr_opened",
    "summary": "Opened PR #42 to add payment validation",
    "sourceUrl": "https://github.com/example/repo/pull/42",
    "metadata": { "repository": "example/repo", "prNumber": 42 },
    "createdAt": "2026-10-10T05:20:05.000Z"
  },
  "created": true
}
```

For duplicate response, `created: false`.

**Implementation note:** This endpoint is intentionally simple for local
development. A deployed system must authenticate callers and authorize
project writes.

### F. `GET /api/context?projectId=<uuid>`

**Owner:** Dev 1\
**Purpose:** Generate a project-specific "Resume My Work" snapshot from
stored events.

**Response `200`:**

``` json
{
  "data": {
    "projectId": "11111111-1111-4111-8111-111111111111",
    "generatedAt": "2026-10-10T05:25:00.000Z",
    "completed": [
      {
        "text": "PR #41 was merged",
        "evidenceEventIds": ["33333333-3333-4333-8333-333333333333"]
      }
    ],
    "inProgress": [
      {
        "text": "PR #42 is open",
        "evidenceEventIds": ["22222222-2222-4222-8222-222222222222"]
      }
    ],
    "blockers": [],
    "nextSteps": [
      {
        "text": "Review the open PR #42",
        "evidenceEventIds": ["22222222-2222-4222-8222-222222222222"]
      }
    ],
    "activityCount": 2,
    "mode": "rules"
  }
}
```

**Rules:** - Every factual claim must cite at least one event ID. - Do
not infer "completed" from a commit; only explicit
completed/merged/closed events. - Never invent blockers. If not
observed, return `[]`. - `nextSteps` are suggestions, not confirmed
assignments. - If no events: empty arrays, `activityCount: 0`,
`mode: "rules"`. - AI is optional and must never be required for this
endpoint to succeed. - Initial implementation may generate on request
without persisting snapshots. Snapshot persistence is a later
enhancement.

### G. `POST /api/integrations/github/sync`

**Owner:** Dev 3\
**Purpose:** Manually fetch recent GitHub activity and ingest normalized
events. Do not implement OAuth for MVP.

**Request:**

``` json
{
  "projectId": "11111111-1111-4111-8111-111111111111",
  "owner": "example",
  "repo": "repo"
}
```

**Behavior:** 1. Verify project exists. 2. Fetch recent PRs and commits
via GitHub REST API (public demo repo or authorized token). 3. Map
supported activity to `WorkEvent` and stable `externalId`. 4.
Upsert/deduplicate through the same backend ingestion logic as
`POST /api/events` (direct shared service preferred to internal HTTP
fetch). 5. Return counts.

**Response `200`:**

``` json
{
  "data": {
    "projectId": "11111111-1111-4111-8111-111111111111",
    "repository": "example/repo",
    "fetched": 12,
    "created": 7,
    "duplicates": 5,
    "syncedAt": "2026-10-10T05:30:00.000Z"
  }
}
```

For MVP, sync can be triggered by a dashboard button. GitHub webhooks
and background polling are stretch goals. Never expose `GITHUB_TOKEN` to
the client. Use server-side environment variables.

### H. `POST /api/telegram/webhook` --- optional if using polling

**Owner:** Dev 3\
**Purpose:** Receive Telegram bot updates if using webhook mode.

-   **Choose one mode:** webhook **or** long polling; do not run both
    simultaneously.
-   For local hackathon work, long polling may be easier because it does
    not require a public HTTPS URL.
-   If using webhook mode, verify the `X-Telegram-Bot-Api-Secret-Token`
    header against `TELEGRAM_WEBHOOK_SECRET`, rejecting invalid requests
    with `401`.
-   Never allow arbitrary users to query project information. For demo,
    allowlist one or more Telegram chat IDs via
    `TELEGRAM_ALLOWED_CHAT_IDS` (comma-separated). This is a demo
    safeguard, not production authorization.
-   No need to expose this endpoint if long polling is used.

**Supported bot commands:** - `/start` --- short introduction and
commands - `/status` --- latest project activity (select configured demo
project) - `/resume` --- context summary from `GET /api/context` /
shared service

The bot should call the shared context logic rather than implement a
second summary algorithm.

## 5. Standard error responses

All errors follow `ApiError`.

  -----------------------------------------------------------------------
  Status                  Code                    When
  ----------------------- ----------------------- -----------------------
  400                     `VALIDATION_ERROR`      Invalid/missing fields
                                                  or query parameters

  401                     `UNAUTHORIZED`          Invalid webhook secret
                                                  or protected endpoint

  404                     `NOT_FOUND`             Project does not exist

  409                     `CONFLICT`              Genuine conflict not
                                                  handled as idempotent
                                                  duplicate

  429                     `RATE_LIMITED`          Upstream API rate
                                                  limit, when applicable

  500                     `INTERNAL_ERROR`        Unexpected server
                                                  failure

  502                     `UPSTREAM_ERROR`        External integration
                                                  failure
  -----------------------------------------------------------------------

Example:

``` json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "projectId must be a valid UUID"
  }
}
```

Do not return raw API tokens, database connection strings, or provider
stack traces.

## 6. Minimal Prisma models (Dev 1)

-   `Workspace`: `id`, `name`, timestamps
-   `Project`: `id`, `workspaceId`, `name`, `description?`, timestamps
-   `WorkEvent`: fields corresponding to `WorkEvent` contract;
    `metadata` as Prisma `Json`; foreign key to `Project`
-   Optional later: `ContextSnapshot`, `Integration`,
    `WidgetPreference`, `User`

**Avoid implementing unused models tonight.** Index
`WorkEvent(projectId, timestamp)` for timeline queries. Ensure stable
source-event deduplication as described above.

## 7. Frontend integration rules (Dev 2)

-   Fetch `/api/projects` to populate project selector.
-   Fetch `/api/events?projectId=...` for activity timeline.
-   Fetch `/api/context?projectId=...` for "Resume My Work".
-   Show loading, empty, and error states.
-   A "Sync GitHub" button may call the sync endpoint; refresh
    events/context after success.
-   Build widgets using local fixtures initially, then switch to API
    fetches.
-   Widget hide/show/reorder can use React state/local storage for demo;
    **no database widget settings required**.
-   Do not claim AI or integrations are connected unless they actually
    are.

## 8. Integrations rules (Dev 3)

-   **GitHub first.** Jira and Teams are stretch goals; their API
    access/permissions may take too long.
-   Map external data to the shared event types, never write Prisma
    models directly in connector modules.
-   Avoid exposing private data in a public repo, demo, logs, or
    Telegram messages.
-   For Telegram, use `/status` and `/resume` with allowlisted demo
    chats.
-   Use `GITHUB_TOKEN` (optional for public repo, recommended to reduce
    API rate limits), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`.
-   Store only sanitized event metadata; do not persist entire message
    bodies or credentials.

## 9. Environment variables

Extend `.env.example` (no real values):

``` dotenv
# Existing
DATABASE_URL=
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
POSTGRES_PORT=

# Integrations (server-only)
GITHUB_TOKEN=
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_CHAT_IDS=
TELEGRAM_WEBHOOK_SECRET=

# Optional, not required for MVP
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

Do not commit `.env`. Never prefix secrets with `NEXT_PUBLIC_`.

## 10. Definition of Done (by 8 AM)

-   [ ] PostgreSQL container runs and Prisma migration succeeds
-   [ ] Create a project via API
-   [ ] Ingest a manual event via API
-   [ ] Fetch project events in the dashboard
-   [ ] Fetch GitHub activity and see deduplicated events
-   [ ] Context endpoint returns evidence-linked summary
-   [ ] Dashboard renders project, timeline, and resume panel
-   [ ] Telegram `/status` and `/resume` work (stretch if integration
    slips)
-   [ ] `npm run typecheck`, `npm run lint`, `npm run build` pass
-   [ ] Public repo contains no secrets and hackathon AI usage is
    disclosed

## 11. Integration smoke test

After database setup, replace `PROJECT_ID` with the ID returned by
project creation:

``` bash
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"Payment Migration","description":"Hackathon demo"}'

curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{"projectId":"PROJECT_ID","source":"manual","timestamp":"2026-10-10T05:20:00.000Z","actor":"demo-user","action":"note_added","summary":"Waiting for integration tests"}'

curl "http://localhost:3000/api/events?projectId=PROJECT_ID"
curl "http://localhost:3000/api/context?projectId=PROJECT_ID"
```

PowerShell users may use `Invoke-RestMethod` or `curl.exe` with
appropriate shell quoting.

## 12. Change control

**Freeze this contract for the first integration milestone.** If a shape
must change, notify all three developers before merging. Prefer additive
fields over breaking changes. Each developer works on a separate feature
branch and opens a PR. Integration should begin before all features are
finished.

**Suggested build order:** Shared types → Prisma/models → project/events
endpoints → dashboard connection → GitHub sync → context summary →
Telegram.
