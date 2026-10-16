# =====================================================================
# Admin Dashboard Standalone Multi-Stage Dockerfile
# Build context: admin/ folder (e.g. `cd admin && docker build -t erp-admin .`)
# Or from root: `docker build -f admin/Dockerfile admin -t erp-admin`
# =====================================================================

FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

# Install dependencies (supports with or without package-lock.json)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

ENV NODE_ENV=production
RUN npm run build

# =====================================================================
# Production Runtime Stage
# =====================================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./

RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.mjs ./next.config.mjs

RUN mkdir -p /app/public && chown -R node:node /app

USER node
EXPOSE 3000

CMD ["npx", "next", "start", "-p", "3000"]
