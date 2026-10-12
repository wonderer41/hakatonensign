# CLAUDE.md — Homelab Daily

Personal daily dashboard for Gerardo's homelab, built on the `wonderer41/hakatonensign` backend with a new frontend. Specs live in `for-claude/docs/`; the approved mockup is `for-claude/design/reference/Layout.dc.html`.

## How Gerardo wants to work

- **Never assume.** Not about his setup, hosts, ports, paths, URLs, IDs or preferences. Before creating or changing anything (tables, env vars, compose services, routes, network binds), check how the existing equivalent is actually built, or ask.
- **Ask before every decision.** Don't pick a library, layout, name, path or approach on his behalf. Lay out the options with short pros and cons, then ask. One focused question at a time.
- **When he asks a question, answer it directly first.** Don't bundle the next decision into that answer.
- **Commands:** do every check first (free port, free subnet, existing container names, env values), then give one final, ready-to-run command. Never give a command and then say "check this first".
- **TypeScript only** for app code and scripts. No plain JS files.
- Keep him in the loop with short updates. No long recaps.

## Ground rules for this codebase

- Stack: Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Prisma 7 + PostgreSQL 17. Keep `prisma/migrations` the source of truth; add migrations, never edit applied ones.
- Do not reuse the old hackathon UI (`src/components/continuum-dashboard.tsx`, `src/app/globals.css`). Build the UI from `for-claude/docs/02-DESIGN.md`.
- Secrets stay server-side: Hermes `API_SERVER_KEY`, Seerr API key, GitHub token, Google OAuth, the Hermes→dashboard token. The browser only talks to this app's own `/api/*`.
- All dates and day boundaries are computed in `America/Denver` unless Gerardo changes `DASHBOARD_TIME_ZONE`.
- Every write that Hermes or a sync can repeat must be idempotent (upsert by `externalKey` / `dedupeKey`).
- Every write that changes what the page shows must publish a live update on `/api/stream` (see `for-claude/docs/04-API.md`).
- Reuse the existing error envelope from `src/lib/api/http.ts`: `{ "error": { "code", "message", "details?" } }`.
- Accessibility is part of done: real buttons, labels, focus rings, 44px targets, `prefers-reduced-motion` respected, text contrast ≥ 4.5:1.
- Before building anything that depends on an item in `for-claude/docs/07-OPEN-DECISIONS.md`, ask Gerardo that question.
