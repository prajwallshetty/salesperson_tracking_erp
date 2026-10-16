# =====================================================================
# API (Backend) Standalone Multi-Stage Dockerfile
# Build context: api/ folder (e.g. `cd api && docker build -t erp-api .`)
# Or from root: `docker build -f api/Dockerfile api -t erp-api`
# =====================================================================

FROM node:20-alpine AS builder

WORKDIR /app

# Install openssl for Prisma engines on Alpine
RUN apk add --no-cache openssl

# Copy package manifests & prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies (supports with or without local package-lock.json)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy API source code
COPY . .

# Generate Prisma Client and compile TypeScript to dist/
RUN npx prisma generate
RUN npm run build

# =====================================================================
# Production Runtime Stage
# =====================================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

RUN apk add --no-cache openssl

# Copy package manifests & install production dependencies only
COPY package*.json ./
COPY prisma ./prisma/

RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy generated prisma engine & client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist

# Create uploads directory and set unprivileged permissions
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node
EXPOSE 4000

CMD ["node", "dist/index.js"]
