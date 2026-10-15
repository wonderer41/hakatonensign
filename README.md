# Homelab Daily

A personal, single-page daily dashboard for a homelab: today's calendar as a timeline, the work in
progress (sprints, cards, checklists), what is waiting on you (Gmail, Seerr requests, orphan media)
and what is broken — kept current by background jobs and by a [Hermes](https://github.com/NousResearch/hermes-agent)
agent that writes to the dashboard's API.

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Prisma 7 + PostgreSQL 17.
The design (liquid glass over a palette-knife "Water Lilies" background) and the full specs live in
[`for-claude/docs`](for-claude/docs).

## Run it locally

```sh
cp .env.example .env            # fill in what you have; everything degrades on its own when unset
docker compose up -d            # PostgreSQL on 127.0.0.1:${POSTGRES_PORT} + the migrations
npm install
npx prisma generate
npm run db:seed                 # demo content for today (npm run db:seed -- --clean removes it)
npm run dev                     # http://localhost:3000
npm run worker                  # background jobs (calendar, stocks, Seerr, GitHub, rollover, retention)
```

`npm run dev` allows every client; the production server (`npm run start`, used by the Docker image)
adds the `DASHBOARD_ALLOWED_CIDRS` / `DASHBOARD_ALLOWED_HOSTS` checks described in `.env.example`.

## Integrations and the commands that test them

| Source | Env | Try it |
|---|---|---|
| Google Calendar (read-only) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID` | `npm run google:auth`, then `npm run sync:calendar` |
| Stocks | `FINNHUB_API_KEY`, `TIINGO_API_KEY` | `npm run stocks:watchlist -- NVDA AMD …`, `npm run sync:stocks`, `npm run sync:stocks:history` |
| Seerr | `SEERR_URL`, `SEERR_API_KEY`, `SEERR_PUBLIC_URL`, the `SEERR_*` library mapping | `npm run seerr:settings`, `npm run seerr:pending` |
| GitHub card meta | `GITHUB_TOKEN` | `npm run sync:github` |
| Sonarr / Radarr | `SONARR_URL`, `RADARR_URL` (links only) | — |
| Hermes → dashboard | `HERMES_DASHBOARD_TOKEN` | `npm run hermes:smoke` (against a running dev server) |
| Live updates | — | `npm run live:tail` in one terminal, any write in another |

Browser-side writes: `npm run browser:smoke` exercises the sprint/card/item routes end to end.

Hermes gets its instructions from [`for-claude/hermes/dashboard-skill.md`](for-claude/hermes/dashboard-skill.md).

## Checks

```sh
npm run typecheck && npm run lint && npm test
npm run build
```

## Deploy

One image runs the app, the worker and the migrations; see [`deploy/README.md`](deploy/README.md)
for the GHCR workflow, the Komodo compose stack and the access-control setup.
