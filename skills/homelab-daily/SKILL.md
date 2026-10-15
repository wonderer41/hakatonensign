---
name: homelab-daily
description: Read and update the user's Homelab Daily dashboard through its HTTP API. Covers Working-on cards, checklist items, sprints, push-progress notes on items, banner snapshots (gmail, orphans, scan), the stocks watchlist, Broken-panel alerts, the daily message, and refreshing the timeline after calendar changes.
---

# Homelab Daily dashboard

## Connection

- Base URL: `$HOMELAB_DAILY_URL`. Token: `$HOMELAB_DAILY_TOKEN`. Both are in your env file.
- Never print the token, and never put it in a message, a file or a log.
- Every request uses this template. Leave out `-d` when there is no body. Don't use `curl -f`, because it hides the error body, and you need that body to recover.

```bash
curl -sS -X PUT "$HOMELAB_DAILY_URL/api/hermes/<path>" \
  -H "Authorization: Bearer $HOMELAB_DAILY_TOKEN" -H "Content-Type: application/json" \
  -d '<json>' -w '\nHTTP %{http_code}\n'
```

The rest of this file shows each request as `METHOD path` plus a body.

## 1. Always read state first

`GET /api/hermes/state` returns:

- `date` and `timeZone`. `date` is today in the dashboard's time zone; use that zone for every date you send.
- `activeSprint` and `sprints`, which hold the planned and active sprints. Each sprint has `id`, `key`, `name`, `startsOn`, `endsOn`, `status`, `daysLeft` and `version`.
- `cards`, which holds every card that is not archived, in page order. Each card has `id`, `key`, `title`, `status`, `sprintId`, `sprintKey`, `repoFullName`, `milestoneTitle`, `hermesSuggestion`, `progress {done,total}`, `current {itemId,itemKey,title,label}`, `version` and `items[]`.
  - Each item has `id`, `key`, `title`, `issueNumber`, `done`, `isCurrent`, `position`, `version` and `progress[]`.
  - An item's `progress[]` lists the push notes that are still pending, as `{kind, commitSha}`.
- `alerts`, which holds the open alerts (`dedupeKey`, `title`, `severity` and so on).
- `dailyMessage` and `watchlist`.

Read the state before every batch of writes. Reuse what is already there. Never create a second card or item for something that already exists, even if it has no key.

## 2. Addressing rows: key or id

Cards, items and sprints can be addressed in two ways in a path, and in a card's `sprintKey`:

- **By key.** This is a stable name you choose. A `PUT` to a key creates the row if it doesn't exist yet and updates it if it does.
- **By id.** Write `id:<uuid>`, using the `id` from the state. This is the only way to reach rows the user created on the page, because those have `key: null`. An id never creates a row: if no row has that id, the API answers `404 NOT_FOUND`.

| Thing | Key format | Example |
|---|---|---|
| Card you create | `hermes:card:<slug>` | `hermes:card:orphan-cleanup` |
| Card for a GitHub milestone | `github:milestone:<owner>/<repo>:<n>` | `github:milestone:example-user/study-sessions:3` |
| Card for a repo | `github:repo:<owner>/<repo>` | `github:repo:example-user/pomanor-mcp` |
| Item you create | `hermes:item:<card-slug>:<slug>` | `hermes:item:orphan-cleanup:review-bdmvs` |
| Item for an issue | `github:issue:<owner>/<repo>#<n>` | `github:issue:example-user/study-sessions#13` |
| Sprint | `hermes:sprint:<slug>` or `hermes:sprint:<start-date>` | `hermes:sprint:2026-10-12`, `hermes:sprint:streaks-v1` |
| Alert | `<source>:<thing>` | `container:jellyfin`, `proxmox:vzdump:vm100` |
| Any page-created card, item or sprint | `id:<uuid>` | `id:5f0c2b9e-1d2a-4c3b-9f8e-7a6b5c4d3e2f` |

Rules for keys:

- Slugs are lowercase: `a-z`, `0-9`, `.`, `_` and `-`, starting with a letter or digit. Pick a slug once and reuse it every time.
- Keys are at most 200 characters.
- URL-encode every key in a path: `:` becomes `%3A`, `/` becomes `%2F` and `#` becomes `%23`. For example, `github:issue:example-user/study-sessions#13` is written as `github%3Aissue%3Aexample-user%2Fstudy-sessions%2313`, and `id:5f0c…` is written as `id%3A5f0c…`.

## 3. Changing rows the user may have edited: versions

The user's edits win. Every card, item and sprint has a `version`.

- **Creating a row** needs no version.
- **Re-sending exactly what is stored** is a no-op that always succeeds. The answer is `200` with `created: false`, and the version doesn't change.
- **Changing an existing row** requires `"version": <the version you read from state>` in the body.
  - If the row changed since you read it, the API answers `409 CONFLICT`. In that case, `GET /api/hermes/state` again, decide whether your change still makes sense, and retry with the new version.
  - The 409 body explains the conflict in `error.details`: `{ reason, fields, currentVersion, data }`. `reason` is `version_required`, `stale_version` or `done_is_user_owned`, and `data` is the current row.
