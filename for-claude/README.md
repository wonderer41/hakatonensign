# Homelab Daily — handoff for Claude Code

A personal daily dashboard for Gerardo's homelab. It replaces the Continuum hackathon **frontend** with a new design, keeps the useful **backend** pieces of `wonderer41/hakatonensign`, and adds live data that changes every day: a calendar timeline, "Working on" cards that Hermes can create and update, and quick-action panels for Gmail, Seerr, the orphan pipeline and container health.

Design canvas (live, interactive mockup): https://claude.ai/code/artifact/79aed0f8-7a38-4d44-ba5a-8db835ce0125
The board named **"Layout — banner, timeline, 2/3 + 1/3"** is the approved screen. Press Play on it to try every interaction.

## Read in this order

| # | File | What it gives you |
|---|------|-------------------|
| 1 | `CLAUDE.md` | Working rules for this project. Copy it to the repo root. |
| 2 | `docs/07-OPEN-DECISIONS.md` | Questions you must ask Gerardo **before** writing code that depends on them. |
| 3 | `docs/01-PRODUCT-SPEC.md` | Every section of the screen, its behavior and its states. |
| 4 | `docs/02-DESIGN.md` | Tokens, type, components, motion, background, accessibility. |
| 5 | `docs/03-DATA-MODEL.md` + `prisma/dashboard.prisma` | New tables for cards, sprints, checklist items, calendar cache, schedule requests, banner snapshots, alerts. |
| 6 | `docs/04-API.md` + `src/types/dashboard-contracts.ts` | Browser API, Hermes write API, live update stream. |
| 7 | `docs/05-HERMES.md` + `hermes/dashboard-skill.md` | Both directions: dashboard → Hermes (scheduling) and Hermes → dashboard (cards, banners, alerts). |
| 8 | `docs/06-INTEGRATIONS.md` | GitHub, Google Calendar, Gmail, Seerr, Sonarr/Radarr, orphan pipeline, daily scan, stocks. |
| 9 | `docs/08-BUILD-PLAN.md` | Phases with acceptance checks. |
| — | `design/reference/Layout.dc.html` | The approved mockup's markup and interaction logic (a design-tool file, not production code; the heavy background SVG was removed). |
| — | `design/reference/StyleTile.dc.html` | Palette, type and edge treatment on one tile. |
| — | `design/assets/*.webp` | The final palette-knife background, desktop and portrait. |
| — | `design/tools/generate_background.py` | Regenerates the background at any size (Python 3, no dependencies). |

## The three things that must stay dynamic

1. **Working on cards** are rows in the database, not hard-coded. They are grouped by **sprint**, reordered, archived, and created or updated at any time by Gerardo, by GitHub sync, or by **Hermes** through an authenticated API. The page updates live without a reload.
2. **The timeline** is built for a given date from the cached Google Calendar, every day, in `America/Denver`. It rolls over at local midnight, and new or moved events appear live.
3. **Banner slides and warnings** (Gmail summary, orphans + daily scan, stocks, Broken alerts) are snapshots that Hermes or n8n push in; the page shows the latest one and updates live.

## What already exists in `hakatonensign` (reuse, don't rebuild)

- Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Prisma 7, PostgreSQL 17 via Docker Compose (`docker-compose.yml` with a `migrate` service).
- `src/lib/integrations/github/*` (client, normalize, sync, polling) and `src/lib/integrations/google-calendar/*` (OAuth refresh-token client, normalize, sync).
- `src/lib/api/http.ts` + `validation.ts` (error envelope `{ error: { code, message, details } }`), `src/types/contracts.ts`.
- `WorkEvent` table (activity log with `@@unique([projectId, source, externalId])` dedupe).

Do **not** reuse `src/components/continuum-dashboard.tsx` or `src/app/globals.css`; the frontend is rebuilt from scratch per `docs/02-DESIGN.md`. Jira and Telegram code can stay untouched or be removed (ask first, see decisions).

Known gap: the current Google Calendar sync inserts calendar events into `WorkEvent` and **never updates or deletes** them (dedupe skips existing rows). The timeline needs the new `CalendarEvent` cache in `docs/03-DATA-MODEL.md`, which handles moves, edits and cancellations.
