# SalesGrid — Phase 1 Audit & Migration Checklist

Audit of commit `e1cf0ae` (pre-migration). Everything below was found by reading the source,
not inferred from the README or `docs/requirements_checklist.md` (several of whose claims are
inaccurate — see §6).

## 1. What actually exists

| Directory | Stack | Role |
|---|---|---|
| `api/` | Express 4, Prisma 5, PostgreSQL, Socket.IO 4, JWT (`jsonwebtoken`), bcryptjs, multer, pdfkit, zod | REST API (19 routers), realtime, uploads, PDF receipts, CSV exports |
| `admin/` | Next.js 14 (App Router, all client components), Tailwind, Recharts, Leaflet, socket.io-client | Admin **and** manager console. `/api/*` proxied to Express via `rewrites` |
| `app/` | Expo 51 / React Native 0.74 + react-native-web | Salesperson app (6 screens, state-switched tabs, no router) |
| `shared/` | TS + zod | Constants, schemas, geo, order calculator. **Copied verbatim** into `api/src/shared`, `admin/src/shared`, `app/src/shared` (all four copies byte-identical) |

The task brief's `admin-web/`, `sales-app/`, `server/` map to `admin/`, `app/`, `api/`.

### Not present in the codebase (not invented by the migration)
- **Multi-tenancy** — no `Tenant` model, no tenant column on any table. The system is single-tenant.
  Isolation that *does* exist: role + manager-team scoping (`ManagerSalesperson`) + salesperson
  ownership. The migration hardens that scoping (§4) rather than inventing tenants.
- **Leads, Targets, Territories (as entities), Subscriptions/Billing, Payments gateway, Webhooks,
  Scheduled jobs, Password recovery, Email invitations.** `territory` is a free-text string on
  `Salesperson`. The closest thing to invitations is the admin-issued **access code** login, which is preserved.
- **shadcn/ui** — not installed. The existing Tailwind token design system is kept.
- **Prisma migrations** — none; the project used `prisma db push`. A baseline migration is generated from the unchanged schema (§5).
- **Native background GPS** — `app/` requests background permission but never registers a
  background task (no `expo-task-manager`). Tracking was a foreground `setTimeout` loop, so browser
  Geolocation is functionally equivalent.

## 2. Data model (16 models, unchanged by this migration)
User, ManagerSalesperson, ManagerPermission, Salesperson, Client, ClientAssignment, Category, Product,
Order, OrderItem, Payment, ClientLedgerEntry, Attendance, LocationSession, LocationPoint, ClientVisit,
AuditLog, Notification, IdempotencyKey, SystemSetting, UserAccessCode, Expense, ExpenseHistory.

Roles: `SUPER_ADMIN`, `MANAGER` (12 boolean permissions in `ManagerPermission`), `SALESPERSON`.

System settings read by business logic: `visit_radius_meters`, `manager_order_approval_required`,
`cash_verification_required` (plus `tracking_interval_seconds`, `business_timezone` stored for display).

## 3. Endpoint inventory → new implementation

All paths, methods, request bodies and response shapes are preserved. "Fix" = defect corrected (see §4).

