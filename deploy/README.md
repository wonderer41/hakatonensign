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

Port 4849 is bound on all host interfaces (host networking). Restrict it with the host firewall
if only Nginx Proxy Manager should reach it.

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
