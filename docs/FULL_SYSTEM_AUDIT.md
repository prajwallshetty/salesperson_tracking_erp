# SalesGrid — full-system audit, fixes and verification

Scope of this round: multi-company isolation, access-code sign-in, quick access, GPS and route tracking,
real-time synchronisation and the Android app. The complete list of pages, endpoints and data models is
generated from the code in [`INVENTORY.md`](INVENTORY.md) (`npm run inventory`; a test fails if it goes stale).
Older audits: [`MIGRATION_AUDIT.md`](MIGRATION_AUDIT.md) (consolidation), [`VERIFICATION_REPORT.md`](VERIFICATION_REPORT.md) (test evidence).

## 1. What the request assumed, and what the repository actually contained

| The request described… | Reality when inspected | What was done |
|---|---|---|
| A multi-tenant SaaS with tenant management and subscriptions | **No tenant concept existed**: one company, no `tenantId` anywhere, global unique emails/phones/SKUs/employee codes, process-wide socket rooms | Built it: company table, `tenantId` on 18 tables, per-company unique keys, a tenant-scoped database client that fails closed, tenant-scoped realtime, company-aware sign-in, suspension/expiry. Existing data moves into a default company. |
| Subscription and billing flows "where implemented" | None implemented | Only what isolation needs: a company is `ACTIVE`/`SUSPENDED` with an optional end date, enforced at sign-in, on every API call and on sockets. **No billing, plans or payments.** |
| Customer **and lead** CRUD, targets | Customers (clients) yes. **Leads and targets do not exist** in the schema, API or UI | Not built (would be new product modules, not repairs). Listed in §5. |
| Admin dashboard, salesperson app, backend as separate projects | Already consolidated into one Next.js app in an earlier round | Kept. |
| Access-code login | Existed: admin-issued bcrypt-hashed codes, 5-attempt lockout, expiry, revocation | Hardened and made company-aware (§3). |
| GPS pipeline / route history | Existed (web foreground tracking, route history) with the defects in §3 | Repaired; added native Android background tracking. |
| Real-time sync | Socket.IO existed for orders/payments/expenses/attendance/location | Extended and made tenant-safe (§3). |
| "Salesperson **and manager** management" | Salespersons can be created; **there is no way to create managers, deactivate users or reset passwords** (pre-existing; noted since the first audit) | Not added: needs a product decision on its UX. Listed in §5. |
| Capacitor Android app | Did not exist | `apps/mobile` (hosted mode), built in CI (§4). |

## 2. Module checklist — status and evidence

"Evidence" names the automated suite that exercises it against the real server and PostgreSQL
(I = integration, E = browser end-to-end, U = unit). **Nothing here was run on a physical Android phone.**

| Module | Status | Evidence |
|---|---|---|
| Sign-in: password, company code, remember me, quick access, dev quick login (off in production) | ✅ | I `auth`, `quickAccess`, `tenancy`; E `quick-access`, `console` |
| Access codes: issue / hand over / expiry / revocation / lockout / cross-company | ✅ | I `accessCodes`, `tenancy`; U `loginTenant` |
| Sessions: logout, sign out everywhere, revoke by admin/manager, deactivated/suspended users | ✅ | I `sessions`, `tenancy`; E `console` |
| Company isolation (data, files, settings, audit logs, reports, numbering, idempotency, sockets) | ✅ | I `tenancy` (15), U `tenancy`, `tenancy-guard` |
| Roles and manager permissions | ✅ | I `authorization`; E manager/salesperson specs |
| Clients, assignments, history | ✅ | I `workflows`, `tenancy`, `realtime-sync` |
| Products and categories | ✅ | I `workflows`, `tenancy`; E products page |
| Orders (GST maths, stock, ledger, approval, idempotency, concurrency) | ✅ | I `workflows`, `concurrency`; U calculator |
| Collections and receipts | ✅ | I `workflows`; E verify flow |
| Expenses | ✅ | I `expenses`; E approval flow |
| Attendance, visits | ✅ | I `workflows`, `gps`; E field spec |
| Offline queue and sync | ✅ | I `sync`; E offline order |
| GPS ingest, live status, route history, retention | ✅ server | I `gps` (14); U `tracking` |
| Admin live map and route pages (honest states, per-shift summaries) | ✅ | E `realtime-live` |
| Real-time sync incl. reconnect recovery | ✅ | I `realtime-sync` (6), `tenancy`; E `realtime-live` |
| Reports, dashboards | ✅ | I `reports`, `tenancy` |
| Files and documents | ✅ | I `files`, `tenancy` |
| Navigation: all 31 pages render, no dead sidebar link, no 5xx or console errors | ✅ | E `console`, field spec; sidebar hrefs checked against pages |
| Mobile layout (360 px) | ✅ | E mobile project |
| Android shell: project, plugins, manifest, icons, offline page, back/lock/update logic | ✅ builds in CI | GitHub Actions run #4; U `native` |
| **Android background GPS, foreground-service notification, permissions, biometric, share-sheet documents, camera, push** | ⛔ **not verified on a device** | needs a phone: `DEVICE_TESTING.md` |

