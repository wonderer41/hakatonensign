# 04 · API

Types for every request and response are in `src/types/dashboard-contracts.ts`. Errors use the existing envelope from `src/lib/api/http.ts`:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "durationMin must be 1–720", "details": { "field": "durationMin" } } }
```

Add `"CONFLICT"` (already in `ApiErrorCode`) for stale `version`, and a new `"HERMES_UNAVAILABLE"` and `"SEERR_UNAVAILABLE"` for upstream failures.

There are three groups of routes.

## A. Browser routes (same origin, used by the page)

Auth for these depends on decision D3 (network-only vs login). Every mutating route returns the updated DTO and publishes a live event.

| Method & path | Body → Response | Notes |
|---|---|---|
| `GET /api/today?date=YYYY-MM-DD` | → `TodayResponse` | One call renders the page. `date` defaults to today in the dashboard time zone. |
| `GET /api/timeline?date=YYYY-MM-DD` | → `TimelineResponse` | Refetched on `timeline.changed` and `day.rollover`. |
| `GET /api/sprints?status=active` | → `{ data: SprintDto[] }` | |
| `POST /api/sprints` | `{ name, goal?, startsOn, endsOn }` → `SprintDto` | Only one `active` sprint at a time; activating one closes the previous (ask Gerardo, D8). |
| `PATCH /api/sprints/:id` | partial → `SprintDto` | |
| `GET /api/cards?status=active&sprintId=` | → `{ data: WorkCardDto[] }` | Ordered by `position`. |
| `POST /api/cards` | `CreateCardRequest` → `WorkCardDto` | `createdBy = user`. |
| `PATCH /api/cards/:id` | `UpdateCardRequest` → `WorkCardDto` | `409 CONFLICT` on stale `version`. |
| `POST /api/cards/reorder` | `ReorderRequest` → `{ data: WorkCardDto[] }` | |
| `POST /api/cards/:id/items` | `CreateItemRequest` → `ChecklistItemDto` | |
| `PATCH /api/items/:id` | `UpdateItemRequest` → `ChecklistItemDto` | Checkbox toggles go here (optimistic in the UI). If the item mirrors a GitHub issue, see D7 before writing back to GitHub. |
| `POST /api/cards/:id/items/reorder` | `ReorderRequest` | |
| `POST /api/schedule` | `ScheduleRequestBody` → `ScheduleRequestDto` (`status: "checking"`) | Starts the flow in `docs/05-HERMES.md`. Returns immediately; progress arrives as `schedule.updated`. |
| `GET /api/schedule/:id` | → `ScheduleRequestDto` | |
| `POST /api/schedule/:id/cancel` | → `ScheduleRequestDto` | Bubble closed before finishing. |
| `PUT /api/daily-message` | `{ date, text }` → `{ date, text, author }` | |
| `GET /api/seerr/requests` | → `{ data: SeerrRequestDto[] }` | Proxies Seerr `GET /api/v1/request?filter=pending`. |
| `POST /api/seerr/requests/:id/approve` | `SeerrDecisionRequest` → `{ ok: true }` | Server does `PUT /api/v1/request/:id` (library mapping, D14) then `POST /api/v1/request/:id/approve`. |
| `POST /api/seerr/requests/:id/decline` | → `{ ok: true }` | `POST /api/v1/request/:id/decline`. |
| `GET /api/stream` | SSE | See section C. |

## B. Hermes write routes (`/api/hermes/*`)

Machine-to-machine. Header `Authorization: Bearer ${HERMES_DASHBOARD_TOKEN}`; compare in constant time; reject with `401 UNAUTHORIZED`. Rate-limit to e.g. 60 requests/min. All routes are **idempotent upserts** keyed by a stable key Hermes chooses (formats in `docs/03-DATA-MODEL.md`). Response: `HermesWriteResult<T>` with `created: true|false`.

| Method & path | Body | Effect |
|---|---|---|
| `GET /api/hermes/state` | — | Compact JSON of active sprint, cards (keys, titles, progress, current item) and open alerts, so Hermes can reason before writing. |
| `PUT /api/hermes/sprints/:key` | `HermesUpsertSprint` | Create/update a sprint. |
| `PUT /api/hermes/cards/:key` | `HermesUpsertCard` | Create/update a Working-on card. `sprintKey` links it to a sprint. |
| `POST /api/hermes/cards/:key/archive` | — | `status = archived`. Hermes never hard-deletes. |
| `PUT /api/hermes/cards/:key/items/:itemKey` | `HermesUpsertItem` | Create/update a checklist item. |
| `PUT /api/hermes/daily-message/:date` | `{ text }` | Only if D13 lets Hermes write it. |
| `PUT /api/hermes/banner/:kind` | the snapshot payload for `kind` (`GmailSnapshot`, `OrphansSnapshot`, `ScanSnapshot`, `StocksSnapshot`) + `capturedAt` | Validate strictly; unknown fields rejected. Inserts a new `BannerSnapshot`. |
| `PUT /api/hermes/alerts/:dedupeKey` | `HermesUpsertAlert` | Opens or updates an alert. |
| `POST /api/hermes/alerts/:dedupeKey/resolve` | — | Sets `resolvedAt`. |
| `POST /api/hermes/calendar/changed` | `{ calendarId? }` | Triggers an immediate incremental calendar sync (call after Hermes creates/moves events). |

Keys in paths are URL-encoded (`github%3Aissue%3Awonderer41%2Fstudy-sessions%2313`).

## C. Live updates — `GET /api/stream`

Server-Sent Events, one connection per open page.

```
event: change
data: {"type":"card.upserted","cardId":"…"}

event: ping
data: {}
```

- Payloads are the small `LiveEvent` union (ids only); the client refetches what changed (`/api/cards?...`, `/api/timeline`, `/api/today`), so the stream never leaks data the page wouldn't load anyway.
- Ping every 25s; client reconnects with exponential backoff and shows "Reconnecting…".
- Server side, publish after the DB commit. Two options for fan-out (decision D12): an in-process `EventEmitter` (fine for one Next.js instance), or Postgres `LISTEN/NOTIFY` (works if the bot/sync workers run as separate processes and write to the DB).
- `day.rollover` is emitted by a server timer at local midnight; the client also schedules its own refetch at its local midnight as a fallback.

## D. Background jobs

| Job | Interval | Does |
|---|---|---|
| Calendar sync | every 2 min + on `/api/hermes/calendar/changed` | Reuse `src/lib/integrations/google-calendar/client.ts` but fetch a rolling window (`-1 day … +14 days`) with `showDeleted=true`, and also read `extendedProperties.private`. Upsert `CalendarEvent` by `(calendarId, externalId)`, set `status = cancelled` for cancelled or no-longer-returned events in the window, record `lastSyncAt`/`lastError` in `CalendarSyncState`, emit `timeline.changed` for affected dates. (Google's `syncToken` can't be combined with `timeMin/timeMax`, so the window poll is simpler here.) |
| GitHub sync | every 5 min (reuse `src/lib/integrations/github/polling.ts`) | Update card meta (last commit, weekly count), and items from issues per D7. |
| Schedule worker | on demand | Runs the Hermes flow for `checking` requests (see `docs/05-HERMES.md`), with a 120s timeout → `failed`. |
| Seerr poll | every 2 min | Cache the pending count for the Waiting panel; emit `seerr.changed` when it changes. |
| Retention | daily 03:30 local | Deletes old snapshots, schedule requests, events, resolved alerts. |
| Midnight rollover | daily 00:00 local | Emits `day.rollover`. |

Where these run (inside the Next.js server via `instrumentation.ts`, or in a separate worker container like the existing `scripts/telegram-bot.ts`) is decision D12.

## E. Environment variables (new)

```dotenv
DASHBOARD_TIME_ZONE=America/Denver
HERMES_DASHBOARD_TOKEN=            # Hermes → dashboard bearer token (long random)
HERMES_API_URL=                    # Hermes API server base URL, e.g. http://<host>:<port>/v1 (D5)
HERMES_API_KEY=                    # Hermes API_SERVER_KEY
SEERR_URL=https://requests.wonderer41.org
SEERR_API_KEY=
SEERR_TEMP_MOVIE_ROOT=             # D14
SEERR_TEMP_TV_ROOT=                # D14
SEERR_TEMP_PROFILE_ID=             # D14
SONARR_URL=https://sonarr.example.com   # link only; your NPM domain for Sonarr
RADARR_URL=https://radarr.example.com   # link only; your NPM domain for Radarr
GOOGLE_CALENDAR_IDS=primary        # comma-separated; existing GOOGLE_* OAuth vars are reused
```
