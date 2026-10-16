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

**Multi-tenancy**: the data model has no tenant entity, so SalesGrid is single-tenant. Isolation between
users is role/team/ownership based as above.

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

- Uses the browser Geolocation API (`watchPosition`, high accuracy) only while on duty and while the app is
  open. Adaptive sampling as in the legacy app: every 15 s while moving, 60 s stationary, < 8 m jitter ignored.
- Points (with real accuracy/speed/heading, battery and network type **only when the browser reports them**)
  are buffered in `localStorage` per user and uploaded in batches; network failures keep them.
- The server validates coordinates, rejects far-future timestamps, and **flags** (never deletes or edits)
  implausible points (accuracy > 150 m, speed > 140 km/h). Flagged points are excluded from the live map,
  distance and route polylines. Gaps > 15 min split route segments and are shown as gaps.
- Permission denied / unsupported / no fix / stale fix are shown explicitly to the salesperson; admins see
  "Stale" when an on-duty salesperson has no fix in 10 minutes. Nothing is simulated.
- Browsers do not run geolocation in the background. The optional Screen Wake Lock keeps the device awake.
  (The legacy Expo app was foreground-only too.)

## Offline mode

`src/features/field/outbox.ts` queues START_DAY, END_DAY, VISIT_START/END, ORDER, PAYMENT and EXPENSE **only
when the request could not reach the server**. Validation and permission errors are shown immediately.
The queue syncs on reconnect, every minute while pending, and on demand; server-rejected items stay visible
with the server's reason until retried or discarded. A visit started offline is referenced by its local id;
the server resolves it through the stored idempotency key.

## Realtime

Same events, envelope and rooms as the legacy server (`user:`, `admins`, `managers`, `team:<spId>`,
`salesperson:<spId>`, plus `salespersons` for role broadcasts). Browser sockets authenticate with the
session cookie; same-origin is checked explicitly, cross-origin only for `CORS_ORIGINS`. If the socket is
down the UI keeps working through polling.

With `REDIS_URL` set, Socket.IO uses `@socket.io/redis-adapter`: an emit or `disconnectSockets()` on one
instance reaches matching sockets on all instances. API rate-limit counters move to Redis too (atomic
INCR + expiry). If Redis becomes unreachable, the rate limiter falls back to per-process counters rather
than rejecting requests, and `/api/health` reports `"redis": "down"`.

## Files

`POST /api/files/upload` checks the declared type against the file's bytes, stores the file under
`UPLOAD_DIR` and records the uploader in `uploaded_files`. `GET /api/files/<name>` serves a file only to:
a super admin; its uploader; or a user who can access a payment (`proofUrl`), visit
(`photoUrl`/`signatureUrl`/`voiceNoteUrl`) or expense (`receiptUrl`) referencing it (own records for
salespersons, team records for managers). Everyone else gets 404, so file names cannot be probed.
