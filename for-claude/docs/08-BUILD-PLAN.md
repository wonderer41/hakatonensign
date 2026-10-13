# 08 · Build plan

Ship in phases. Each phase ends with Gerardo looking at it running. Ask the decisions listed for a phase before starting it.

## Phase 0 — Setup (D1, D2, D3, D16)
- Repo/branch per D1. Copy `CLAUDE.md` to the root.
- Add `prisma/dashboard.prisma` models + `Project.workCards`; migration `homelab_daily`.
- Add `src/types/dashboard-contracts.ts`.
- Fonts via `next/font/google`; tokens from `docs/02-DESIGN.md` into the Tailwind 4 `@theme` and `:root`.
- Background images into `public/` and the full-viewport background layer.

**Done when:** `npm run typecheck`, `npm run lint` and the migration pass; an empty page shows the background, header and fonts.

## Phase 1 — Static page from seed data
- Seed script with the mockup's sample content (cards, items, a sprint, calendar events, snapshots, one alert).
- Components (suggested):
  - `Header`, `SourceLegend`
  - `Banner` → `DailyMessageSlide`, `GmailSlide`, `OrphansScanSlide`, `StocksSlide`, `SlideDots`
  - `Timeline` → `TimelineEventCard`, `GapLabel`, `NowMarker`, `TimelineControls`
  - `WorkingOn` → `SprintHeader`, `WorkCard` → `ProgressSegments`, `CurrentItemRow`, `HermesSuggestion`, `Checklist` → `ChecklistRow`, `ScheduleBubble`
  - `WarningsRail` → `BrokenPanel` → `AlertRow`; `WaitingPanel` → `GmailWaiting`, `SeerrCard` → `SeerrBubble` → `SeerrRequestRow`, `OrphanLinks`
  - shared: `GlassPanel`, `Button` (primary/secondary/alert/icon), `Chip`, `SegmentedControl`
- `GET /api/today` assembling everything from the DB.

**Done when:** the page matches the mockup at 1440px and at phone width; keyboard-only use works; reduced motion turns off autoplay and auto-scroll.

## Phase 2 — Dynamic cards and sprints (D7, D8, D15)
- Browser CRUD routes for sprints, cards, items, reorder; optimistic checkbox with `version` checks.
- `/api/stream` (D12) and client refetch on events.
- GitHub sync into cards/items per D7.

**Done when:** two browser windows stay in sync when a card is created, reordered, checked or archived; a stale edit gets a 409 and recovers.

## Phase 3 — Daily timeline (D4)
- `CalendarEvent` window sync, cancellations, `timeline.changed`.
- Gaps, now marker, past dimming, all-day chips, auto-scroll, midnight rollover, `?date=`.

**Done when:** moving an event in Google Calendar shows on the page within ~2 min (or immediately after `/api/hermes/calendar/changed`); at local midnight the page switches day without reload.

## Phase 4 — Hermes write API (D15)
- `/api/hermes/*` with bearer token, idempotent upserts, strict payload validation, rate limit.
- Install the Hermes skill (`hermes/dashboard-skill.md`) after Gerardo approves it.

**Done when:** running the same Hermes upsert twice changes nothing the second time; a card Hermes creates appears live; a malformed banner payload gets a 400 with details.

## Phase 5 — Scheduling with Hermes (D5, D6)
- Hermes API server enabled and reachable per D5 (check free ports and binds first; back up Hermes config).
- `POST /api/schedule` + worker + SSE progress; booking prompt; JSON validation; calendar link-back.
- Bubble UI with all reply states from `docs/01-PRODUCT-SPEC.md`.

**Done when:** booking a free slot creates a Google event that appears on the timeline as a lilac work block and tags the item; booking over an event returns the conflict text and a working "Use HH:MM"; Hermes being down shows the error state.

## Phase 6 — Banner and warnings data (D9, D10, D11, D13, D14)
- Banner snapshot endpoints wired to Hermes/n8n jobs.
- Seerr list/approve/decline with Temp/Permanent mapping.
- Sonarr/Radarr links; alerts open/resolve; daily message editing.

**Done when:** each slide shows real data with an "as of" time; approving a Seerr request on the page shows up in Seerr in the chosen library.

## Phase 7 — Hardening
- Error states per section, reconnecting label, retention job, rate limits, logs without secrets.
- Lighthouse a11y ≥ 95; page usable on phone.
