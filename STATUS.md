# STATUS

## Current phase

**Phase 7 — Daily push notification** (code complete, v0.9.0; pending on-device verify)

Daily ~7:30am London Web Push that fires **only when something's due**; tapping opens
the Today pane; morning push offers a "This evening" defer (Part B, included).

Architecture: a free **Cloudflare Worker** (`worker/`, deployed separately — Pages
ignores it) sends Web Push via VAPID using `@block65/webcrypto-web-push`. The app POSTs
a tiny absolute-due-date schedule blob to `/schedule` on every mutation (via the existing
`scheduleBackup` debounce in `sync.js`, now sheet-independent). Cron fires at both UTC
candidates; the handler reads Europe/London via `Intl` and only sends at 07:30/18:00
London → DST self-corrects. No Google creds in the worker; due-ness is pure date compare.

Client: `service-worker.js` has `push` + `notificationclick` (+ `worker-config` message
for closed-page `/defer`). `app.js` has the subscribe/enable flow, `buildSchedule()`,
`pushScheduleToWorker()` (queues `plants.notifyPending` on failure, retried on init),
and `?tab=` deep-link. Settings has a **Reminders** section (Enable/Disable + Send test).
Notification assets: `icons/icon-192.png` (colour) + `icons/badge-96.png` (mono).

### Remaining (Andy, outside Claude)
Deploy #1 done (build `2026-06-02.1` live). The `/diag` it added found the real cause:
the cron **was** firing and the morning logic **did** run (`sentMorningToday:true`, 18
due) — but **`hasSubscription:false`**, so there was nothing to push to. The stored
subscription had been dropped (expired → 410 → auto-deleted by `sendPush`). In-app tests
still "worked" because holding the awake phone masks two things: the missing sub (the
app re-subscribes on open) and Doze batching. Fixes: (a) per-day guard now sets only
*after* a push succeeds, so a transient miss is retried across the hour's ~12 `*/5`
firings; (b) push **urgency raised to `high`** so FCM wakes a Dozing phone immediately
rather than batching the 7:30 alarm until the phone is next picked up. The reminder is
meant to fire on a **closed, idle PWA without opening the app** — that's standard Web
Push and works once the subscription is healthy (daily pushes keep it warm). Worker-only;
PWA unchanged (still v0.9.0).

1. **Redeploy** for the guard fix: `cd worker && wrangler deploy` → confirm `*/5 * * * *`.
2. **Re-establish the subscription:** open the PWA → Settings → Reminders → **Disable,
   then Enable** (forces a fresh `subscribe()` — a plain re-open could re-store the dead
   sub). Reload `/diag?token=<PUSH_TOKEN>` → confirm **`hasSubscription:true`** and
   `build` = `2026-06-02.2`.
3. **Prove end-to-end:** `…/heartbeat-on?token=…` → expect a "Plants ⏱ cron test" push
   within 5 min (do step 2 first!), then `…/heartbeat-off?token=…`. Also check `cronLast`
   is now < 5 min old (proves the new `*/5` is ticking).
4. **Verify the real schedule** next morning: a 7:30 push when due; "This evening" then
   yields the ~18:00 push.

## Next phase

Phase 8 — Polish (icons, empty states, visual pass).

## Conventions

- Current version: **v0.9.0**
- Deploy URL: `https://andybastable-home.github.io/plants/`
- Three-location version bump on every shell commit: `index.html` brand-version span, `index.html` footer span, `service-worker.js` `CACHE_VERSION`.
- Each phase = one Claude context window. If a phase grows past that, split it.
- Visual style is locked. Lift component patterns from `notes/style-guide.html`; don't redesign.
- Sync (`sync.js`): full-replace backup/restore via Google Sheets REST API v4 + GIS OAuth. No Apps Script. `plants.*` localStorage keys. Sheet: 4 tabs (Rooms, Plants, CareEvents, Metadata). Auto-backup on every mutation (2s debounce via `window.scheduleBackup`).
