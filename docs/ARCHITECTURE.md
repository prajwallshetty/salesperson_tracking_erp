# SalesGrid — Architecture

## Request flow

```
Browser / API client
   │  cookie sg_session (browser) or Authorization: Bearer (API clients)
   ▼
server.ts (Node) ── Socket.IO (same port, cookie or token auth, room-scoped events)
   │
   ▼
Next.js
   ├─ src/middleware.ts       page redirects by role (UX only; signature check, no DB)
   ├─ (admin) / (salesperson) layouts: server-side session load → redirect if wrong role
   └─ src/app/api/**/route.ts authedRoute(): token → DB user → role / permission check → service
                                   │
                                   ▼
                     src/features/*/service.ts  (business rules, transactions)
                                   │
                                   ▼
                               Prisma → PostgreSQL
```

**One copy of the business logic.** Route Handlers parse input and call a service; the offline sync
engine calls the same services with the item's idempotency key. There is no business logic in Server
Actions or client components (the client only previews order totals with the same calculator module).

## Authentication

- Login (`/api/auth/login` password; `/api/auth/access-code-login` admin-issued code with 5-attempt lockout)
  returns the legacy `{ token, user, expiresIn }` body **and** sets an httpOnly, SameSite=Lax,
  Secure-in-production `sg_session` cookie containing the same JWT (`{ userId, role, tv }`, 7 days).
  `tv` is the user's session version (`users.tokenVersion`); legacy tokens without it count as 0.
- Every API request re-loads the user from the database: deactivated users are rejected immediately and
  role/team/permissions always come from the database, never from the token.
- `/api/auth/refresh` re-issues a token (sliding session) for tokens older than one hour.
- Logout clears the cookie on this device. **Sign out everywhere** (`POST /api/auth/logout-all`, or
  `POST /api/auth/sessions/revoke { userId }` by a super admin / the salesperson's manager, or
  `endSessions: true` when revoking an access code) increments `tokenVersion`: every older token fails on
  its next API call, page load or socket handshake, and the user's live sockets are disconnected.
  The same check (`resolveSessionToken`) runs for Route Handlers, layouts and Socket.IO.
- Token lookup: `Authorization: Bearer`, then the cookie. `?token=` is accepted only with
  `ALLOW_QUERY_TOKEN=true`.
- The edge middleware checks only the signature (no database). When a layout finds a signed but invalid
  session it redirects to `/api/auth/session-ended`, which clears the cookie and shows
  `/login?expired=1&next=<page>`. Redirecting straight to `/login` would loop through the middleware.

## Authorization model

| Role | Scope |
|---|---|
| SUPER_ADMIN | Everything. |
| MANAGER | Salespersons in `manager_salespersons` for this manager, and records belonging to them. The 12 `ManagerPermission` flags gate features (dashboard, users, products, clients, assignment, GPS, orders/approval, payments/verification, reports/export). Managers without a permission row get the schema defaults. |
| SALESPERSON | Own records; clients with an active assignment to them. |

`src/lib/permissions` is shared by server and UI; the UI hides what the server would refuse, but the
server enforces every rule regardless (`authedRoute({ roles, managerPermission })`, `scopedSalespersonFilter`,
`getAccessibleClient`, `assertSalespersonAccess`).

Roles, teams and ownership (above) apply **inside one company**; companies are isolated from each other as
described next.

## Companies (multi-tenancy)

SalesGrid hosts several companies in one database. Isolation is enforced in the data layer, not just in
route code:

- **Model**: `tenants` (company code, name, status `ACTIVE`/`SUSPENDED`, optional `activeUntil`).
  18 tables carry `tenantId` (users, salespersons, clients, categories, products, orders, payments,
  expenses, attendance, location sessions/points, visits, audit logs, notifications, idempotency keys,
  settings, access codes, uploaded files); child tables (order items, ledger entries, assignments,
  manager teams/permissions, expense history) are scoped through their parent. Unique keys that used to
  be global (email, phone, employee code, SKU, barcode, category name, order/receipt/expense numbers,
  offline and point ids, idempotency and setting keys) are unique **per company**. Existing data lives in
  the *default* company (migration `2_multi_tenancy`).
