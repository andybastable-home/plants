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

### Remaining (Andy, outside Claude) — the subscription keeps dying overnight
Cron is **not** the problem (proven: `cronLast` always fresh, the */5 ticks fine). The
problem is the **push subscription goes `Gone` (410) overnight on the never-opened PWA**:
two mornings running, `/diag` showed `hasSubscription:false`. At 07:00 the worker tries to
send, gets 410, deletes the dead sub → no reminder. `pushsubscriptionchange` doesn't save
it — that event is for *browser* rotation, not Android's OS-level teardown of an "unused"
app's FCM channel. A PWA that's by-design never opened is exactly what Android adaptive-
battery / auto-revoke-permissions reclaims.

Worker build `2026-06-03.1` now records the sub lifecycle so we can prove this: `/diag`
returns `subRegistered` (last /subscribe write) and `subDeleted` (ISO + status of the last
Gone delete). PWA still v0.9.0.

**Actions:**
1. **Device-side root-cause fix (do this — the real fix):** On the Pixel, for the Plants
   PWA set battery usage to **Unrestricted**, and turn **off** "Pause app activity if
   unused" / "Remove permissions and free up space" for it. (Settings → Apps → Plants →
   Battery = Unrestricted; and the App-info toggle "Pause app activity if unused" = off.)
   This stops Android tearing down the FCM channel overnight.
2. **Re-subscribe now:** open the PWA once (re-registers the sub → `hasSubscription:true`,
   stamps `subRegistered`). Then **don't open it again** and leave the phone overnight.
3. **Tomorrow ~9am, before opening the app, tap `/diag`:** if `subDeleted` has a fresh
   overnight timestamp → Android still killed it (the battery settings didn't take / need
   more). If `subDeleted` is stale and the reminder arrived → fixed.

## Next phase

Phase 8 — Polish (icons, empty states, visual pass).

## Conventions

- Current version: **v0.9.0**
- Deploy URL: `https://andybastable-home.github.io/plants/`
- Three-location version bump on every shell commit: `index.html` brand-version span, `index.html` footer span, `service-worker.js` `CACHE_VERSION`.
- Each phase = one Claude context window. If a phase grows past that, split it.
- Visual style is locked. Lift component patterns from `notes/style-guide.html`; don't redesign.
- Sync (`sync.js`): full-replace backup/restore via Google Sheets REST API v4 + GIS OAuth. No Apps Script. `plants.*` localStorage keys. Sheet: 4 tabs (Rooms, Plants, CareEvents, Metadata). Auto-backup on every mutation (2s debounce via `window.scheduleBackup`).
