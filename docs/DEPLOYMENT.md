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
- **One instance** works with no extra services. To run **several instances** behind a load balancer, set
  `REDIS_URL`: Socket.IO then uses the Redis adapter (events, rooms and "sign out everywhere" reach sockets
  on every instance) and rate limits are counted in Redis. Uploads are still files on disk, so every
  instance must mount the **same** `UPLOAD_DIR` (shared volume / NFS). Object storage is not implemented,
  and a Render persistent disk attaches to one instance only, so on Render stay on one instance.
  The load balancer needs WebSocket support; sticky sessions are only required if you allow the
  long-polling transport and the balancer does not keep a client on one instance.
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
| `DEV_QUICK_LOGIN` | no | Development quick login; ignored when `NODE_ENV=production`. (Replaces `SHOW_DEMO_LOGINS`.) |
| `ANDROID_MIN_BUILD`, `ANDROID_LATEST_BUILD`, `ANDROID_UPDATE_URL` | no | Android app update gate — see `docs/MOBILE_ANDROID.md`. |
| `LOCATION_RETENTION_DAYS` | no | Whole days, ≥ 7. Deletes raw GPS points older than this, daily, with an audit record per company. Unset (default) keeps everything. |
| `REDIS_URL` | no | `redis://` or `rediss://`. Enables multi-instance mode (see above). In production the server refuses to start if it cannot reach Redis for Socket.IO; if Redis drops later, requests keep working with per-instance rate limits, cross-instance realtime pauses, and `/api/health` reports `"redis": "down"`. |
| `ALLOW_QUERY_TOKEN` | no | Default off. `true` re-enables legacy `?token=` authentication on API URLs and the socket handshake, for an old client during rollout only (tokens in URLs leak into logs). |

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
   `DATABASE_URL=… npm run db:baseline`, then `npx prisma migrate status` → it lists
   `1_session_revocation_and_file_ownership` as not yet applied.
3. **Apply the reviewed migrations** — `npx prisma migrate deploy` (Render/Docker run it on deploy). Read the SQL
   first; all three are data-preserving:
   - `1_session_revocation_and_file_ownership`: `users."tokenVersion"` and the `uploaded_files` table.
   - `2_multi_tenancy`: the `tenants` table and one default company (`default`); a `tenantId` column on
     18 tables (a constant default, so existing rows join the default company without a table rewrite on
     PostgreSQL ≥ 11); global unique keys become per-company unique keys (weaker, so no existing row can
     violate them); foreign keys and indexes. Take a backup first: this is the largest change.
   - `3_tracking_device_state`: one enum and three nullable columns on `salespersons`.
   Nobody is signed out by them. Afterwards run `npm run check:env` and
   `npm run tenant -- rename default "Your Company Name"`; users keep signing in as before (no company
   code is asked while only one company exists).
   Rehearsed on a clone of populated data: identical row counts, every row in the default company, no
   schema drift (`prisma migrate diff --exit-code`).
4. Copy legacy `uploads/*` into the new `UPLOAD_DIR` (receipt URLs `/api/files/<name>` are unchanged).
   These files have no `uploaded_files` row, so they open for super admins and for whoever can see the
   payment, visit or expense that references them (see ARCHITECTURE.md → Files).
5. Deploy SalesGrid with the **same `JWT_SECRET`** as the legacy API. Verify `GET /api/health`, sign in as
   each role, open the live map, place and verify a test transaction on a test client, then void it.
6. Switch DNS / the admin URL to SalesGrid. Field staff open the SalesGrid URL on their phones
   (`/field`, installable to the home screen). Existing native-app tokens keep working against
   `/api/*` because the secret is unchanged and tokens without a version are accepted. A client that
   authenticated with `?token=` needs `ALLOW_QUERY_TOKEN=true` until it is updated.
7. Keep the legacy services **stopped but deployable** until production verification is complete.

## Adding companies

Companies are created by an operator with database access (no platform-wide role or API exists):

```bash
npm run tenant -- list
npm run tenant -- create acme "Acme Traders" --admin-name "Asha Rao" --admin-email asha@acme.example --admin-phone 9000000001
npm run tenant -- rename|set-code|suspend|activate|expiry <code> …
```

`create` prints a one-time admin password (or reads one from `--admin-password-env VAR`). From the moment
a second company exists, the sign-in form asks for the **company code**; tell each company's staff theirs.
`suspend` / an `expiry` date lock the whole company out immediately (sessions and sockets included).

## Rollback

- Code: the last pre-migration commit is **`e1cf0ae`** (legacy `admin/`, `api/`, `app/`, `shared/`).
  Redeploy it to restore the three legacy services.
- Data: the only schema change is the additive Phase 2 migration. The legacy API can run against the same
  database without a data rollback: its Prisma client ignores the extra column and table, and new users
  it creates get `tokenVersion` 0 from the column default. Records created in SalesGrid use the same
  tables and formats. Leave the column and table in place during a rollback.
- **Never run `prisma db push` from the legacy code** against production: it would drop `tokenVersion`,
  `uploaded_files`, the tenancy columns and the tracking-state columns, because they are not in the legacy schema.
- **Rolling back past the tenancy migration**: the `tenantId` columns keep a default (the default company),
  so old code can still insert rows, and the per-company unique keys are weaker than the old global ones.
  This is safe **only while a single company exists**. Once a second company has data, old code would
  mix companies; do not roll back past `2_multi_tenancy` then (restore from backup instead).
- If SalesGrid is redeployed after a rollback, tokens the legacy API issued count as version 0, so users
  who used "sign out everywhere" before the rollback must sign in again.
- `uploaded_files.uploadedById` references `users` (`ON DELETE RESTRICT`). Nothing in either codebase
  deletes users, but a manual delete of a user who uploaded files must remove their rows first.
- To drop the Phase 2 schema entirely (only once the legacy code is the permanent target), see the
  rollback statement at the top of the migration file.
- Other DB artifact: the `_prisma_migrations` table from baselining; the legacy API ignores it.

## Things to verify in production (cannot be verified from CI)

See `docs/DEVICE_TESTING.md` — real-device GPS behaviour, camera upload, and installed-PWA behaviour.
