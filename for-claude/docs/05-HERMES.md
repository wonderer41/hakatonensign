# 05 · Hermes integration

Hermes (NousResearch Hermes Agent, v0.21.6 on `ubuntu-main`, `network_mode: host`, data in `~/docker/hermes/data`) is connected two ways:

1. **Dashboard → Hermes:** the "Schedule with Hermes" bubble books calendar time through Hermes's API server, so the answer comes back to the page.
2. **Hermes → dashboard:** Hermes creates and updates Working-on cards, sprints, banner snapshots and alerts through `/api/hermes/*`.

Hermes must have its Google Workspace skill (Gmail + Calendar) authenticated before scheduling works. As of Oct 8 it was waiting on the Google OAuth client.

---

## 1. Dashboard → Hermes (scheduling)

### Hermes API server facts (from the Hermes docs; confirm on the running instance)

- Off by default. Enable with `API_SERVER_ENABLED=true` and `API_SERVER_KEY=<secret>` in Hermes's env file. The docs say the key is required for every deployment.
- Defaults: `API_SERVER_PORT=8642`, `API_SERVER_HOST=127.0.0.1`.
- Auth: `Authorization: Bearer <API_SERVER_KEY>`.
- Endpoints used here: `POST /v1/runs` (start), `GET /v1/runs/{run_id}/events` (SSE progress), `GET /v1/runs/{run_id}`, `POST /v1/runs/{run_id}/stop`; `POST /v1/responses` with `previous_response_id` for follow-ups; `GET /v1/capabilities` to confirm what this version supports; `GET /health`.
- Runs can carry an `Idempotency-Key` header (use the `ScheduleRequest.id`) and `X-Hermes-Session-Id` (use `homelab-daily`).
- Concurrency cap `gateway.api_server.max_concurrent_runs` (default 10, 429 above it).
- **The API has full tool access, including the terminal.** Only the dashboard's server calls it; the key never reaches the browser. CORS stays off.

Before changing Hermes config: check which address/port are free and how the existing Hermes web dashboard is bound (it uses `172.18.0.1:9119` for Nginx Proxy Manager). Bind and port for the API server are decision D5. Back up `~/docker/hermes` first, as Gerardo did for the Oct 8 update.

### Flow

```
Browser: Ask Hermes ─► POST /api/schedule ─► ScheduleRequest(status=checking) ─► 202 + DTO
                                   │
                         worker (server side)
                                   │
       1. validate (date, HH:MM, 1–720 min, not in the past, not past midnight)
       2. pre-check overlap against CalendarEvent cache  ──conflict──► status=conflict + suggestion
       3. no overlap: POST Hermes /v1/runs with the booking prompt (below)
       4. stream /v1/runs/{id}/events → append "Hermes is checking your calendar…" style progress
       5. parse Hermes JSON reply:
            booked   → trigger calendar sync, link the new event to the item → status=booked
            conflict → status=conflict (Hermes saw something the cache missed)
            other    → status=failed
       6. every step publishes schedule.updated; booked also publishes timeline.changed + item.upserted
```

Whether step 2 exists (fast deterministic pre-check) or Hermes alone decides is decision D6. The mockup's replies (exact texts in `docs/01-PRODUCT-SPEC.md`) are written in Hermes's voice either way.

Next free slot (used for the "Use 20:30" suggestion), same as the mockup:

```ts
function findFree(fromMin: number, durationMin: number, events: { start: number; end: number }[]): number | null {
  let t = fromMin;
  for (const ev of [...events].sort((a, b) => a.start - b.start)) {
    if (ev.end <= t) continue;
    if (ev.start >= t + durationMin) return t;
    t = Math.max(t, ev.end);
  }
  return t + durationMin <= 24 * 60 ? t : null;
}
```

### Booking prompt (POST /v1/runs)

Send as the run input. Ask for strict JSON and validate it; the docs don't describe a forced JSON mode, and the local model (qwen) can drift, so treat anything unparseable as `failed`.

```text
You are booking a focused work block on Gerardo's Google Calendar ({calendarId}).
Time zone: America/Denver.

Block:
- title: "Work block · {cardTitle} {issueRef} {itemTitle}"
- start: {date}T{HH:MM} local
- end: {date}T{HH:MM} local ({durationMin} minutes)
- description: "{itemUrl}\n[homelab-daily:item:{checklistItemId}]"
- private extended property: homelabDailyItemId={checklistItemId}

Steps:
1. Read the calendar for that window. If any non-cancelled event overlaps, do not create anything.
2. Otherwise create the event exactly as above.

Reply with ONE line of JSON and nothing else:
{"status":"booked","eventId":"<google event id>","start":"<ISO>","end":"<ISO>"}
or
{"status":"conflict","title":"<conflicting event title>","start":"<ISO>","end":"<ISO>"}
or
{"status":"error","message":"<short reason>"}
```

For alerts, the title is `Fix · {alertTitle}` and the marker is `[homelab-daily:alert:{alertId}]`.

The calendar sync links work blocks by reading `extendedProperties.private.homelabDailyItemId` (fall back to the description marker) and sets `CalendarEvent.kind = work_block`.

---

## 2. Hermes → dashboard (cards, sprints, banners, alerts)

Hermes calls `/api/hermes/*` (see `docs/04-API.md`, section B) with `Authorization: Bearer $HOMELAB_DAILY_TOKEN`. Put the token in Hermes's env file next to its other secrets; never in a skill file.

A draft skill is in `hermes/dashboard-skill.md`. It teaches Hermes:
- to read `GET /api/hermes/state` before writing,
- the key formats so repeated runs update instead of duplicating,
- when to create a card (Gerardo asks to track something; a new GitHub milestone appears; a multi-step homelab job starts) and when to archive one (milestone closed, Gerardo says it's done),
- how to push banner snapshots and alerts.

### Suggested Hermes jobs (confirm each with Gerardo before creating)

| Job | When | Pushes |
|---|---|---|
| Extend the existing "Daily Container Health Scan" (6 AM) | daily | `PUT /api/hermes/banner/scan` + an alert per issue (`PUT /api/hermes/alerts/container:<name>`), resolve alerts that cleared |
| Gmail summary | e.g. every 30 min, 07:00–22:00 | `PUT /api/hermes/banner/gmail` |
| Orphan review list | after the Wednesday orphan pipeline, or daily | `PUT /api/hermes/banner/orphans` from the n8n `orphan_items` rows with `status = pending_review` (or n8n pushes it directly — D10) |
| Backup check | Monday morning | alert `proxmox:vzdump:vm<id>` when a VM missed its Sunday backup |
| Daily message | 05:30 | `PUT /api/hermes/daily-message/<date>` (only if D13 allows) |
| Work tracking | on request in Discord | cards/items/sprints |
