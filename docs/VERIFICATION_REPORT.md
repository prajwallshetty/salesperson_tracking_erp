# SalesGrid — Verification Report

Run date: 2026-10-17 (re-run after Quick Access + Android shell) · Commit: see `git log` (branch `claude/salesgrid-nextjs-migration-xcnkmr`)
Environment: Node 22, PostgreSQL 16 (local), Chromium 141 via Playwright 1.56.1.

## Summary

| Check | Result | Evidence |
|---|---|---|
| TypeScript (`tsc --noEmit`, strict) | ✅ 0 errors | `npm run typecheck` |
| Lint (`next lint`) | ✅ 0 errors, 20 warnings | all warnings are `react-hooks/exhaustive-deps` in ported legacy console pages |
| Production build (`next build`) | ✅ | 60 API route handlers (+ `/health` alias), 31 pages, middleware |
| Unit tests | ✅ 32 / 32 | `tests/unit` (7 files) |
| API integration tests (real PostgreSQL, real server) | ✅ 94 / 94 | `tests/integration` (11 files) |
| Multi-instance (2 production servers + Redis) | ✅ 5 / 5 | `tests/multi-instance` |
| End-to-end (production build, Playwright) | ✅ 29 / 29 | `tests/e2e` — desktop console + Pixel 7 field app |
| Baseline migration ≡ legacy `db push` schema | ✅ | `prisma migrate diff` between both databases: empty |
| Migrations ≡ `schema.prisma` (no drift) | ✅ | `prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code` → 0 |
| Phase 2 migration on a populated, baselined database | ✅ | dev database: `migrate deploy` applied `1_session_revocation_and_file_ownership`; row counts of users/orders/payments/ledger/expenses unchanged; all users `tokenVersion` 0; `check:env` OK afterwards (it reported the pending migration before) |
| Docker image build + run | ✅ (with sandbox caveat) | Image built; container applied migrations to an empty DB, `/api/health` healthy, Docker HEALTHCHECK healthy, cookie session accepted by middleware with runtime `JWT_SECRET`, seed refused in production. Sandbox build used `node:22-bookworm` instead of `-slim` because the sandbox proxy blocks plain-HTTP Debian mirrors (`apt-get`). |
| Render deployment | ⏸ not performed | No Render access from this environment; `render.yaml` reviewed only. |
| Real-device GPS / camera / installed PWA | ⏸ not performed | Emulated geolocation only. See `docs/DEVICE_TESTING.md`. |
| Android APK build | ⏸ not performed here | The Android SDK download host (`dl.google.com`) is blocked in this environment. Project generated with `cap add android`; plugins wired; build runs in `.github/workflows/android.yml`. |
| Android app on a physical device | ⏸ not performed | Checklist in `docs/MOBILE_ANDROID.md` §8. |
| Production bundle free of seed credentials | ✅ | `grep` of `.next/static` and `.next/server` for the seed password/access code: no match; integration test scans the login page and all its scripts |

## Feature-by-feature

Legend: **I** = integration test (HTTP against real server + DB assertions) · **E** = Playwright E2E ·
**U** = unit test · **M** = manual check during this run (screenshots / curl).