## 3. Defects found and fixed in this round

**Isolation and sign-in**
1. There was no company boundary at all (see §1).
2. A super admin could open **any** uploaded file by name (found by the isolation test; files share one directory). Now checked against the company's records.
3. Socket rooms `admins` / `managers` / `salespersons` were process-wide, and a super admin could subscribe to any `team:*` room: company A would have received company B's events. Rooms are namespaced per company and subscriptions are authorised.
4. Access-code and password sign-in took an arbitrary user when an identifier matched several (e.g. one person's phone = another's employee code). Now refused and audited.
5. Unknown accounts answered faster than wrong passwords (account enumeration by timing). Equalised.
6. Only a per-IP throttle protected an account from guessing. Added a per-account throttle.
7. Revoking by user id revealed (404 vs 403) whether an out-of-team employee had an active code. Scope is checked first.
8. Idempotency keys, setting keys, document numbers and their advisory locks were global; now per company.
9. (Earlier this session) the login page shipped the seed passwords in its JavaScript in every build; removed.

**GPS and routes**
10. Jump detection compared points in **arrival** order and ignored the last stored point, so a re-ordered upload produced false "jumps" and real jumps across batches were missed.
11. One flagged point became the reference for the next, flagging a good fix.
12. A late, older point could be broadcast and move the live position backwards.
13. Route segments were built from flagged points, creating phantom segments (e.g. a point three hours earlier).
14. Distance bridged tracking gaps with straight lines and counted stationary drift. Now one documented method (`calculateRouteDistanceMeters`).
15. Route history had no per-shift information and joined two shifts into one line; sessions are now summarised and labelled *complete / in progress / incomplete*.
16. The console could not tell "permission denied" from "weak signal"; there was a client-side 10-minute rule that disagreed with the server, and every socket event displayed "Just now". One classification now (live ≤ 5 min / stale / unavailable / permission denied / GPS off / off duty), computed from the last real fix and the phone's own report, re-evaluated every 20 s.
17. No limit on points per request; ranges not validated. Capped at 500; accuracy/speed/heading bounded.
18. No retention control for location data. Opt-in `LOCATION_RETENTION_DAYS`.
19. (Found by the browser test) a slow fetch could overwrite a newer socket-delivered position on the live page.

**Real-time**
20. The expenses page listened for event names the server never sends, so it never live-refreshed.
21. Re-assigning a client notified only the new primary; the previous holder's phone kept the client.
22. A manager's open session did not receive a newly added team member's events until reconnecting.
23. Nothing reconciled after a reconnect, regaining network or returning to the app; events missed meanwhile were lost. Added a resync signal and per-event counters (simultaneous events can't mask each other).
24. No events for product, client, settings, team or permission changes.

**Build and Android**
25. Android CI failed twice (SDK setup action; TypeScript missing for `capacitor.config.ts`) — fixed; run #4 is green.
26. The foreground-service notification would have shown the full-colour launcher icon (a white blob in the status bar); a monochrome icon is provided. Unneeded boot receivers and the exact-alarm permission contributed by plugins are removed.

## 4. Android, in short

Hosted mode: the app is a thin shell around the deployed server (no UI is bundled), so web changes ship by deploying
the server. Details, environment variables, build/sign commands and "what needs a new APK" are in
[`MOBILE_ANDROID.md`](MOBILE_ANDROID.md). Background tracking uses a foreground service with a persistent
notification; the whole path is implemented and compiled in CI but **only a physical phone can verify it**.

## 5. Not done / open (honest list)

| Item | Why | Next step |
|---|---|---|
| Verification on a physical Android device (GPS in background, screen off, battery saver, camera, share sheet, biometric, back button) | No device or emulator reachable from this environment | Work through `DEVICE_TESTING.md` |
| Installable APK | CI builds it but does not publish one until a deployed **HTTPS server URL** is configured (`SALESGRID_SERVER_URL`); a signed release also needs your keystore secrets | `MOBILE_ANDROID.md` §4 |
| If Android kills the app process, tracking resumes only when the person reopens the app | Points are uploaded by the web layer; native HTTP upload would need the session token outside the cookie, and there is no push service | Accept, or add native upload with a scoped device token (design decision) |
| Push notifications while the app is closed | Needs a Firebase project and server-side sending; no module sends push today | Product/infra decision |
| Leads, targets, billing/plans | Do not exist in the product | Specify, then build as new modules |
| Creating managers, deactivating users, resetting passwords, self-service company sign-up | Never existed; company administration is a CLI for an operator | Specify the admin UX |
| Google Play: background-location declaration and review | Store policy step, not code | Complete before publishing to Play; the in-app disclosure is already shown |
| Load testing, real map tiles in this sandbox, a real multi-server deployment behind a load balancer | Not available here | Verify after deployment |
| An employee's access code can be locked by someone who knows the company code and employee code (5 wrong attempts) | Inherent to lock-out; mitigated by per-IP and per-account throttles and by admins re-issuing a code | Optional: lock per (code, source IP) |