| Legacy endpoint | Auth (legacy) | New route handler | Notes |
|---|---|---|---|
| GET `/health`, `/api/health` | none | `app/api/health`, `app/health` | |
| POST `/api/auth/login` | rate-limited | `api/auth/login` | + sets httpOnly session cookie |
| POST `/api/auth/access-code-login` | rate-limited | `api/auth/access-code-login` | + cookie; lockout logic preserved |
| POST `/api/auth/logout` | token | `api/auth/logout` | + clears cookie |
| GET `/api/auth/me` | token | `api/auth/me` | |
| — | — | POST `api/auth/refresh` (new) | sliding session renewal |
| GET/POST `/api/access-codes`, `/generate`, `/revoke` | admin, manager | `api/access-codes/**` | manager team check preserved |
| GET/POST `/api/salespersons` | any / admin+mgr | `api/salespersons` | Fix: POST requires `canManageUsers` for managers, manager can only assign to self |
| GET `/api/salespersons/live-status` | any | same | Fix: no fabricated `'4G'` / speed `0` |
| GET `/api/salespersons/dashboard` | any | same | Fix: `?salespersonId` honoured only within caller's scope |
| GET `/api/salespersons/:id/performance` | scoped | same | |
| GET/POST `/api/clients`, GET `/:id`, POST `/:id/assign` | scoped / admin+mgr | `api/clients/**` | Fix: manager permission + team checks on create/assign |
| GET/POST `/api/products`, GET `/:id`, GET/POST `/meta/categories` | any / admin+mgr | `api/products/**` | Fix: `canManageProducts` enforced |
| GET/POST `/api/orders`, GET `/:id`, PUT `/:id/status` | scoped / admin+mgr | `api/orders/**` | Fix: query scoping, invoiced-state ledger logic, `canApproveOrders` |
| GET/POST `/api/payments`, GET `/:id`, `/:id/receipt-pdf`, POST `/:id/verify` | scoped | `api/payments/**` | Fix: receipt scoping, verify only PENDING, `canVerifyPayments` |
| POST `/api/attendance/start`, `/end`, GET `/today`, `/history` | salesperson / scoped | `api/attendance/**` | Fix: history query scoping, business-timezone dates |
| POST `/api/location/update` + `/batch`, GET `/current`, `/history` | salesperson / scoped | `api/location/**` | Fix: only active assignments on `/current`; `canViewGps` |
| GET `/api/visits`, POST `/start`, `/:id/end` | scoped / salesperson | `api/visits/**` | Fix: query scoping; only owner can end visit |
| GET `/api/reports/{sales,collections,attendance,visits,product-sales}` (+`format=csv`) | any | `api/reports/[type]` | Fix: product-sales was unscoped; `canViewReports`/`canExportReports` |
| POST `/api/sync/batch` | salesperson | `api/sync/batch` | Fix: delegates to the same services as online endpoints (see §4) |
| GET/PUT `/api/settings`, GET `/permissions`, PUT `/permissions/:userId` | any / admin | `api/settings/**` | Fix: permission body whitelisted |
| GET `/api/audit-logs` | admin, manager | `api/audit-logs` | preserved |
| GET `/api/notifications`, PUT `/:id/read`, PUT `/read-all` | any | `api/notifications/**` | Fix: `/:id/read` limited to caller's notifications |
| POST `/api/files/upload`, GET `/api/files/:filename` | any | `api/files/**` | disk storage under `UPLOAD_DIR` preserved |
| GET `/api/expenses`, `/:id`, POST, PUT `/:id`, POST `/:id/{submit,approve,reject,reimburse}` | scoped | `api/expenses/**` | Fix: reimburse team check for managers |
| GET `/api/dashboard/summary` | scoped | `api/dashboard/summary` | Fix: clients/outstanding/top products scoped for managers |
| GET `/api/docs` | none | `api/docs` | OpenAPI JSON + Swagger UI |
| Socket.IO (`/socket.io`) | JWT | `server.ts` custom server, same events & rooms | + cookie auth |

## 4. Defects found (and fixed during migration)

### Authorization / data isolation
1. **Scope bypass via query param** — `GET /orders|/payments|/visits|/attendance/history|/reports/*` and
   `/salespersons/dashboard` accepted `?salespersonId=` and *replaced* the caller's scope with it.
   A salesperson could read any colleague's orders, payments, visits and attendance.
2. `GET /payments/:id/receipt-pdf` had no scope check (any logged-in user could download any receipt).
3. `GET /reports/product-sales` ignored role scoping entirely.
4. `GET /dashboard/summary` returned global client count, global outstanding and global top products to managers.
5. Manager permissions (`ManagerPermission`) were stored and editable in Settings but **never enforced**.
6. `PUT /settings/permissions/:userId` passed the raw body into Prisma (mass assignment).
7. `PUT /notifications/:id/read` let any user mark any notification.
8. `POST /visits/:id/end` let any manager/admin end any visit; sync `VISIT_END` had no ownership check at all.
9. Managers could reimburse expenses outside their team; assign clients/orders to salespersons outside their team.
10. Admin console allowed salesperson logins (same UI, broken scoping).

### Business-logic / data-integrity
11. **Offline sync bypassed business rules**: sync `ORDER` used its own arithmetic (ignored item/order discount
    allocation from `calculateOrderTotals`), ignored `manager_order_approval_required`, never decremented stock,
    and was not transactional. Sync `PAYMENT` ignored `cash_verification_required`. Sync `END_DAY` was
    silently reported `SYNCED` without doing anything (no handler).
12. **Ledger race** — running balance computed from a `currentOutstanding` read *outside* the transaction;
    concurrent order/payment posts could corrupt the balance.
13. **Order status transitions**: cancelling a `PROCESSING`/`DISPATCHED`/`DELIVERED` order did not restore stock
    or reverse the invoice; moving `PROCESSING → CONFIRMED` posted a **second** invoice.
14. **Payment verify** allowed `VERIFIED → REJECTED` without reversing the ledger credit (UI only offers
    verify/reject for `PENDING`).
15. Order/receipt/expense numbers from `count()+1` collide under concurrency (unique-violation 500s).
16. "Today" boundaries used server-local midnight; wrong on a UTC host for an `Asia/Kolkata` business
    (and `@db.Date` attendance dates shifted a day on an IST host).