- **Where the company comes from**: the signed-in user's database row — never a header, query or body
  field. `authedRoute` runs the handler inside `runWithTenant(user.tenantId, …)`.
- **Enforcement**: all application code uses `prisma` from `src/lib/db`, a Prisma client extended by
  `src/lib/db/tenancy.ts`: reads, aggregates and bulk writes are restricted to the company; creates are
  stamped; an update cannot change `tenantId`; nested writes are stamped (or rejected); a query made
  **outside** a company context throws instead of returning every company's rows. Every model must be
  classified (a unit test fails for an unclassified model). Raw SQL (document numbering and its locks,
  ledger/order/payment row locks, dashboard series) filters on `tenantId` itself.
- **The unscoped client** `prismaRoot` exists only for code that works before a company is known or
  across companies (sign-in resolution, session loading, the tenant CLI, retention job, file-ownership
  check, dev quick login). `tests/unit/tenancy-guard.test.ts` lists the allowed files; anything else
  importing it fails the build.
- **Sign-in**: a company code selects the company (optional while only one company exists). Inside it,
  an identifier matching two people is refused. Unknown company, unknown user and wrong secret look
  the same (and take similar time); per-IP and per-account throttles apply.
- **Realtime**: role rooms are `admins:<tenant>`, `managers:<tenant>`, `salespersons:<tenant>`,
  `tenant:<tenant>`; per-person rooms use globally unique ids. Room subscriptions are authorised (a super
  admin can follow only salespersons of their own company, verified in the database).
- **Subscription rule**: a `SUSPENDED` company, or one past `activeUntil`, cannot sign in, use the API or
  keep a socket; the reason is revealed only after valid credentials. There is no billing — the status is
  changed by an operator (`npm run tenant -- suspend|activate|expiry`).
- **Administration**: no platform-wide role or HTTP API. Companies are created, renamed, suspended and
  re-coded with `npm run tenant`; each company's `SUPER_ADMIN` manages everything inside it.
- **Files**: one upload directory, per-company access: a file opens only for its uploader, a super admin
  of the owning company, or a user who can access a record of that company that references it.

## Money: orders, ledger, collections

- `calculateOrderTotals` (exact paise rounding, item discounts, order discount allocated proportionally,
  per-line GST) is the single implementation, used by the API, the sync engine and the UI preview.
- An order's invoice is posted when it enters an *invoiced* status (CONFIRMED, PROCESSING, DISPATCHED,
  DELIVERED) and reversed when it leaves it (CANCELLED/REJECTED/back to SUBMITTED). Stock moves with it.
- `postLedgerEntry` locks the client row (`SELECT … FOR UPDATE`) before computing the running balance.
- Collections start PENDING (unless `cash_verification_required=false` and method is CASH); only
  verification posts a ledger credit. Only PENDING collections can be verified or rejected.
- Document numbers (`ORD-YYYY-000001`, `PAY-YYYY-00001`, `EXP-YYYY-000001`) continue the legacy sequence and
  are assigned under a transaction-scoped advisory lock (plus unique-violation retry).
- Idempotency keys are stored inside the business transaction; concurrent duplicates replay the first response.

## Time

`DEFAULT_TIMEZONE` defines business days. "Today", report date ranges, attendance `date` values and
dashboard day buckets are computed in that timezone (`src/lib/time.ts`), independent of the server's TZ.

## GPS tracking (salesperson app)

- **Sources**: in the Android app a native foreground service (persistent notification) delivers fixes in the
  background; in a browser `watchPosition` delivers them while the page is open. Both feed one pipeline:
  adaptive sampling (15 s moving, 60 s stationary, < 8 m jitter ignored), a per-user buffer in
  `localStorage`, and authenticated batch uploads (`POST /api/location/batch`). Real accuracy, speed and
  heading are sent; battery and network type only when the device reports them; mock-location fixes are dropped.
- **Server ingest** (`src/features/tracking/service.ts`): identity and company come from the session. A
  batch is processed in **timestamp** order; each point is judged against the last *accepted* stored point
  (also across batches): accuracy > 150 m, an implied speed > 140 km/h, or a timestamp outside the shift's
  window flag the point (`isFiltered` + reason) — it is kept for audit but never shown, counted or broadcast.
  Duplicates (`clientPointId`) are stored once; invalid points are counted; a late older point never moves
  the live position backwards. Batches are capped at 500 points.
