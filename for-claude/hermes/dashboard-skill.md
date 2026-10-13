---
name: homelab-daily
description: Create and update Gerardo's Homelab Daily dashboard — Working-on cards, checklist items, sprints, banner snapshots (gmail, orphans, scan, stocks), alerts and the daily message — through its authenticated HTTP API.
---

# Homelab Daily dashboard

DRAFT — check the skill format against the running Hermes version (other skills live in `/opt/data/skills/<name>/`) before installing. Gerardo approves the final wording.

## Connection

- Base URL: `$HOMELAB_DAILY_URL` (set in Hermes's env; decided with Gerardo).
- Every request: `-H "Authorization: Bearer $HOMELAB_DAILY_TOKEN" -H "Content-Type: application/json"`.
- Never print the token. Never put it in a message.

## Always start by reading state

```bash
curl -fsS "$HOMELAB_DAILY_URL/api/hermes/state" -H "Authorization: Bearer $HOMELAB_DAILY_TOKEN"
```

It returns the active sprint, active cards (with their `externalKey`, progress and current item) and open alerts. Reuse existing keys; do not create a second card for something that already has one.

## Keys (stable; reuse them every time)

| Thing | Key format | Example |
|---|---|---|
| Card for a GitHub milestone | `github:milestone:<owner>/<repo>:<number>` | `github:milestone:wonderer41/study-sessions:3` |
| Card for a repo | `github:repo:<owner>/<repo>` | `github:repo:wonderer41/pomanor-mcp` |
| Card Hermes invents | `hermes:card:<slug>` | `hermes:card:orphan-cleanup` |
| Item for an issue | `github:issue:<owner>/<repo>#<n>` | `github:issue:wonderer41/study-sessions#13` |
| Item Hermes invents | `hermes:item:<card-slug>:<slug>` | `hermes:item:orphan-cleanup:review-bdmvs` |
| Sprint | `hermes:sprint:<start-date>` | `hermes:sprint:2026-10-12` |
| Alert | `<source>:<thing>` | `container:jellyfin`, `proxmox:vzdump:vm100` |

URL-encode keys in paths.

## Cards and items

Create or update a card:

```bash
curl -fsS -X PUT "$HOMELAB_DAILY_URL/api/hermes/cards/hermes%3Acard%3Aorphan-cleanup" \
  -H "Authorization: Bearer $HOMELAB_DAILY_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Orphan cleanup","milestoneTitle":"Manual review pile","sprintKey":"hermes:sprint:2026-10-12"}'
```

Add or update a checklist item:

```bash
curl -fsS -X PUT "$HOMELAB_DAILY_URL/api/hermes/cards/hermes%3Acard%3Aorphan-cleanup/items/hermes%3Aitem%3Aorphan-cleanup%3Areview-bdmvs" \
  -H "Authorization: Bearer $HOMELAB_DAILY_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Review the 4 BDMV folders","isCurrent":true}'
```

Rules:
- Create a card only when Gerardo asks to track something, a new GitHub milestone appears in his repos, or a multi-step homelab job starts.
- Archive (`POST .../cards/<key>/archive`) when a milestone closes or Gerardo says it's done. Never delete.
- Do not un-check items Gerardo checked, and do not rename his cards, unless he asks (that needs `"force": true`).
- `hermesSuggestion` is one short line, e.g. `Block 90 min tonight for #12?`. Clear it (`null`) once booked or stale.

## Banner snapshots

`PUT /api/hermes/banner/<kind>` with the payload for that kind plus `capturedAt` (ISO). Shapes:

- `gmail`: `{ "since", "needsReply": [{ "from", "subject", "threadUrl?" }], "packages": [{ "label", "status" }], "payments": [{ "merchant", "at" }], "deletedCount" }` — senders only for needs-reply; never amounts.
- `orphans`: `{ "items": [{ "name", "kind": "episode|movie", "arr": "sonarr|radarr" }], "counts": { "sonarr", "radarr" } }` — names only.
- `scan`: `{ "ranAt", "up", "total", "issues": [{ "container", "summary" }] }` — one short line per issue.
- `stocks`: `{ "asOf", "rows": [{ "symbol", "price", "currency", "dayChangePct", "sixMonthChangePct" }] }` — exactly 12 rows.

## Alerts (Broken panel)

Open/update: `PUT /api/hermes/alerts/<dedupeKey>` with `{ "source", "title", "detail?", "severity": "warning|critical" }`.
Resolve: `POST /api/hermes/alerts/<dedupeKey>/resolve` when the problem is gone.

## After you create or move a calendar event

`POST /api/hermes/calendar/changed` so the timeline refreshes right away.
