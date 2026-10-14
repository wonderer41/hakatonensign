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
| `POST /api/items/:id/progress/:progressId/confirm` | no body → `ChecklistItemDto` | D7 push note. One transaction: note `status = confirmed`, `resolvedAt = now`; a `looks_done` note also checks the item (`done`, `doneAt`, `version + 1`; an already-checked item is left alone). Publishes `item.upserted`. `404` when the note isn't on that item; a note that is already confirmed or dismissed is final, so a repeat returns `200` and changes nothing. |
| `POST /api/items/:id/progress/:progressId/dismiss` | no body → `ChecklistItemDto` | D7: note `status = dismissed`, `resolvedAt = now`; the item is untouched. Same `404` / repeat rules as confirm. |
| `POST /api/schedule` | `ScheduleRequestBody` → `ScheduleRequestDto` (`status: "checking"`) | Starts the flow in `docs/05-HERMES.md`. Returns immediately; progress arrives as `schedule.updated`. |
| `GET /api/schedule/:id` | → `ScheduleRequestDto` | |
| `POST /api/schedule/:id/cancel` | → `ScheduleRequestDto` | Bubble closed before finishing. |
| `PUT /api/daily-message` | `{ date, text }` → `{ date, text, author }` | |
| `GET /api/seerr/requests` | → `{ data: SeerrRequestDto[] }` | Proxies Seerr `GET /api/v1/request?filter=pending`. |
| `POST /api/seerr/requests/:id/approve` | `SeerrDecisionRequest` → `{ ok: true }` | Server does `PUT /api/v1/request/:id` (library mapping, D14) then `POST /api/v1/request/:id/approve`. |
| `POST /api/seerr/requests/:id/decline` | → `{ ok: true }` | `POST /api/v1/request/:id/decline`. |
| `GET /api/stream` | SSE | See section C. |

## B. Hermes write routes (`/api/hermes/*`)

These routes are machine-to-machine. Hermes sends the header `Authorization: Bearer ${HERMES_DASHBOARD_TOKEN}`. The server compares the token in constant time and answers `401 UNAUTHORIZED` when it is missing or wrong. Each process accepts 60 requests per minute; above that it answers `429 RATE_LIMITED` with a `Retry-After` header.

Every write is an **idempotent upsert** keyed by a stable key Hermes chooses (formats in `docs/03-DATA-MODEL.md`). Responses are `HermesWriteResult<T>`, which carries `created: true|false`. The status is `201` when a row was created and `200` when it was updated or when nothing changed. Request bodies are strict: an unknown field is a `400` whose `details.field` names it. The skill Hermes installs (`for-claude/hermes/dashboard-skill.md`) describes the same rules from Hermes's side.

**Addressing.** In a path, and in a card's `sprintKey`, a card, item or sprint can be named in two ways:

- **By its key**, for example `hermes:card:x` or `github:issue:o/r#3`. A `PUT` to a key creates the row if it is missing.
- **By its id**, written `id:<uuid>`. This is how Hermes reaches rows created on the page, which have no key. An id never creates a row; an unknown id is `404 NOT_FOUND`, and an id that is not a uuid is `400`.

`GET /api/hermes/state` returns the `id` of every sprint, card and item. Alerts are addressed by `dedupeKey` only. Path segments are URL-encoded, for example `github%3Aissue%3Awonderer41%2Fstudy-sessions%2313` or `id%3A5f0c…`.

**Versions (D15, `src/lib/dashboard/concurrency.ts`).** Cards, items and sprints carry a `version`, and these rules decide whether a write goes through:

- An upsert that changes nothing always succeeds and doesn't bump the version.
- A change to an existing row needs either the `version` Hermes last read or `"force": true`. Otherwise the answer is `409 CONFLICT` with `details: HermesConflictDetails` (`reason`, `fields`, `currentVersion`, and the current row as `data`).
- Changing an item's `done`, in either direction, needs `force` even when the version matches.
- Optional body fields that are left out keep the stored value; `null` clears them. A card's `meta` is shallow-merged, and a `null` value inside it removes that key.

| Method & path | Body | Effect |
|---|---|---|
| `GET /api/hermes/state` | — | `HermesStateResponse`: planned and active sprints, cards that aren't archived, each with its items, open alerts, today's daily message and the `watchlist`. Each item lists its pending push notes as `{ kind, commitSha }`. Sprints, cards and items all carry `id`, `key` and `version`. |
| `PUT /api/hermes/sprints/:key` | `HermesUpsertSprint` | Creates a sprint (`planned` unless `status` is given) or updates one. `:key` is a key or `id:<uuid>`. `status: "active"` closes the previously active sprint (D8). |
| `PUT /api/hermes/cards/:key` | `HermesUpsertCard` | Creates or updates a Working-on card. `:key` is a key or `id:<uuid>`. `sprintKey` (a key or `id:<uuid>`) links the card to a sprint, and `null` unlinks it. |
| `POST /api/hermes/cards/:key/archive` | — | Sets `status = archived`; no version needed. Hermes never hard-deletes. |
| `PUT /api/hermes/cards/:key/items/:itemKey` | `HermesUpsertItem` | Creates or updates a checklist item. Both segments are a key or `id:<uuid>`. An existing item named under another card moves to that card. |
| `PUT /api/hermes/cards/:key/items/:itemKey/progress/:sha` | `HermesUpsertItemProgress` `{ repoFullName, kind: "looks_done" \| "partial", note, pushedAt }` → `HermesWriteResult<ItemProgressDto>` | D7 push note. `:sha` is 7–64 hex characters and is stored lowercased. The note is upserted by `(item, sha)`, and the item must be on that card (`404` otherwise). An identical payload returns `created: false` and publishes nothing. A different payload updates `kind`, `note`, `pushedAt` and `repoFullName` and keeps the status, except that a `dismissed` note whose `kind` changed goes back to `pending`. Never checks the item. Publishes `item.upserted`. |
| `GET /api/hermes/watchlist` | — | `{ data: { symbols } }`, in banner order (D9). |
| `PUT /api/hermes/watchlist` | `{ symbols: string[] }` (1–50 tickers, uppercased, duplicates dropped) → `HermesWatchlistResult` `{ data: { symbols }, created: false, changed, synced, syncError? }` | Replaces the whole `WatchlistSymbol` list. If the list changed and `FINNHUB_API_KEY` is set, the server runs the quote sync before answering, and that sync publishes `banner.updated`. `synced` is `false` when nothing changed, when the keys are missing or when the sync failed; `syncError` then says why, with no secrets. |
| `PUT /api/hermes/daily-message/:date` | `{ text }` | D13: Hermes writes the daily message. |
| `PUT /api/hermes/banner/:kind` | the snapshot payload for `kind` (`GmailSnapshot`, `OrphansSnapshot`, `ScanSnapshot`, `StocksSnapshot`) + `capturedAt` | Validated strictly; unknown fields are rejected. A new `capturedAt` inserts a `BannerSnapshot`. The same `capturedAt` with the same payload is a no-op, and with a different payload it replaces that capture. Stocks are filled by the server (D9); the route still accepts `stocks`. |
| `PUT /api/hermes/alerts/:dedupeKey` | `HermesUpsertAlert` | Opens or updates an alert. A push for a resolved alert reopens it. |
| `POST /api/hermes/alerts/:dedupeKey/resolve` | — | Sets `resolvedAt`. |
| `POST /api/hermes/calendar/changed` | `{ calendarId? }` | Triggers an immediate calendar sync (call after Hermes creates or moves events). Returns `502` when Google isn't set up or fails. |

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