- **`"force": true`** overrides the version check. Send it only when the user explicitly asked you to change that thing.
- **`done` belongs to the user.** Changing `done` in either direction (checking or unchecking) on an existing item needs `force: true`, even with the right version. Never send it unless the user asked.
- Setting `isCurrent: true` on one item clears it on the other items of the same card, which bumps their versions. Re-read the state before you write those items.

Body conventions:

- If you leave a field out, the stored value stays as it is.
- If you send `null` (or `""` for text), the field is cleared.
- Unknown fields are rejected with `400`.
- The required fields have to be sent on every `PUT`, even when nothing else changes: `title` for cards and items, and `name`, `startsOn` and `endsOn` for sprints. Send the current value if you don't mean to change it.

## 4. Sprints

`PUT /api/hermes/sprints/<key or id:uuid>`

```json
{ "name": "Streaks v1", "goal": "Ship streak tracking", "startsOn": "2026-10-12", "endsOn": "2026-10-25" }
```

- Dates are `YYYY-MM-DD`, and `endsOn` must be on or after `startsOn`. `name` is at most 120 characters and `goal` at most 500.
- A new sprint is created as `planned`.
- To start a sprint, send `"status": "active"` with its `version`. Only one sprint can be active, so activating one closes the previously active sprint automatically. Do this only when the user says the sprint starts.
- `"status": "closed"` ends a sprint.
- When the user describes a sprint, create it first. Then create its cards with `sprintKey`, and then the items of each card.

## 5. Cards and items

`PUT /api/hermes/cards/<key or id:uuid>`

```json
{ "title": "Orphan cleanup", "milestoneTitle": "Manual review pile", "sprintKey": "hermes:sprint:2026-10-12",
  "repoFullName": "example-user/orphan-tools", "hermesSuggestion": "Block 90 min tonight for the BDMVs?", "meta": { "note": "design phase" } }
```

- `title` is at most 160 characters.
- `status` is one of `active`, `paused`, `done` or `archived`.
- `position` is an integer. New cards go to the end of the column.
- `sprintKey` is a sprint key or `id:<uuid>`. Send `null` to unlink the card from its sprint. If the sprint doesn't exist, the answer is `404`.
- `repoFullName` is `owner/repo`. Set it on cards that track a GitHub repo, because push notes (section 6) only apply to those cards.
- `hermesSuggestion` is one short line shown on the collapsed card, such as `Block 90 min tonight for #12?`. Clear it with `null` once the work is booked or the suggestion is stale.
- `meta` is merged shallowly into what is stored: keys you send overwrite, a key set to `null` is removed, and keys you leave out stay. The limit is 4 KB.
  - `meta.note` is shown in the card's meta line. Use it for a short phase or status, such as `"design phase"`.

`PUT /api/hermes/cards/<card>/items/<key or id:uuid>`

```json
{ "title": "Review the 4 BDMV folders", "isCurrent": true }
```

- `title` is at most 200 characters.
- The other fields are `issueNumber`, `sourceUrl` (http or https), `isCurrent`, `position`, `done` (see section 3), `version` and `force`.
- `isCurrent` marks the "now" item. If no item is current, the page shows the first unchecked item as "next".
- If you put an existing item under a different card, it moves to that card. That is a change, so it needs the item's `version`.
- The card must exist before you add items to it, or the answer is `404`.

`POST /api/hermes/cards/<key or id:uuid>/archive` takes no body.

- Archive a card when its milestone closes or when the user says the work is done. Archiving needs no version.
- Never delete a card.

When to create a card:

- The user asks you to track something.
- A new GitHub milestone appears in their repos.
- A multi-step homelab job starts.

Don't rename the user's cards or un-check their items unless they ask you to.

## 6. Push-progress notes on items

After a push to a repo that has a card (the card's `repoFullName` equals the push's repo), read the commits and the diff. Then compare them with that card's open items (`done: false`). Skip repos without a card.

For each item the push clearly touches, write **one** note. Use the push's head commit SHA (the full 40 characters):

`PUT /api/hermes/cards/<card>/items/<item>/progress/<sha>`

```json
{ "repoFullName": "example-user/study-sessions", "kind": "partial",
  "note": "Added the streak model and migration; the UI is still missing.", "pushedAt": "2026-10-14T19:05:00Z" }
```

- Use `"kind": "looks_done"` when the push appears to finish everything the item asks for, for example when the issue's acceptance criteria are met or a commit says it closes the issue. The page then asks the user: "looks done from push X — confirm?".
- Use `"kind": "partial"` when the push moves the item forward but leaves work.
- Send nothing when the link is weak.
- `note` is one plain sentence of at most 500 characters saying what the push did for that item.
- `pushedAt` is an ISO time with a zone.
- **Never check the item yourself.** Don't send `done` for it. The user confirms `looks_done` notes on the page, and that confirmation checks the item.
- One note per (item, sha). Re-sending the same note is a no-op (`200`, `created: false`).
  - Sending the same sha again with different text updates the note.
  - If the user dismissed the note, sending the same sha with a **different `kind`** shows it to them again. Only do that when you really changed your verdict.
