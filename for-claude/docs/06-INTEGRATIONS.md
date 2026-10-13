# 06 · Integrations

Each integration fails on its own: if one source is down, only its section shows "unavailable — last synced HH:MM".

## Google Calendar → Timeline

- Reuse the existing OAuth refresh-token client (`src/lib/integrations/google-calendar/`, env `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`).
- Today it fetches `showDeleted=false` and writes into `WorkEvent`, which never updates or removes events. For the timeline, write to the new `CalendarEvent` cache instead (`docs/03-DATA-MODEL.md`, `docs/04-API.md` section D).
- Which calendars to show, and whether the dashboard reads Google directly or only through Hermes, is decision D4. Reading directly is what this spec assumes for the timeline (fast, no LLM per page load); Hermes still does the **writing** (booking work blocks).

## GitHub → Working on

- Reuse `src/lib/integrations/github/client.ts` (commits, pulls, issues) and `polling.ts`.
- Card meta line: latest commit time on the default branch and commits in the last 7 days.
- Milestones and issues (if D7 says cards mirror GitHub): `GET /repos/{owner}/{repo}/milestones?state=open`, `GET /repos/{owner}/{repo}/issues?milestone={n}&state=all&per_page=100` (skip items with `pull_request`). Map milestone → card (`github:milestone:...`), issues → items (`github:issue:...`), `state=closed` → `done`.
- Which repos to follow (e.g. the study-sessions repo, homelab-dashboard) is part of D7; don't guess repo names.
- `GITHUB_TOKEN` stays server-side; a fine-grained token with read-only Issues/Contents/Metadata is enough unless D7 adds write-back.

## Gmail → banner slide 2 + Waiting count

- The dashboard does not talk to Gmail. Hermes (Google Workspace skill, Gmail + Calendar) builds a `GmailSnapshot` and pushes it to `PUT /api/hermes/banner/gmail`.
- Groups: Needs reply (sender + subject), Packages (label + status), Payments (merchant + time, **no amounts**), Deleted (count). How Hermes decides each group (Gmail labels, filters or its own classification) is decision D10.

## Seerr → Waiting on you (approve on the page)

Checked in the Seerr API spec (`seerr-team/seerr`, `seerr-api.yml`):

- Auth: header `X-Api-Key: <Seerr API key>` (admin / MANAGE_REQUESTS). Server-side only.
- List pending: `GET /api/v1/request?filter=pending&take=20` (`filter` values: all, approved, available, pending, processing, unavailable, failed, deleted, completed).
- Change library before approving: `PUT /api/v1/request/{requestId}` with `{ mediaType, rootFolder?, profileId?, serverId?, seasons?, is4k? }` (only pending requests; 409 otherwise).
- Approve / decline: `POST /api/v1/request/{requestId}/approve` and `POST /api/v1/request/{requestId}/decline` (409 if not pending).
- Base URL: `https://requests.wonderer41.org` (public through Traefik on VM 103 → Seerr on VM 104 :5055). Whether the dashboard calls the public URL or the LAN address is part of D5.
- **Temp vs Permanent mapping (D14):** guests' requests default to the temp libraries (temp-movies / temp-tvshows with the Temp profiles); "Permanent" moves them to the permanent roots/profiles. The exact `rootFolder`, `profileId` and `serverId` values must be read from Seerr's Radarr/Sonarr server settings (`GET /api/v1/settings/radarr`, `GET /api/v1/settings/sonarr`), not guessed.

## Sonarr / Radarr → Orphan review links

- Links only (no API calls from the dashboard). `SONARR_URL` and `RADARR_URL` point at the Sonarr and Radarr domains on Nginx Proxy Manager, behind the same LAN / NetBird / Tailscale access list as the dashboard, so they open from anywhere the dashboard does.
- Counts come from the orphans snapshot (`counts.sonarr`, `counts.radarr`).

## Orphan pipeline → banner slide 3 (left)

- Source of truth: the n8n Data Table `orphan_items`; items needing manual review have `status = pending_review` and carry `title`, `type`, `is_anime`.
- The dashboard receives an `OrphansSnapshot` (names only) via `PUT /api/hermes/banner/orphans`. Who pushes it — Hermes, or an n8n workflow step after "Orphan Identify" — is decision D10.

## Daily container scan → banner slide 3 (right) + Broken

- Hermes already runs a "Daily Container Health Scan" cron job at 6 AM (delivers to Discord). Extending it to also `PUT /api/hermes/banner/scan` and open/resolve alerts is a Hermes-side change Gerardo approves (see `docs/05-HERMES.md`).

## Stocks → banner slide 4

- Needs a data source and a watchlist (decision D9). Gerardo asked for current price, day change and 6-month change in a 4 × 3 list, and mentioned wanting "new ones, not the current ones" — clarify what that means before building.
- Whatever fetches prices (Hermes job, n8n, or a dashboard job) pushes `StocksSnapshot` with 12 rows.

## Daily message → banner slide 1

- Written by Gerardo on the page, by Hermes, or both (decision D13).
