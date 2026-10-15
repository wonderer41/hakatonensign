# Deploying Homelab Daily

The image is built in CI, never on the server: GitHub Actions builds the `Dockerfile`, pushes it to
GHCR, and Komodo runs `deploy/compose.yml` on the host with that image.

```
git push -> .github/workflows/image.yml -> ghcr.io/<owner>/<repo>:<tag> -> Komodo stack -> app :4849
```

The stack has four services, all from one image except Postgres:

| Service | What it does |
|---|---|
| `postgres` | PostgreSQL 17, published on `127.0.0.1:5432` only, data in the `postgres-data` volume |
| `migrate` | `prisma migrate deploy`, then exits. `app` and `worker` wait for it to succeed |
| `app` | Next.js on port **4849**, host network, healthcheck on `/api/health` |
| `worker` | `scripts/worker.ts` (background jobs), host network, separate container |

## Image tags

`.github/workflows/image.yml` pushes on every push to `main` and `homelab-daily`, and on `v*` tags:

| Tag | When |
|---|---|
| `latest` | pushes to `main` only |
| `main`, `homelab-daily` | the branch that was pushed |
| `sha-<short>` | every build; use it to pin or roll back |
| `v1.2.3` | git tags |

## First deploy in Komodo

1. **Make the image pullable.** After the first workflow run, open the package on GitHub
   (Packages -> the repo's image -> Package settings) and either set it to public, or create a
   token with `read:packages` and add it in Komodo as a `ghcr.io` registry account.
2. **Create the stack** on the `ubuntu-main` server (Stacks -> New Stack):
   - Source: this git repo and branch, **Run Directory** `deploy`, **File Paths** `compose.yml`.
     The stack's `.env` has to end up next to `compose.yml` because the services use `env_file: .env`.
   - **Environment**: paste `deploy/.env.example` and fill in the values (see the root
     `.env.example` for what each one does). Set `APP_IMAGE` to the real image,
     e.g. `ghcr.io/<owner>/<repo>:latest`. `DATABASE_URL` must match the `POSTGRES_*` values.
3. **Deploy.** Order is handled by compose: postgres healthy, then migrate, then app and worker.
4. **Check it** on the host: `curl http://127.0.0.1:4849/api/health` returns
   `{"ok":true,"db":true,...}`. Then point the Nginx Proxy Manager host at port 4849.

Port 4849 is bound on all host interfaces (host networking). `DASHBOARD_ALLOWED_CIDRS` decides who
may use it; see [Access control](#access-control).

## Access control

Two layers, each gating a different way in:

| Layer | Gates | Set in |
|---|---|---|
| Nginx Proxy Manager access list | the public hostname | NPM -> Access Lists (LAN / NetBird / Tailscale) |
| `DASHBOARD_ALLOWED_CIDRS` | direct connections to `:4849` | the stack's `.env` |
| `DASHBOARD_ALLOWED_HOSTS` | the host names the app answers to (DNS rebinding) | the stack's `.env` |
| same-origin check | browser writes to `/api/*` from other sites (CSRF) | built in, nothing to set |

The app checks the address that opened the TCP connection and never trusts `X-Forwarded-For`, so a
client cannot talk its way in with a header. Two consequences:

- Requests through NPM arrive from NPM's container address on its Docker network, so that network's
  range must be on the list. NPM's own access list still filters the real clients.
- Loopback (`127.0.0.0/8`, `::1`) is always allowed: the healthcheck and Hermes calling
  `http://127.0.0.1:4849` work without listing anything. Anything on the host that uses the host's
  LAN IP instead arrives from that LAN IP and needs the LAN range.

Fill in these ranges (comma-separated; IPv6 ranges too if clients connect over IPv6):

1. **LAN**, e.g. `192.168.1.0/24`.
2. **NetBird**: the range in the NetBird dashboard, or `ip -4 addr show wt0` on the host.
3. **Tailscale**: the range in the admin console, or `ip -4 addr show tailscale0` on the host.
4. **NPM's Docker network**: find the network with
   `docker inspect <npm-container> -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'`,
   then its range with `docker network inspect <network> -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'`.

```
DASHBOARD_ALLOWED_CIDRS=192.168.1.0/24,100.64.0.0/10,172.18.0.0/16
```

The values above are placeholders. Left empty, everyone is allowed and the app logs
`[acl] DASHBOARD_ALLOWED_CIDRS is not set; every client is allowed` at startup.

**Apply a change:** edit `DASHBOARD_ALLOWED_CIDRS` in the stack's Environment in Komodo (the stack
`.env`) and redeploy the stack; with plain compose, `docker compose up -d app` recreates only `app`.
Then check `docker logs <stack>-app-1 2>&1 | grep '\[acl\]'`:

- `[acl] allowing loopback and 192.168.1.0/24, ...`: the list is active.
- `[acl] DASHBOARD_ALLOWED_CIDRS: "<entry>" ...`: a bad entry. The app exits instead of allowing
  everyone, and the container keeps restarting until the entry is fixed.
- `[acl] denied 192.168.1.77 (3 requests)`: a refused client, logged at most once per address per
  minute. The client gets `403 {"error":{"code":"FORBIDDEN",...}}`.

The list is applied by `scripts/server.ts`, which the image must start
(`node --import tsx scripts/server.ts`). Plain `next start` serves the app without it.

## Updating

Push to `main`, wait for the **Image** workflow, then redeploy the stack in Komodo (pull the new
image and deploy). `migrate` runs again on every deploy and only applies migrations that are new.

## Rolling back

Set `APP_IMAGE` in the stack's Environment to an earlier build and deploy again:

```
APP_IMAGE=ghcr.io/<owner>/<repo>:sha-abc1234
```

Find the tag on the package page or in the **Image** workflow run. Rolling back swaps the code
only: migrations are not undone, so only go back across a schema change if the older code still
works with the newer schema.

## Logs and backups

- Logs: `docker logs <stack>-app-1` / `<stack>-worker-1` (rotated at 3 x 10 MB).
- Data: back up the `postgres-data` volume, for example with
  `docker compose exec postgres pg_dump -U <user> <db>`.