17. Seed script unconditionally `deleteMany`-ed **all** expenses — destructive against production.

### Frontend
18. Sidebar badges `3` and `2` were hard-coded (fabricated counts). Live status showed fabricated `'4G'`.
19. Mobile expense "Capture / Upload Receipt" attached a fixed Unsplash stock photo URL instead of uploading.
20. Mobile offline fallbacks caught **all** errors (including 400 validation and 403) and reported success
    after queueing — e.g. an invalid order showed "Queued Offline".
21. Offline-submitted expenses were saved as `DRAFT` (`isSubmit` sent instead of `status`).
22. Attendance history read `startTime/endTime/totalHours` — fields the API never returns (always "N/A").
23. Mobile visit radius hard-coded at 100 m instead of the `visit_radius_meters` setting; GPS accuracy
    defaulted to a fabricated `10` m when unknown.
24. Login screen pre-filled real seeded passwords.
25. Socket toast used `order.totalAmount` (undefined; field is `grandTotal`).

### Found while porting and testing the UI (also fixed)
26. Notifications: role broadcasts matched by role only, so every salesperson saw notifications addressed to
    *other* salespersons (`recipientId` + role `SALESPERSON`).
27. Admin console read fields the API never returned: **Sales Force** page (blank names/contacts,
    "0 Accounts", empty duty status), **Access Codes** (blank names, "N/A" codes), **Expenses** ("Staff Member"
    for everyone, KPI cards always ₹0, search ignored by the API), **Performance** (always ₹0 / 0 orders;
    "All Time" unsupported by the API; "new clients added" had no data source), **Products** (every category
    "General"), **Assignments** ("Default Seed" instead of the assignment date).
28. **Route History** read `points` but the API returns `segments`/`rawPoints`: the map always said
    "No GPS points recorded"; visit distance always showed "0m"; payment mode blank.
29. Live map: socket updates never moved markers (wrong envelope shape); every marker shown as live/pulsing
    regardless of age; speed shown as 0 when unknown; hydration mismatch from a server-rendered clock.
30. Admin "New Order" / "Record Collection" wizards never sent `salespersonId`, so they always failed for
    admins; `Date.now()` idempotency keys made double-clicks create duplicates.
31. Order approval UI had no Reject/Cancel even though the API and statuses support them.
32. Sidebar filter links (`?status=`) were ignored or only read on first render.
33. Revoke-access-code dialog claimed it "terminates all active sessions immediately" — it never did.
34. Socket.IO rejected **same-origin** browsers in production (CORS callback allowed only listed origins).
35. Deploy blockers: `.npmrc legacy-peer-deps` (for the Expo app) made `npm ci` fail in clean builds.

## 5. Database
- Schema preserved exactly (no model, column, or index changes).
- `prisma/migrations/0_init` is a **baseline** generated from the schema. Existing databases created with
  `db push` mark it applied with `prisma migrate resolve --applied 0_init` (no DDL runs). New databases run
  `prisma migrate deploy`.
- The seed refuses to run when `NODE_ENV=production` unless `ALLOW_PRODUCTION_SEED=true`, and only deletes
  the expense rows it created itself.

## 6. Inaccurate claims in legacy docs
`requirements_checklist.md` claims background GPS tasks (none), shadcn/ui (absent), "every list endpoint
enforces limit (max 100)" (only expenses did), territory/geofence models (absent), 5-tab nav with Collect
and Profile (actual: Home/Clients/Orders/Expenses/More). Replaced by `docs/VERIFICATION_REPORT.md`.

## 7. Migration checklist

Legend: ✅ done and verified by automated tests · 🟡 done, partially verified (reason given) · ⛔ not applicable / blocked

