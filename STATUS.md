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

### Remaining (Andy, outside Claude) — worker redeploy required
Scheduled pushes still weren't arriving (test push works fine, so delivery is OK — the
fault is cron firing). The earlier hour-match fix was committed but almost certainly
never deployed, and a *single* firing per target was fragile anyway: Cloudflare
delays/drops firings, and one miss killed the whole morning → defer → evening chain.
Now consolidated to **one `*/5 * * * *` cron** (DST-proof, per-day dedupe-guarded,
~12 attempts/hour) plus an **unconditional heartbeat** for end-to-end cron testing.
Worker-only change — the PWA on the phone is unchanged (no reinstall, still v0.9.0).

1. **Deploy:** `cd worker && wrangler deploy`. Confirm it prints `*/5 * * * *`.
2. **Confirm live + clock:** open on the phone
   `…workers.dev/diag?token=<PUSH_TOKEN>` → `build` = `2026-06-02.1`, `nowLondon`
   matches real London time, `hasSubscription: true`, `cronLast` < ~5 min old.
3. **Prove cron firing:** `…/heartbeat-on?token=…` → expect a "Plants ⏱ cron test"
   push within 5 min, then `…/heartbeat-off?token=…`. (Full decision tree in
   `worker/README.md`.)
4. **Verify the real schedule** over the next morning(s): a 7:30 London push when
   something's due; tapping "This evening" then yields the ~18:00 evening push.

## Next phase

Phase 8 — Polish (icons, empty states, visual pass).

## Conventions

- Current version: **v0.9.0**
- Deploy URL: `https://andybastable-home.github.io/plants/`
- Three-location version bump on every shell commit: `index.html` brand-version span, `index.html` footer span, `service-worker.js` `CACHE_VERSION`.
- Each phase = one Claude context window. If a phase grows past that, split it.
- Visual style is locked. Lift component patterns from `notes/style-guide.html`; don't redesign.
- Sync (`sync.js`): full-replace backup/restore via Google Sheets REST API v4 + GIS OAuth. No Apps Script. `plants.*` localStorage keys. Sheet: 4 tabs (Rooms, Plants, CareEvents, Metadata). Auto-backup on every mutation (2s debounce via `window.scheduleBackup`).
