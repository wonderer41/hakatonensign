# 03 · Data model

New tables live in `prisma/dashboard.prisma`. Append them to `prisma/schema.prisma` and add the back-relation on the existing `Project` model:

```prisma
model Project {
  // ...existing fields...
  workCards  WorkCard[]
}
```

The combined schema was checked with Prisma's schema validator (`@prisma/prisma-schema-wasm`) and is valid. Create the migration with `npx prisma migrate dev --name homelab_daily` (dev) and let the existing `migrate` compose service apply it elsewhere.

## Entities

```
Sprint 1──* WorkCard 1──* ChecklistItem 1──* ScheduleRequest
                │                 └──* CalendarEvent (work blocks)
                └─? Project (existing) ──* WorkEvent (existing activity log)

CalendarEvent (Google cache)   CalendarSyncState (sync token per calendar)
DailyMessage (1 per date)      BannerSnapshot (gmail | orphans | scan | stocks, history)
Alert (Broken panel) 1──* ScheduleRequest / CalendarEvent
```

### Why each table exists

| Table | Purpose | Who writes |
|---|---|---|
| `Sprint` | Groups cards by time box; the column header shows the active sprint and days left. | User, Hermes, optionally GitHub milestone sync (decision D8) |
| `WorkCard` | One Working-on card. Data-driven; any number; ordered by `position`. | User, Hermes, GitHub sync |
| `ChecklistItem` | Items inside a card (usually GitHub issues). `done` drives the segmented progress. `isCurrent` marks the now/next item. | User, Hermes, GitHub sync |
| `CalendarEvent` | Timeline source. Updated and cancelled when Google changes, unlike `WorkEvent`. `kind = work_block` for Hermes-created blocks, linked to the item or alert. | Calendar sync only |
| `CalendarSyncState` | Google `syncToken` per calendar for incremental sync. | Calendar sync |
| `ScheduleRequest` | One Hermes scheduling conversation; the bubble renders `transcript`; status drives the UI. | API + Hermes worker |
| `DailyMessage` | Banner slide 1. | User or Hermes (D13) |
| `BannerSnapshot` | Latest Gmail summary, orphan list, daily scan and stock rows. Payloads are validated (see contracts). | Hermes / n8n |
| `Alert` | Broken panel rows, deduped by `dedupeKey`, closed by setting `resolvedAt`. | Hermes / n8n |

## Rules that keep it dynamic and safe

- **Idempotent upserts.** Anything Hermes or a sync can send twice uses `externalKey` (cards, items, sprints) or `dedupeKey` (alerts). Key formats:
  - card from a GitHub milestone: `github:milestone:<owner>/<repo>:<number>`
  - card from a repo (no milestone): `github:repo:<owner>/<repo>`
  - card created by Hermes: `hermes:card:<slug>` (Hermes picks the slug and reuses it)
  - item from an issue: `github:issue:<owner>/<repo>#<number>`
  - item created by Hermes: `hermes:item:<card-slug>:<slug>`
  - sprint: `github:milestone:...` or `hermes:sprint:<yyyy-mm-dd>`
- **Who wins on conflict.** User edits carry `version`; the server rejects stale versions with `409 CONFLICT` and the UI refetches the card. Machine upserts (Hermes/GitHub) do not overwrite fields the user changed later than the machine's `updatedAt` unless the payload sets `"force": true`. Treat `done` as user-owned once the user has toggled it.
- **Exactly one current item per card.** Setting `isCurrent` on one item clears it on the others in the same transaction. If none is set, the UI shows the first unchecked item as `next`.
- **Ordering.** `position` is an integer with gaps of 1000; reorders rewrite positions in one transaction.
- **Soft delete.** Cards are archived (`status = archived`), never deleted by Hermes. Hard delete is user-only.
- **Day boundaries.** A timeline day is `[00:00, 24:00)` in `DASHBOARD_TIME_ZONE` (default `America/Denver`), converted to UTC for queries: `startsAt < dayEnd AND endsAt > dayStart AND status <> 'cancelled'`.
- **Every write publishes a change** on the live stream (`docs/04-API.md`), inside the same request after commit.

## Retention

- `BannerSnapshot`: keep 14 days per kind (daily cleanup job).
- `ScheduleRequest`: keep 30 days.
- `CalendarEvent`: keep past events 60 days, future events as Google returns them.
- Resolved `Alert`s: keep 30 days.
