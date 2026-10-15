# Section contract

`src/app/page.tsx` (server) builds `TodayResponse` from the DB and renders `<Dashboard initial={…} pinned={…} />`
(`../dashboard.tsx`, the only `"use client"` boundary). Dashboard owns all page state and renders, in order:
Header → `Banner` → `Timeline` → [`WorkingOn` | `WarningsRail`]. Each section file here is a stub; its
section agent replaces the body and keeps the **export name and props**.

| File | Props (read-only slices of `TodayResponse`) | Live events that concern it |
|---|---|---|
| `banner.tsx` | `{ banner: BannerDto }` | `banner.updated` |
| `timeline.tsx` | `{ timeline: TimelineResponse; now: string; date: string; calendar: SourceStateDto }` | `timeline.changed`, `day.rollover`, `schedule.updated` |
| `working-on.tsx` | `{ activeSprint: SprintDto \| null; cards: WorkCardDto[] }` | `card.upserted`, `card.removed`, `item.upserted`, `sprint.upserted`, `schedule.updated` |
| `warnings-rail.tsx` | `{ alerts: AlertDto[]; waiting: WaitingDto; sources: TodayResponse["sources"] }` | `alert.changed`, `seerr.changed`, `banner.updated` (gmail/orphans counts) |

You don't need to react to these yourself: **every** live event (and every stream reconnect) already makes the
dashboard refetch `/api/today` and re-render you with new props. Subscribe only for data your section loads on
its own (e.g. the Seerr request list from `GET /api/seerr/requests`):

```tsx
import { useDashboard, useLiveEvent } from "../context";
import { fetchJson, isApiRequestError } from "../api";

const { today, date, now, timeZone, isToday, mutate, refresh } = useDashboard();
useLiveEvent((event) => { if (event.type === "seerr.changed") void reloadList(); });

// Optimistic write: shown at once, kept on top of refreshes until the request settles, then reconciled.
try {
  await mutate(
    (t) => ({ ...t, workingOn: { ...t.workingOn, cards: t.workingOn.cards.map((c) => (c.id === card.id ? { ...c, items: c.items.map((i) => (i.id === item.id ? { ...i, done: true } : i)) } : c)) } }),
    () => fetchJson<ChecklistItemDto>(`/api/items/${item.id}`, { method: "PATCH", json: { version: item.version, done: true } }),
  );
} catch (error) {
  if (isApiRequestError(error, "CONFLICT")) showLine("Changed elsewhere — reloaded.");
  else if (isApiRequestError(error)) showLine(error.message); // 400 details: error.details
}
```

Rules
- Props are read-only. Change page data only through `mutate(update, request)`; the updater must be pure and
  idempotent (set values, don't toggle). `mutate(update)` without a request is local-only until the next refresh.
- Talk only to this app's `/api/*` via `fetchJson` (it throws the server's `{ error: { code, message, details } }`
  as `ApiRequestError`). After a write that isn't wrapped in `mutate`, call `refresh()`.
- `now` (ISO) ticks on every minute boundary; derive past/current/future from it, never from `Date.now()` in render
  (hydration + the React Compiler lint rules forbid impure render code).
- All dates and clocks use `timeZone` (DASHBOARD_TIME_ZONE) via `src/lib/time/zone.ts` (`formatClock`, `localDateString`, …).
- `isToday` is false for `?date=` in the past or future (past = read-only, future = editable).
- Source down: render `<SourceDown …>` inside your section and keep everything else working (calendar → Timeline,
  `sources.seerr` → the Seerr item of Waiting on you). Never blank the section.
- Layout: the dashboard sets the outer column widths; your root fills its column. The mockup's Timeline is **not**
  a glass panel (cards sit on the painting); the stub uses one only as a placeholder.
- No UI or state libraries; use `src/components/ui/*` (see its README). New primitive → own file + note in your report.
- No `"use client"` needed in these files (they render inside the client tree); hooks are fine.
- Keep `npm run typecheck`, `npm run lint`, `npm test` green; the lint includes the React Compiler rules
  (no ref reads in render, no synchronous setState in effects).