- Before writing, check the item's `progress[]` in the state. Don't send a second note for a push that is already pending there.
- Process each push once, and don't re-scan old pushes.

## 7. Banner snapshots

`PUT /api/hermes/banner/<kind>`. The body is that kind's payload plus `"capturedAt": "<ISO>"`. Unknown fields are rejected at every level.

- `gmail`: `{ "since", "needsReply": [{ "from", "subject", "threadUrl?" }], "packages": [{ "label", "status" }], "payments": [{ "merchant", "at" }], "deletedCount" }`
  - For needs-reply, include only the sender and subject.
  - Never include amounts. A payment that carries an `amount` is rejected.
  - Each list holds at most 50 entries.
- `orphans`: `{ "items": [{ "name", "kind": "episode|movie", "arr": "sonarr|radarr" }], "counts": { "sonarr", "radarr" } }`
  - Names only, at most 200 items.
- `scan`: `{ "ranAt", "up", "total", "issues": [{ "container", "summary" }] }`
  - `up` can't be greater than `total`.
  - Give each issue a one-line `summary`.

Each new `capturedAt` stores a new snapshot (`201`), and the page shows the newest one. If you send the same `capturedAt` again with the same payload, nothing changes (`200`). If you send it with a different payload, that capture is replaced.

**Stocks are filled by the server now** from Finnhub and Tiingo. Don't push `stocks` snapshots. Change the watchlist instead (section 8).

## 8. Stocks watchlist

`GET /api/hermes/watchlist` returns `{ "data": { "symbols": [...] } }`.

`PUT /api/hermes/watchlist` replaces the whole list. Send it only when the user asks for a change:

```json
{ "symbols": ["NVDA", "AMD", "MU", "TSLA", "AMZN", "XOM", "CVX", "COP", "CEG", "VST", "NEE", "TSM"] }
```

- The list holds 1 to 50 tickers. The order you send is the order on the banner.
- Tickers are uppercased and duplicates are dropped.
- To add or remove one symbol, read the list, edit it, and send the whole list back.
- The response is `{ "data": { "symbols" }, "changed", "synced", "syncError?" }`.
  - When the list changed, the dashboard refreshes the stock quotes before answering. This can take up to about 30 seconds.
  - `synced: false` together with a `syncError` means the banner will catch up on its next 5-minute refresh. Tell the user the `syncError` text if they are waiting for the banner.

## 9. Alerts (Broken panel)

`PUT /api/hermes/alerts/<dedupeKey>`

```json
{ "source": "scan", "title": "jellyfin restarting", "detail": "3 restarts since 06:00", "severity": "warning" }
```

- `severity` is `warning` or `critical`. Alerts have no version, so the latest push wins.
- Re-sending a PUT for an alert that was resolved **reopens** it, because the problem came back.
- `POST /api/hermes/alerts/<dedupeKey>/resolve` takes no body. Send it when the problem is gone. Resolving twice changes nothing.

## 10. Daily message

`PUT /api/hermes/daily-message/<YYYY-MM-DD>` with the local date in the dashboard's `timeZone`:

```json
{ "text": "Morning! Two work blocks today; jellyfin is flapping again." }
```

The text is at most 500 characters. Sending the same text again is a no-op.

## 11. After you book or move a calendar event

`POST /api/hermes/calendar/changed`, with no body or with `{ "calendarId": "<id>" }`, makes the dashboard sync the calendar so the timeline updates right away. If Google isn't set up on the dashboard or fails, the answer is `502`.

## 12. Status codes

| Code | Meaning | What you do |
|---|---|---|
| `201` | The row was created (`created: true`) | Done. |
| `200` | The row was updated, or nothing changed (`created: false`) | Done. |
| `400 VALIDATION_ERROR` | Bad body or key; `error.details.field` names the field | Fix that field. Don't retry unchanged. |
| `401 UNAUTHORIZED` | Wrong or missing token | Stop and tell the user. |
| `404 NOT_FOUND` | The id doesn't exist, the card or sprint is missing, or the item is not on that card | Re-read the state, or create the parent first. |
| `409 CONFLICT` | Stale or missing `version`, or `done` sent without `force` | Re-read the state and retry with the new version. Use `force` only if the user asked. |
| `429 RATE_LIMITED` | More than 60 requests per minute | Wait for the number of seconds in the `Retry-After` header, then continue. |
| `500` / `502` | A dashboard error, or an upstream error from Google or the stock APIs | Retry once later. If it fails again, tell the user. |

Every error body looks like this:

```json
{ "error": { "code": "...", "message": "...", "details": {} } }
```
