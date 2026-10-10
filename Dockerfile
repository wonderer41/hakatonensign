FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Prisma config needs a URL at build time, but the production app connects to
# the Compose PostgreSQL service using its runtime DATABASE_URL.
ENV DATABASE_URL=postgresql://continuum:continuum_dev_password@localhost:5432/continuum?schema=public

RUN npm run db:generate && npm run build

EXPOSE 3000

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0"]
