FROM node:22-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci

COPY python-renderer/requirements.txt ./python-renderer/requirements.txt
RUN python3 -m venv /app/.venv \
  && /app/.venv/bin/pip install --no-cache-dir --upgrade pip \
  && /app/.venv/bin/pip install --no-cache-dir -r ./python-renderer/requirements.txt

FROM deps AS builder

COPY . .
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PYTHON_BIN=/app/.venv/bin/python

COPY --from=deps /app/.venv ./.venv
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/python-renderer ./python-renderer
COPY --from=builder /app/src/generated ./src/generated

EXPOSE 3000

CMD ["sh", "-c", "npm run start -- -p ${PORT:-3000}"]