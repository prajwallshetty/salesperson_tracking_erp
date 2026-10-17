# Real-Device Field Test Checklist

Automated tests run in Chromium with **emulated** geolocation and network conditions. These checks need a
real phone, real GPS and real movement, and have **not** been performed yet. Record date, device, browser
and result for each.

## Setup
- [ ] Open the production URL on Android Chrome and iOS Safari; sign in as a salesperson.
- [ ] "Add to Home Screen" works; the installed app opens at `/field`.

## Location permission
- [ ] First Start Day shows the browser's location prompt; Allow → "GPS live · last fix …" within ~30 s.
- [ ] Deny → explanation sheet; "Start without GPS" records attendance; status shows "permission blocked".
- [ ] Re-enabling location in browser/site settings and reloading resumes tracking.
- [ ] Device location services off → "could not determine its position" message (not a crash).

## Tracking behaviour
- [ ] Walk/drive ~1 km with the app open: admin live map moves within ~15–30 s of each fix.
- [ ] Accuracy circle and "last fix" age match reality; status changes from Live to Stale after 5 min without fixes.
- [ ] Lock the screen 5 min, unlock: a gap appears in Route History (expected browser behaviour).
- [ ] With "Keep screen on" enabled, the screen stays on and the route is continuous.
- [ ] End Day: distance in the summary is plausible vs. the real trip (estimate from sampled fixes).

## Visits
- [ ] Inside the client's location: "Within the 100 m client radius".
- [ ] ~300 m away: exception warning, reason required, admin Client Visits shows the exception.

## Offline
- [ ] Airplane mode: book an order, collect a payment, file an expense → each says "saved on this device".
- [ ] Reconnect: queue empties automatically; records appear in the console with correct timestamps.
- [ ] Location points captured while offline appear in Route History after reconnect.

## Camera / files
- [ ] Expense "Take photo or choose file" opens the camera; the uploaded receipt opens from the console.

## Receipts & calls
- [ ] Receipt PDF opens on the phone; "Call" opens the dialer; "Navigate" opens Google Maps directions.

## Android app (Capacitor) — native background tracking
None of this has been run on a physical phone. Install the debug/release APK built by CI (`docs/MOBILE_ANDROID.md`).
- [ ] Start Day: the tracking disclosure appears first; accepting asks for location, then "Allow all the time"; a persistent "SalesGrid is tracking your location" notification appears.
- [ ] Lock the screen, put the app in the background and walk/drive 15+ min: the admin Live page keeps updating (Live, then Stale if you stop), Route History shows one continuous line with no gap.
- [ ] Battery saver on / app swiped from recents: record what happens (tracking is expected to resume only when the app is reopened).
- [ ] Deny location → console shows "Permission denied" (not "weak signal"). Turn device location off → "GPS off".
- [ ] Airplane mode while moving, then reconnect: buffered points upload; route shows them in time order.
- [ ] Mock-location app enabled: points are rejected/flagged, never shown as live.
- [ ] End Day stops the notification and the service.
- [ ] Back button, offline screen, biometric lock, camera for expenses, receipt share sheet, local notification.
