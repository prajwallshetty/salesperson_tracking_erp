# SalesGrid — Verification Report

Run date: 2026-10-16 · Commit: see `git log` (branch `claude/salesgrid-nextjs-migration-xcnkmr`)
Environment: Node 22, PostgreSQL 16 (local), Chromium 141 via Playwright 1.56.1.

## Summary

| Check | Result | Evidence |
|---|---|---|
| TypeScript (`tsc --noEmit`, strict) | ✅ 0 errors | `npm run typecheck` |
| Lint (`next lint`) | ✅ 0 errors, 20 warnings | all warnings are `react-hooks/exhaustive-deps` in ported legacy console pages |
| Production build (`next build`) | ✅ | 57 API route handlers (+ `/health` alias), 31 pages, middleware |
| Unit tests | ✅ 20 / 20 | `tests/unit` (5 files) |
| API integration tests (real PostgreSQL, real server) | ✅ 72 / 72 | `tests/integration` (9 files) |
| End-to-end (production build, Playwright) | ✅ 22 / 22 | `tests/e2e` — desktop console + Pixel 7 field app |
| Baseline migration ≡ legacy `db push` schema | ✅ | `prisma migrate diff` between both databases: empty |
| Docker image build + run | ✅ (with sandbox caveat) | Image built; container applied migrations to an empty DB, `/api/health` healthy, Docker HEALTHCHECK healthy, cookie session accepted by middleware with runtime `JWT_SECRET`, seed refused in production. Sandbox build used `node:22-bookworm` instead of `-slim` because the sandbox proxy blocks plain-HTTP Debian mirrors (`apt-get`). |
| Render deployment | ⏸ not performed | No Render access from this environment; `render.yaml` reviewed only. |
| Real-device GPS / camera / installed PWA | ⏸ not performed | Emulated geolocation only. See `docs/DEVICE_TESTING.md`. |

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
| Config validation | Insecure/placeholder `JWT_SECRET` rejected in production; `check:env` checks DB and migration state | M |

## Not verified here (and why)

| Item | Reason | Next step |
|---|---|---|
| Real-device GPS accuracy, background/lock-screen gaps, Wake Lock | Needs physical device | `docs/DEVICE_TESTING.md` |
| Map tiles | OpenStreetMap tiles blocked by this sandbox's network policy (map container renders grey) | Check once deployed |
| Production deployment, DNS, TLS, Render disk | No deployment access | Follow `docs/DEPLOYMENT.md` cut-over |
| Load beyond test scale (thousands of reps) | Out of scope for this run | Load test `/api/location/batch` and dashboards |
