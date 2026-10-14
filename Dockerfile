# syntax=docker/dockerfile:1

# Homelab Daily: one image, three jobs (selected by the command, see deploy/compose.yml):
#   app      (default CMD)                      node --import tsx scripts/server.ts  (next start + client allowlist)
#   worker   npx tsx scripts/worker.ts          background jobs (TypeScript, run with tsx)
#   migrate  npx prisma migrate deploy          applies prisma/migrations, then exits
#
# Build:   docker build -t homelab-daily:local .
# No build arguments or secrets are needed. `prisma generate` only requires DATABASE_URL to be
# *defined* (prisma.config.ts reads it with env()); it never connects, so a placeholder is used.

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# All dependencies (dev included) for generating the Prisma client and building Next.
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# Production dependencies only. prisma, tsx and dotenv are regular dependencies on purpose:
# the migrate and worker containers run them from this same image.
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

FROM deps AS build
COPY . .
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" npx prisma generate
RUN npm run build
# The build cache is not needed to run the app.
RUN rm -rf .next/cache

FROM base AS runner
ENV NODE_ENV=production \
    PORT=4849 \
    HOSTNAME=0.0.0.0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# node_modules first (changes least), then the app. Everything is owned by root and read-only
# for the runtime user; the app does not write to disk.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/src ./src
COPY package.json package-lock.json tsconfig.json next.config.ts prisma.config.ts ./
COPY public ./public
COPY scripts ./scripts
COPY prisma ./prisma

USER node
EXPOSE 4849

# scripts/server.ts = `next start` plus the DASHBOARD_ALLOWED_CIDRS client allowlist (it checks the
# TCP peer before Next sees the request). It reads the port from $PORT. Run node directly (not
# through npm) so SIGTERM from `docker stop` reaches the server and it shuts down cleanly.
CMD ["node", "--import", "tsx", "scripts/server.ts"]
