# SalesGrid

Field sales, GPS tracking, orders, collections and expenses — **one Next.js application** serving the
admin console, the manager console, the mobile-first salesperson app, the REST API and the realtime
channel, from a single deployment.

It replaces the former `admin/` (Next.js), `app/` (Expo / React Native), `api/` (Express) and
`shared/` packages. The database schema and the API contracts are unchanged. See
[`docs/MIGRATION_AUDIT.md`](docs/MIGRATION_AUDIT.md) for what was migrated, what was fixed, and why.

| Who | Where | What |
|---|---|---|
| Super admin | `/dashboard` … | Everything, including settings and manager permissions |
| Manager | `/dashboard` … | Same console, limited to their team and to the permissions an admin grants |
| Salesperson | `/field` | Mobile-first app: start/end day, GPS, visits, orders, collections, expenses, offline sync |
| API clients | `/api/*` | REST API (Bearer token or session cookie). OpenAPI at `/api/docs` |

## Stack

Next.js 14 (App Router, TypeScript) · Prisma 5 + PostgreSQL · Socket.IO on a custom Node server ·
Tailwind CSS · Leaflet / OpenStreetMap · Recharts · Zod · Vitest · Playwright.

```
server.ts                  Custom server: Next.js + Socket.IO on one port
prisma/                    schema.prisma, migrations/ (0_init baseline + reviewed changes), seed.ts (dev/demo only)
src/app/(auth)/login       Unified login (password or access code), role-based redirect
src/app/(admin)/…          Admin & manager console pages
src/app/(salesperson)/field Salesperson app (mobile-first)
src/app/api/…              Route Handlers (thin: auth + parse + call a service)
src/features/*/service.ts  Business logic shared by API routes and the offline sync engine
src/features/field/        Browser GPS tracker, offline outbox, field context
src/lib/                   auth, permissions, db, http, realtime, time, domain (calculator, geo), validations
src/middleware.ts          Page redirects by role (UX only — the API authorizes every request itself)
tests/unit|integration|e2e Vitest unit, API-against-PostgreSQL integration, Playwright end-to-end
tests/multi-instance       Two production instances sharing PostgreSQL + Redis
```

## Local development

Prerequisites: Node.js 22, PostgreSQL 14+.

```bash
cp .env.example .env            # set DATABASE_URL and JWT_SECRET
npm ci
npm run db:migrate              # apply migrations to a NEW/empty database
npm run db:seed                 # optional demo data (refuses to run with NODE_ENV=production)
npm run dev                     # http://localhost:3000 (Next.js + Socket.IO)
```

Seeded demo accounts (password `Password123!`): `admin@erp.com`, `manager@erp.com`,
`rahul@erp.com` (or `EMP-001` / access code `RAHUL12345`), `ahmed@erp.com`, `vishal@erp.com`.
Set `SHOW_DEMO_LOGINS=true` to show quick-fill buttons on the login page.

> `npm run dev:next` runs plain `next dev` without the custom server: everything works except realtime
> push (pages fall back to polling).

## Database & migrations

- `prisma/migrations/0_init` is a baseline generated from the legacy schema and verified to produce a schema
  identical to the legacy `prisma db push`. `1_session_revocation_and_file_ownership` is the only change
  since: additive (`users.tokenVersion`, `uploaded_files`), reviewed, applied by `prisma migrate deploy`.
- **Existing database (created by `db push`)** — mark the baseline as applied once (no SQL is executed),
  then apply the later migrations:
  ```bash
  npm run db:baseline            # prisma migrate resolve --applied 0_init
  npm run db:migrate             # prisma migrate deploy
  ```
- **New database**: `npm run db:migrate` (`prisma migrate deploy`).
- Future schema changes: `npm run db:migrate:dev -- --name <change>` locally, review the SQL, commit, and
  deploy with `prisma migrate deploy`. Never use `db push` or `migrate reset` against production.

## Testing

```bash
npm run typecheck
npm run lint
npm run test:unit               # pure business logic (calculator, geo, timezone, permissions, http helpers)
npm run test:integration        # starts the real server against a disposable *_test database
npm run test:e2e                # builds for production, then Playwright (desktop console + mobile field app)
npm run build && npm run test:multi-instance   # two instances + Redis (needs redis-server or TEST_REDIS_URL)
```

Integration and E2E tests **reset** the database in `TEST_DATABASE_URL`
(default `postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test`) and refuse to run unless its
name ends in `_test`. Results of the last full run: [`docs/VERIFICATION_REPORT.md`](docs/VERIFICATION_REPORT.md).

## Deployment

One service, one build, one start command. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for Render,
Docker and PM2 instructions, the cut-over and rollback plan, and environment variables.

```bash
npm ci && npm run build          # prisma generate + next build
npx prisma migrate deploy
npm start                        # NODE_ENV=production tsx server.ts
```

Health check: `GET /api/health` (checks the database; reports whether realtime is active and, when
`REDIS_URL` is set, whether Redis is reachable). One instance needs nothing else; for several instances
set `REDIS_URL` and share `UPLOAD_DIR` (see DEPLOYMENT.md).

## Documentation

- [`docs/MIGRATION_AUDIT.md`](docs/MIGRATION_AUDIT.md) — audit, endpoint map, defects fixed, checklist
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — request flow, auth, roles, ledger, sync, GPS, realtime
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — environments, cut-over, rollback, scaling constraints
- [`docs/VERIFICATION_REPORT.md`](docs/VERIFICATION_REPORT.md) — feature-by-feature test evidence
- [`docs/DEVICE_TESTING.md`](docs/DEVICE_TESTING.md) — checks that need a real phone and a real road
- [`docs/api_reference.md`](docs/api_reference.md) — endpoint reference (also `/api/docs`)
