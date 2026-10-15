# Homelab Daily

A personal, single-page daily dashboard for a homelab. One screen answers three questions: what is
on my calendar today, what am I working on, and what is waiting on me or broken. Background jobs
keep it current, a [Hermes](https://github.com/NousResearch/hermes-agent) agent writes to it through
an HTTP API, and every change shows up on the open page within seconds.

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Prisma 7 + PostgreSQL 17.

## Screenshots

<!--
  Screenshots go in docs/screenshots/. Add the files, then remove this comment's start and end
  lines so the images below show up.

![The dashboard on a desktop](docs/screenshots/desktop.png)
![The dashboard on a phone](docs/screenshots/phone.png)
-->

_Screenshots coming soon._

## What's on the page

- **Banner.** Slides that rotate on their own: a daily message, a Gmail summary (needs a reply,
  packages, payments, deleted), orphan media plus a daily container scan, and your stock watchlist
  (the first 12 symbols) with the day's change and the 6-month change. A slide with no data is
  skipped.
- **Timeline.** Today's Google Calendar as a row of cards, with the free time between events
  colour-coded, a "now" marker, and blocks Hermes booked shown in lilac. `?date=YYYY-MM-DD` shows
  another day.
- **Working on.** Sprint cards with a checklist, a progress bar and the current item. A card can
  point at a GitHub repo to show its last commit and commits this week. Hermes can suggest from a push
  that an item looks done, but it never checks it off for you.
- **Warnings.** "Broken" alerts, plus "Waiting on you": Gmail threads to answer, Seerr requests to
  approve or decline (with a Temp / Permanent library switch), and links to Sonarr and Radarr.

There is no login. The page is meant to sit on your own network or VPN, with the client allowlist
from [Security](#security) in front of it.

## How it fits together

```
Google Calendar ─┐
Finnhub, Tiingo ─┤
Seerr, GitHub   ─┴─► worker (background jobs) ─┐
                                               ├─► PostgreSQL ─► Next.js page ─► your browser
Hermes ──► /api/hermes/* ──────────────────────┘                (live updates over /api/stream)
```

- The **worker** is a separate process from the app. It syncs the calendar every 2 minutes, Seerr
  every 2 minutes, stock quotes and GitHub every 5 minutes, and stock history once a day.
- **Hermes** pushes what only an agent can work out: the Gmail summary, orphan media, the daily scan,
  alerts, the daily message, and cards, sprints and checklist items.
- Every source is optional. A section whose source isn't set up stays empty or hides itself, and the
  rest of the page keeps working.

## Quick start

You need Docker and Node.js 22.

```sh
cp .env.example .env            # set DASHBOARD_TIME_ZONE; the keys can wait
docker compose up -d            # PostgreSQL on 127.0.0.1:${POSTGRES_PORT} + the migrations
npm install
npx prisma generate
npm run db:seed                 # demo content for today (npm run db:seed -- --clean removes it)
npm run dev                     # http://localhost:3000
npm run worker                  # background jobs, in a second terminal
```

The seed fills the page with demo data, so you can see everything before any key is in. Then set up
the sources you want from the next section.

All dates and day boundaries use `DASHBOARD_TIME_ZONE` (an IANA zone such as `America/Denver`).

## Setting up each source

Every key goes in `.env` and stays on the server. The browser only talks to this app's own `/api/*`.
Each source has a command that tests it from the terminal.

### Google Calendar (timeline)

Read-only. The dashboard only reads your calendar; Hermes books events with its own Google access.

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the
   **Google Calendar API**.
2. Set up the **OAuth consent screen** (External is fine) and add your Google account as a test
   user. While the app is in "Testing", Google expires its refresh tokens after 7 days. To avoid
   re-running step 4 every week, set the publishing status to "In production". For your own account
   you don't need Google's verification; you click through the "unverified app" warning once.
3. Under **Credentials**, create an **OAuth client ID** of type **Desktop app**. Put its ID and
   secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Run `npm run google:auth` in your own terminal (it prints a secret). Open the sign-in link it
   prints and approve read-only access. It then prints a refresh token for `GOOGLE_REFRESH_TOKEN` and lists your calendars so you can pick
   `GOOGLE_CALENDAR_ID` (`primary` is your main calendar).
5. Test: `npm run sync:calendar`.

### Stocks (banner)

Both have free plans. Finnhub gives the live price and the day's change (every 5 minutes); Tiingo gives
the daily history used for the 6-month change.

1. Sign up at [finnhub.io](https://finnhub.io/) and copy the API key from the dashboard into
   `FINNHUB_API_KEY`.
2. Sign up at [tiingo.com](https://www.tiingo.com/) and copy the token from Account → API into
   `TIINGO_API_KEY`.
3. Pick your symbols: `npm run stocks:watchlist -- NVDA AMD TSLA`. This replaces the whole list; the
   banner shows the first 12. Hermes can change the list later too.
4. Test: `npm run sync:stocks`, then `npm run sync:stocks:history`.

### Seerr (requests to approve)

1. In Seerr, go to **Settings → General** and copy the **API Key** into `SEERR_API_KEY`.
2. Set `SEERR_URL` to the address the server uses to reach Seerr (a LAN address works), and
   `SEERR_PUBLIC_URL` to the address the "Open Seerr" link should open in your browser.
3. Approving a request first moves it to a Temp or Permanent library. Run `npm run seerr:settings` to
   list your Radarr/Sonarr servers, root folders and quality profiles, then fill in the `SEERR_MOVIE_*`,
   `SEERR_TV_*` and `SEERR_ANIME_*` values in `.env`. The same command checks them. Anime always goes
   to the anime library.
4. Test: `npm run seerr:pending`.

### GitHub (card meta)

1. Create a **fine-grained personal access token** (GitHub → Settings → Developer settings → Personal
   access tokens → Fine-grained tokens).
2. Repository access: all repositories, or only the ones your cards point at. Permissions:
   **Contents: Read-only** (Metadata: Read-only is added on its own). Nothing needs write access.
3. Put it in `GITHUB_TOKEN`.
4. Give a card a repo (`owner/name`), then test: `npm run sync:github`.

### Sonarr and Radarr (links)

`SONARR_URL` and `RADARR_URL` are only browser links on the orphan-review tiles. The app never calls
their APIs.

### Jira

The `JIRA_*` variables belong to code that is kept for a future "work" view. Nothing on the page uses
them yet; leave them empty.

## Hermes

Hermes and the dashboard talk in both directions. Each direction has its own secret.

### Hermes → dashboard

Hermes creates and updates cards, sprints, checklist items, the banner snapshots (Gmail, orphans,
scan), alerts, the daily message and the stock watchlist.

1. Generate a token, for example with `openssl rand -hex 32`, and put it in `HERMES_DASHBOARD_TOKEN`.
2. In Hermes's env file, set `HOMELAB_DAILY_TOKEN` to the same value and `HOMELAB_DAILY_URL` to where
   Hermes can reach the dashboard (for example `http://127.0.0.1:4849` when both run on the same host).
3. Install the [`homelab-daily`](skills/homelab-daily/SKILL.md) skill in Hermes (see
   [Agent skills](#agent-skills)). It describes every route, how to address rows, and how to recover
   from errors.
4. Test against a running dev server: `npm run hermes:smoke`.

### Dashboard → Hermes (scheduling, not built yet)

The "Schedule with Hermes" bubble will ask Hermes to book calendar time through Hermes's API server.
The bubble is on the page, but the route behind it isn't built yet, so it says scheduling isn't
connected. To get ready:

1. In Hermes's env file: `API_SERVER_ENABLED=true` and `API_SERVER_KEY=<a long random string>`.
   Hermes listens on `127.0.0.1:8642` unless you set `API_SERVER_HOST` / `API_SERVER_PORT`.
2. In this app's `.env`: `HERMES_API_URL=http://<API_SERVER_HOST>:<API_SERVER_PORT>/v1` and
   `HERMES_API_KEY` set to Hermes's `API_SERVER_KEY`.
3. Developing on another machine? Tunnel to it:
   `ssh -L 8642:<API_SERVER_HOST>:8642 <user>@<hermes-host>`, then use `http://127.0.0.1:8642/v1`.

The API server gives whoever holds the key Hermes's full tool access, terminal included. Keep it bound
to loopback or a private Docker network, and never expose it through a proxy.

## Agent skills

[`skills/`](skills) holds the skills that teach an AI agent to work with the dashboard. Each skill is a
folder with a `SKILL.md` in the [Agent Skills](https://agentskills.io) format, so the same files work
in Hermes, Claude Code and other agents that read that format.

| Skill | What it lets the agent do |
|---|---|
| [`homelab-daily`](skills/homelab-daily/SKILL.md) | Read the page's state and update cards, checklist items, sprints, push-progress notes, the banner snapshots (Gmail, orphans, scan), alerts, the daily message and the stock watchlist |

To install a skill, copy its folder into the agent's skills folder: `~/.hermes/skills/` for Hermes,
`~/.claude/skills/` for Claude Code. The agent also needs `HOMELAB_DAILY_URL` and
`HOMELAB_DAILY_TOKEN` in its environment (see [Hermes → dashboard](#hermes--dashboard)), and it has to
reach the dashboard on your network. An agent that runs in the cloud usually can't.

## Security

- **No login.** Put the page behind your own network, VPN or reverse-proxy access list.
- **`DASHBOARD_ALLOWED_CIDRS`**: the production server (`npm run start`, used by the Docker image) only
  answers clients from these ranges. It checks the real TCP peer address and never trusts
  `X-Forwarded-For`. Loopback is always allowed. Empty means everyone, and a warning is logged.
- **`DASHBOARD_ALLOWED_HOSTS`**: the host names the app answers to, which stops DNS rebinding.
- Browser writes to `/api/*` from other sites are refused (CSRF). `npm run dev` skips the allowlist.

Details and examples are in `.env.example` and [`deploy/README.md`](deploy/README.md#access-control).

## Deploy

One Docker image runs the app, the worker and the migrations. GitHub Actions builds it and pushes it
to GHCR; a compose stack (for example in Komodo) runs it with PostgreSQL. The app listens on port 4849.
See [`deploy/README.md`](deploy/README.md) for the first deploy, image tags, updating, rolling back
and backups.

## Development

```sh
npm run typecheck && npm run lint && npm test
npm run build
```

| Command | What it does |
|---|---|
| `npm run browser:smoke` | Exercises the sprint, card and item routes the page uses, end to end |
| `npm run hermes:smoke` | Exercises the Hermes routes against a running dev server |
| `npm run live:tail` | Prints live updates as they happen; make any change in another terminal |
| `npm run db:studio` | Opens Prisma Studio on the database |
| `npm run db:migrate` | Creates and applies a new migration (never edit one that was already applied) |

After `npx prisma generate`, restart `npm run dev`: it caches the generated client.

## License

[MIT](LICENSE)