- **Device-reported state**: the phone tells the server `TRACKING`, `PERMISSION_DENIED`, `BACKGROUND_DENIED`
  (foreground only: browser, or notifications blocked on Android), `GPS_DISABLED` or `STOPPED`
  (`POST /api/location/status`, queued and retried when offline).
- **Live state** (`computeLiveState`): `live` (last real fix ≤ 5 min), `stale`, `unavailable` (no fix yet),
  `permission_denied` / `gps_disabled` (only while the report is newer than the last fix), `off_duty`.
  Nothing is extrapolated; the console re-evaluates every 20 s so a marker cannot stay "live" by itself.
- **Routes**: points belong to a *session* (one per shift) tied to an attendance record. Route history
  returns per-shift summaries (start, end, duration, points accepted/flagged, distance, quality
  *complete / in progress / incomplete*), the last known position, segments built from accepted fixes only
  and split at gaps (> 15 min) and shift boundaries.
- **Distance** (`calculateRouteDistanceMeters`): the sum of great-circle (Haversine) distances between
  consecutive accepted fixes, skipping steps with accuracy worse than 150 m, shorter than 5 m (drift),
  across a gap longer than 15 minutes (no straight line is assumed), implying more than 140 km/h, or longer
  than 50 km. It is an estimate from sampled fixes and under-counts travel inside a gap.
- **Stop rules**: End Day, sign-out, or the server answering "not on duty" stops the tracker (and the
  Android service). Points arriving for a closed shift are refused unless they come through the offline
  sync of that shift and fall inside its window.
- **Retention**: off by default. `LOCATION_RETENTION_DAYS` (≥ 7) deletes raw points older than that daily,
  with an audit record per company; sessions, attendance and stored distances are kept.
- **Limits**: browsers (and a phone that has killed the app) provide no background location; gaps are
  shown as gaps. See `MOBILE_ANDROID.md` §9 for the Android specifics.

## Offline mode

`src/features/field/outbox.ts` queues START_DAY, END_DAY, VISIT_START/END, ORDER, PAYMENT and EXPENSE **only
when the request could not reach the server**. Validation and permission errors are shown immediately.
The queue syncs on reconnect, every minute while pending, and on demand; server-rejected items stay visible
with the server's reason until retried or discarded. A visit started offline is referenced by its local id;
the server resolves it through the stored idempotency key.

## Realtime

Socket.IO on the same server. Browser sockets authenticate with the session cookie (same-origin checked
explicitly, cross-origin only for `CORS_ORIGINS`). Events, all scoped to the company of the change:

| Event | Delivered to |
|---|---|
| `location:update`, `tracking:state`, `attendance:changed`, `order:*`, `payment:*`, `expense:*`, `client:assigned` | the company's admins and the salesperson's team room (managers, the salesperson) |
| `product:changed`, `client:changed`, `settings:changed`, `team:changed` | everyone signed in to the company (clients refetch what they may see; payloads are ids only) |
| `permissions:changed` | that manager only |
| `notification:new` | the recipient, or the company's role room |

A client that was disconnected, offline or in the background **missed** events, so the web app keeps a
resync signal (socket reconnect, network returned, tab visible again after 20 s) and every live page
refetches on it (`useRealtimeRefresh`); pages also keep their own polling as a fallback. Per-event
counters mean simultaneous events cannot mask one another. A manager's open session joins a newly added
team member's room immediately. With `REDIS_URL`, events, rooms and forced disconnects work across
instances. When the socket is down the UI keeps working through polling.

## Files

`POST /api/files/upload` checks the declared type against the file's bytes, stores the file under
`UPLOAD_DIR` and records the uploader in `uploaded_files`. `GET /api/files/<name>` serves a file only to:
a super admin; its uploader; or a user who can access a payment (`proofUrl`), visit
(`photoUrl`/`signatureUrl`/`voiceNoteUrl`) or expense (`receiptUrl`) referencing it (own records for
salespersons, team records for managers). Everyone else gets 404, so file names cannot be probed.
