# SalesGrid — Deployment, Cut-over and Rollback

SalesGrid ships as **one Node.js service** (`server.ts`: Next.js + Socket.IO on one port) plus the
existing PostgreSQL database. It replaces three legacy deployments: `salesperson-erp-api`,
`salesperson-erp-admin` and `salesperson-erp-app`.

## Why a custom server (and not serverless)

The legacy system pushes live GPS positions and order/payment/expense events over Socket.IO. That
needs a long-lived process, which serverless Route Handlers cannot hold. Instead of silently dropping
realtime, SalesGrid runs Next.js inside a small Node server that also hosts Socket.IO. Consequences:

- Deploy to a platform that runs a persistent Node process (Render web service, a VM/container, PM2).
  Vercel/serverless is **not** supported for production (realtime and file uploads would break).
- Run **one instance**. Socket.IO rooms, the in-memory rate limiter, and local-disk uploads are per
  process. To scale horizontally later: add the Socket.IO Redis adapter, a Redis-backed rate limiter
  (`src/lib/http/rateLimit.ts`), and object storage for `UPLOAD_DIR`.
- There are no scheduled jobs or webhooks in the legacy system, so none were added.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Existing production PostgreSQL. |
| `JWT_SECRET` | yes | ≥ 32 chars, no placeholder text (validated at start in production). **Reuse the legacy API's value** so sessions issued by the old API stay valid during cut-over. |
| `NODE_ENV` | yes | `production`. |
| `PORT` | no | Default 3000. |
| `UPLOAD_DIR` | yes in prod | Persistent directory for receipts/proofs. Copy the legacy API's `uploads/` here. |
| `DEFAULT_TIMEZONE` / `NEXT_PUBLIC_DEFAULT_TIMEZONE` | no | Business timezone (default `Asia/Kolkata`). Defines "today" for dashboards, attendance dates and reports. |
| `CORS_ORIGINS` | no | Only needed for cross-origin API clients (e.g. a native app during transition). Same-origin web use needs none. |
| `COOKIE_SECURE` | no | Defaults to `true` in production (HTTPS required). |
| `AUTH_RATE_LIMIT_MAX`, `API_RATE_LIMIT_MAX` | no | Per IP per 15 min (defaults 30 / 1000, same as legacy). |
| `SHOW_DEMO_LOGINS` | no | Never enable in production. |

Removed: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`, `API_URL`, `EXPO_PUBLIC_API_URL` — the UI and
API share one origin. `npm run check:env` validates configuration and database connectivity.

## Option A — Render (`render.yaml`)

`render.yaml` defines one web service with a persistent disk for uploads and `preDeployCommand: npx prisma migrate deploy`.
Point `DATABASE_URL` at the **existing** database (replace the `fromDatabase` block if the database is
not managed by this blueprint). Node version is pinned by `.node-version` (22).

## Option B — Docker

```bash
docker build -t salesgrid .
docker run -p 3000:3000 --env-file .env -v salesgrid-uploads:/app/uploads salesgrid
```
The container runs `prisma migrate deploy` then starts the server; it has a `HEALTHCHECK` on `/api/health`.

## Option C — VM with PM2

```bash
npm ci && npm run build && npx prisma migrate deploy
pm2 start ecosystem.config.js --env production
```

## Cut-over plan (existing production)

1. **Back up** the database (`pg_dump -Fc`) and the legacy `uploads/` directory.
2. **Baseline** the migration history once (no DDL is executed; the schema is identical):
   `DATABASE_URL=… npm run db:baseline`, then `npx prisma migrate status` → "up to date".
3. Copy legacy `uploads/*` into the new `UPLOAD_DIR` (receipt URLs `/api/files/<name>` are unchanged).
4. Deploy SalesGrid with the **same `JWT_SECRET`** as the legacy API. Verify `GET /api/health`, sign in as
   each role, open the live map, place and verify a test transaction on a test client, then void it.
5. Switch DNS / the admin URL to SalesGrid. Field staff open the SalesGrid URL on their phones
   (`/field`, installable to the home screen). Existing native-app tokens keep working against
   `/api/*` because the token format and secret are unchanged.
6. Keep the legacy services **stopped but deployable** until production verification is complete.

## Rollback

- Code: the last pre-migration commit is **`e1cf0ae`** (legacy `admin/`, `api/`, `app/`, `shared/`).
  Redeploy it to restore the three legacy services.
- Data: this migration makes **no schema changes**, so the legacy API can run against the same database
  without any data rollback. Records created in SalesGrid use the same tables and formats.
- The only DB artifact added is the `_prisma_migrations` table from baselining; the legacy API ignores it.

## Things to verify in production (cannot be verified from CI)

See `docs/DEVICE_TESTING.md` — real-device GPS behaviour, camera upload, and installed-PWA behaviour.
