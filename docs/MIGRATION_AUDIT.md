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

Legend: ✅ verified by test · 🟡 implemented, manually verified only · ⛔ blocked/not applicable

| # | Item | Status |
|---|---|---|
| 1 | Audit + checklist (this file) | ✅ |
| 2 | Single Next.js 14 App Router app at repo root, TypeScript strict | ✅ |
| 3 | Prisma schema moved to `prisma/`, baseline migration | ✅ |
| 4 | Shared domain code de-duplicated into `src/lib` (one copy) | ✅ |
| 5 | Unified auth: JWT in httpOnly cookie **and** Bearer (API contract preserved), middleware redirects | ✅ |
| 6 | All endpoints in §3 ported as Route Handlers backed by `src/features/*/service.ts` | ✅ |
| 7 | Socket.IO realtime preserved via custom `server.ts` (same events/rooms) | ✅ |
| 8 | Admin/manager console pages ported with permission-aware nav | ✅ |
| 9 | Salesperson mobile-first web UI at `/field/*` (all 6 legacy screens) | ✅ |
| 10 | Browser GPS tracking, buffered upload, permission/denied/stale states | 🟡 (no real device in CI; tested with Playwright geolocation emulation) |
| 11 | Offline outbox → `/api/sync/batch` using shared services | ✅ |
| 12 | Defects §4 fixed | ✅ |
| 13 | Unit tests (calculator, geo, timezone, permissions) | ✅ |
| 14 | API integration tests against real PostgreSQL | ✅ |
| 15 | Playwright E2E per role | ✅ |
| 16 | Single deployment (Render web service / Docker), env docs | 🟡 (config validated by build; not deployed from this session) |
| 17 | Legacy `admin/`, `api/`, `app/`, `shared/` removed; rollback = commit `e1cf0ae` | ✅ |
| 18 | Multi-tenant isolation | ⛔ no tenant concept exists; role/team isolation hardened instead |
| 19 | Leads, targets, territories entities, subscriptions, password recovery, invitations | ⛔ not present in legacy system; not invented |
| 20 | Native background GPS (app closed / screen off) | ⛔ not possible in a browser; legacy app did not implement it either |
