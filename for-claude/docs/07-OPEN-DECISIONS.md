# 07 · Open decisions — ask Gerardo before building

Gerardo wants to decide these himself. Ask **one at a time**, show the options with short pros/cons, and wait. Don't start code that depends on an unanswered one. Anything already settled is listed at the bottom.

| # | Decision | Options (pros / cons) | Blocks |
|---|---|---|---|
| D1 | **Where the code lives** | (a) A branch/fork of `hakatonensign` — keeps history and integrations; carries hackathon leftovers. (b) A new repo (e.g. `homelab-daily`) that copies the backend pieces — clean start; more setup. | Everything |
| D2 | **How it runs** | Docker on `ubuntu-main` like his other services, updated by Komodo (as planned for pomanor-mcp: GitHub Actions → GHCR → Komodo), behind Nginx Proxy Manager. Ask: hostname, port (check it's free first), and LAN + NetBird only vs public. | Deploy |
| D3 | **Access control** | (a) Network-only (LAN + NetBird, no login) — simplest; anyone on the mesh can approve Seerr requests. (b) Single-user login (like the Hermes dashboard) — safer; one more thing to build. | Browser routes |
| D4 | **Timeline reads the calendar from** | (a) Google directly (cached `CalendarEvent`) — fast, no LLM per load; dashboard needs its own Google OAuth. (b) Through Hermes — one integration; slow, uses the 3090 on every refresh. Also: which calendars to include. | Timeline |
| D5 | **Network paths to Hermes and Seerr** | Hermes runs `network_mode: host`; its API server binds `127.0.0.1:8642` by default. Options: bind to the Docker gateway (like the Hermes dashboard on `172.18.0.1:9119`), to the NetBird IP, or run the dashboard in host mode. Check free ports and existing binds before proposing a command. Seerr: public URL vs LAN `192.168.1.189:5055`. | Scheduling, Seerr |
| D6 | **Who decides conflicts** | (a) Dashboard pre-checks the cached calendar, Hermes only books — instant, deterministic; cache can be up to ~2 min stale (Hermes re-checks anyway). (b) Hermes alone — single source of truth; slower and depends on the model returning clean JSON. | Scheduling |
| D7 | **Cards ↔ GitHub** | (a) Cards mirror milestones and issues automatically; checking an item does not touch GitHub. (b) Same, plus checking an item closes the issue (needs a write token). (c) Cards are dashboard-only; GitHub only feeds the meta line. Also: which repos to follow (including the study-session repo — ask its exact name). | Working on |
| D8 | **What a sprint is** | (a) Dashboard-native: name + start/end dates, cards assigned to it, one active at a time. (b) A GitHub milestone with a due date = a sprint. (c) Fixed cadence (e.g. 2 weeks) created automatically by Hermes. The sprint UI (header, switching, history) isn't designed yet — mock it with him first. | Working on |
| D9 | **Stocks** | Data source (free API, Hermes job, n8n), which 12 symbols, and what "new ones, not the current ones" means (new listings? a watchlist separate from holdings?). | Banner slide 4 |
| D10 | **Who builds the Gmail and orphan snapshots** | Gmail: Hermes classifies vs Gmail labels/filters. Orphans: Hermes reads `orphan_items` vs an n8n step pushes it after "Orphan Identify". | Banner slides 2–3 |
| D12 | **Background jobs and live fan-out** | Jobs inside Next.js (`instrumentation.ts`) vs a separate worker container (like `scripts/telegram-bot.ts`). Live events: in-process emitter (one process) vs Postgres `LISTEN/NOTIFY` (multiple processes). | Live updates |
| D13 | **Daily message** | Typed by Gerardo, written by Hermes each morning, or Hermes drafts and he edits. | Banner slide 1 |
| D14 | **Seerr Temp vs Permanent mapping** | Read root folders, profile IDs and server IDs from Seerr's Radarr/Sonarr settings and confirm with him which are "Temp" and which are "Permanent" (anime has its own root). | Seerr approve |
| D15 | **Who wins when Hermes and Gerardo edit the same card** | Proposed: user edits win; Hermes needs `force: true` to override. Confirm. | Hermes write API |
| D16 | **Hackathon leftovers** | Keep, disable or remove Jira and Telegram code and the old UI files. | Cleanup |

## Already decided (don't re-ask)

- Visual direction, palette, type, sharp edges, layout, and the palette-knife v7 background (`docs/02-DESIGN.md`).
- Integrations in scope: GitHub, Google Calendar, Gmail, Seerr, orphan pipeline, daily scan, stocks, Hermes. **pomanor-mcp is not part of this yet.**
- Scheduling happens **on the page** through Hermes's API server; Gerardo picks the start time and any length in minutes; conflicts are answered with what's in the way and the next free slot.
- Seerr requests are approved on the dashboard with a Temp | Permanent switch (default Temp).
- Calendar events are shown as a timeline, never as a calendar grid.
- Time zone: America/Denver.
- D11: Sonarr / Radarr tiles link to their Nginx Proxy Manager domains (`SONARR_URL`, `RADARR_URL`), behind the LAN / NetBird / Tailscale access list.