| Module | Verified behaviour | How |
|---|---|---|
| Auth — password | Login by email, phone, employee code; legacy `email` field; legacy response shape; httpOnly/SameSite cookie; generic error for bad user vs bad password | I, E |
| Auth — access code | Login; 5 failed attempts → 423 lock (even with the right code); regenerate unlocks; admin-generated code works in the UI | I, E |
| Sessions | Bearer and cookie both accepted; deactivated user rejected immediately (existing token → 401, login → 403); forged / expired tokens → 401; role in token ignored (DB is authority); logout clears cookie; refresh only for tokens > 1 h; expired session in UI redirects to login | I, E |
| Page protection | Anonymous → `/login?next=…`; salesperson ↛ console; admin/manager ↛ `/field`; manager ↛ `/settings` | I, E |
| Roles & team scope | Salesperson sees only assigned clients; manager sees only team; out-of-team performance, route history, dashboard, orders → 403/empty | I, E |
| Legacy scope bypass fixed | `?salespersonId=` on orders/payments/visits/attendance/4 reports cannot read colleagues' data | I |
| Manager permissions | `canViewGps`, `canViewReports`, `canExportReports` toggled live → 403 / 200; mass-assignment on permission update ignored | I |
| Clients | Create with opening-balance ledger entry; validation details; reassign keeps history (3 assignment rows, 2 active); salesperson cannot open/order/visit/collect for others' clients | I |
| Products & categories | Manager creates; duplicate SKU → 409; list/search; category names shown | I, E |
| Attendance | GPS rejected before Start Day; Start Day opens session; double start → 400; End Day summary from accepted points only; second shift same day merges (legacy crashed) | I, E |
| GPS ingest | Valid points stored; impossible jump flagged `IMPLAUSIBLE_SPEED_JUMP`; invalid lat → 400; live map shows last *accepted* fix; unreported network type stays null | I |
| Live map | Realtime `location:update` delivered to admin room; online/stale state; feed shows staleness | I, M |
| Route history | Segments, events, flagged-count, distance; admin route page now draws the route (legacy never did) | I, M |
| Visits | Distance computed server-side; within/outside radius exception with reason; double-complete → 400; outcome recorded from phone UI | I, E |
| Orders | 7,050 / 450 / 1,188 / **7,788** exact; stock deducted; invoice posted; idempotent replay returns same order; invalid items → useful 400; UI preview equals server total | U, I, E |
| Order workflow | PROCESSING→CONFIRMED doesn't double-post; cancel from DELIVERED restores stock and posts one reversal; approval-required setting → SUBMITTED then confirm posts invoice and records approver; salesperson notified | I |
| Collections | PENDING until verified; verification credits ledger exactly once; VERIFIED→REJECTED refused; receipt numbers `PAY-YYYY-NNNNN`; PDF receipt only for owner/admin; admin verifies from console | I, E |
| Expenses | Draft→submit→approve→reimburse with history; reject needs reason; edit+resubmit; locked after submit; out-of-team manager → 403; offlineId dedup; console approval with real names/KPIs | I, E |
| Offline sync | Whole offline day (start, GPS, visit start+end by local id, order, payment, expense, end) synced through the same services; replay creates nothing; per-item failure reporting; UI queues only on network failure and syncs on reconnect | I, E |
| Concurrency | 8 parallel orders → unique numbers, consistent running balances; 5 parallel same-key orders → 1 order; 4 parallel verifications → 1 ledger credit | I |
| Reports | 5 types JSON + CSV headers; date filter; totals = sum of rows; product-sales scoped | I |
| Files | Real PNG upload/download; disguised file rejected (content sniffing); disallowed type rejected; unauthenticated → 401; path traversal → 404 | I |
| Notifications | Private to recipient / role broadcast; cannot mark others' read | I |
| Console pages | All 17 pages render without console errors or 5xx; real data shown (names, counts, categories, KPIs); sidebar badges from DB; filters follow the URL | E, M |
| Responsive | No horizontal overflow at 360 px on all 17 console pages and 12 field pages; console drawer on phones | E, M |
| Field app | Login → home; Start Day with GPS; visit; order; collection + receipt; expense; offline order; route; End Day summary; attendance history; denied-permission flow | E |
| Config validation | Insecure/placeholder `JWT_SECRET` rejected in production; `check:env` checks DB, unapplied migrations and Redis | M |
| **Phase 2** — sign out everywhere | Self (console sidebar, field profile), admin/manager per salesperson, and on access-code revoke (`endSessions`); every older Bearer/cookie token → 401; refresh refused; live socket dropped and reconnect refused; scope: manager only for own team, salesperson for nobody else; audit row written; new login works | I, E |
| **Phase 2** — legacy tokens | Token in the exact legacy shape `{ userId, role }` accepted while `tokenVersion` is 0 | U, I |
| **Phase 2** — revoked session on pages | Layout → `/api/auth/session-ended` → cookie cleared → `/login?expired=1&next=<page>`; no redirect loop (also fixes the same loop for deactivated users); off-site `next` ignored | I, E |
| **Phase 2** — file authorization | Unattached upload: uploader + super admin only; attached to an expense: owner's manager can read, other salespersons 404; pre-existing file (no ownership row): super admin only unless referenced | I |
| **Phase 2** — `?token=` | Rejected by default on API and socket; `ALLOW_QUERY_TOKEN=true` restores it; receipt PDF opens with the cookie | U, I |
| **Quick access** — Remember me | Off: 12-hour token, session cookie (no Max-Age), kept on refresh; on: 7-day persistent cookie; omitted (API clients): legacy 7 days; works for access-code sign-in | U, I, E |
| **Quick access** — auto-open & sign-out | Valid session on `/login` or `/` opens `/dashboard` (admin/manager) or `/field` (salesperson); sign-out removes the cookie; only the sign-in name is remembered (no password/token in localStorage); *Not you?* forgets it | E |
| **Quick access** — dev quick login | Development + `DEV_QUICK_LOGIN=true`: lists active accounts without credential fields, issues a normal session, role permissions still enforced, deactivated users refused, audited; production build with the variable set: buttons hidden, endpoint 404 | U, I, E |
| **Android shell** — logic | Back button (close sheet → back → minimise on home screens), biometric lock timing, update-required gate | U |
| **Phase 2** — multi-instance | GPS fix posted to instance A reaches a dashboard socket on instance B; sign-out on A drops the socket on B; login rate limit counted across both; Redis killed → health 200 with `"redis": "down"`, logins still served | multi-instance |

## Not verified here (and why)

| Item | Reason | Next step |
|---|---|---|
| Real-device GPS accuracy, background/lock-screen gaps, Wake Lock | Needs physical device | `docs/DEVICE_TESTING.md` |
| Map tiles | OpenStreetMap tiles blocked by this sandbox's network policy (map container renders grey) | Check once deployed |
| Production deployment, DNS, TLS, Render disk | No deployment access | Follow `docs/DEPLOYMENT.md` cut-over |
| Load beyond test scale (thousands of reps) | Out of scope for this run | Load test `/api/location/batch` and dashboards |
| Multi-instance on real infrastructure (load balancer, managed Redis, shared `UPLOAD_DIR`) | Tested only as two local processes | Verify WebSocket upgrade through the balancer and shared storage before scaling out |