| # | Item | Status |
|---|---|---|
| 1 | Audit + checklist (this file) | ✅ |
| 2 | Single Next.js 14 App Router app at repo root, TypeScript strict | ✅ build + typecheck |
| 3 | Prisma schema moved to `prisma/`, baseline migration | ✅ diffed against `db push` (identical) |
| 4 | Shared domain code de-duplicated into `src/lib` (one copy instead of four) | ✅ |
| 5 | Unified auth: httpOnly cookie **and** Bearer (contract preserved), role redirects, refresh, logout | ✅ I + E |
| 6 | All endpoints in §3 ported as Route Handlers backed by `src/features/*/service.ts` | ✅ I |
| 7 | Socket.IO realtime preserved via custom `server.ts` (same events/rooms) | ✅ I (event delivery), E (no socket errors) |
| 8 | Admin/manager console pages ported, permission-aware nav, data mismatches fixed | ✅ E |
| 9 | Salesperson mobile-first web UI at `/field/*` (all 6 legacy screens + catalogue) | ✅ E (Pixel 7 profile) |
| 10 | Browser GPS tracking, buffered upload, permission/denied/stale states | 🟡 E with emulated geolocation; real-device checks in `DEVICE_TESTING.md` |
| 11 | Offline outbox → `/api/sync/batch` using shared services | ✅ I + E |
| 12 | Defects §4 fixed | ✅ |
| 13 | Unit tests | ✅ 20 |
| 14 | API integration tests against real PostgreSQL | ✅ 72 |
| 15 | Playwright E2E per role on a production build | ✅ 22 |
| 16 | Single deployment: Docker image, Render blueprint, PM2 | 🟡 Docker image built and run locally; Render not deployed from here |
| 17 | Legacy `admin/`, `api/`, `app/`, `shared/` removed; rollback = commit `e1cf0ae` | ✅ |
| 18 | Multi-tenant isolation | ⛔ no tenant concept exists; role/team isolation hardened and tested instead |
| 19 | Leads, targets, territory entities, subscriptions/billing, password reset e-mail, invitations | ⛔ not in the legacy system; not invented (access codes remain the admin-issued credential path) |
| 20 | Native background GPS (app closed / screen locked) | ⛔ impossible in browsers; legacy app was foreground-only too. Wake Lock offered. |

## 8. Removed legacy files and services

| Removed | Replaced by |
|---|---|
| `api/` (Express server, routes, middleware, socket, seed, tests) | `src/app/api/**`, `src/features/**`, `src/lib/**`, `server.ts`, `prisma/seed.ts`, `tests/integration` |
| `admin/` (Next.js admin) | `src/app/(admin)/**`, `src/components/**` |
| `app/` (Expo / React Native salesperson app) | `src/app/(salesperson)/field/**`, `src/features/field/**` |
| `shared/` + 3 copies in `api/src/shared`, `admin/src/shared`, `app/src/shared` | `src/lib/domain`, `src/lib/validations` |
| `.npmrc` (`legacy-peer-deps`) | not needed |
| `docs/architecture.md`, `deployment_and_operations.md`, `independent_deployment_guide.md`, `mobile_device_testing_checklist.md`, `requirements_checklist.md` | `docs/ARCHITECTURE.md`, `DEPLOYMENT.md`, `DEVICE_TESTING.md`, `VERIFICATION_REPORT.md`, this file |
| Render services `salesperson-erp-api`, `salesperson-erp-admin`, `salesperson-erp-app` | one `salesgrid` web service (`render.yaml`) |
| Env vars `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`, `API_URL`, `EXPO_PUBLIC_API_URL`, `APP_SECRET`, `TOKEN_EXPIRY` | same-origin; `JWT_SECRET` |

## 9. Known limitations and remaining tasks

1. ~~Session revocation~~ — **done in Phase 2**: reviewed additive migration adds `users.tokenVersion`;
   "sign out of all devices" (console sidebar, field profile), admin/manager "Sign out" per salesperson,
   and "also sign out everywhere" when revoking an access code. Deactivation still ends sessions immediately.
   There is still no UI/endpoint to deactivate users or reset passwords (none existed before).
2. ~~Single instance~~ — **Phase 2**: optional `REDIS_URL` shares Socket.IO events and rate limits across
   instances (tested with two instances). Uploads remain local files: instances must share `UPLOAD_DIR`.
3. **Background GPS**: browsers stop geolocation when the app is backgrounded/locked; gaps are shown, not filled.
   The Capacitor Android app (`apps/mobile`) adds a native foreground-service tracker, implemented and
   compiled in CI but **not yet verified on a physical device** (`docs/DEVICE_TESTING.md`).
   Multi-company support was added afterwards: see `docs/FULL_SYSTEM_AUDIT.md`.
4. **Stock can go negative** — preserved legacy rule (orders are not blocked by stock); the UI warns.
5. **Audit logs** are visible to managers company-wide (legacy permission, preserved).
6. Lint warnings (`exhaustive-deps`) remain in ported console pages; behaviour is intentional and tested.
7. ~~Uploaded files readable by any signed-in user~~ — **Phase 2**: new `uploaded_files` table records the
   uploader; a file opens only for super admins, its uploader, and users who can access a payment, visit or
   expense referencing it. Pre-existing files (no row) open through their referencing record only.
8. ~~`?token=` query authentication~~ — **Phase 2**: off by default; `ALLOW_QUERY_TOKEN=true` restores it for
   an old client during rollout. The UI never used it.
9. The seed contains demo data only; it refuses to run in production without `ALLOW_PRODUCTION_SEED=true`.
10. Real-device verification (`docs/DEVICE_TESTING.md`) and the production cut-over (`docs/DEPLOYMENT.md`) are
   still to be done by the team.
