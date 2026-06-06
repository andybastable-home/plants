# STATUS

## Current phase

**Phase 7 — Daily reminder** (PIVOTED to a native companion; code complete, builds clean;
pending on-device reboot verify)

**Web Push is retired for the reminder.** Three mornings of `/diag` instrumentation proved
it can't serve the killer use case (phone off overnight, powered on ~06:30, PWA deliberately
never opened): the nightly **reboot invalidates the push subscription** (`410 Gone`, with
`subRegistered` unchanged), and a never-opened PWA has no reliable way to re-register
(`pushsubscriptionchange` is for browser key rotation, not OS teardown; the SW isn't woken on
a closed app). Cron/urgency/inactivity were all ruled out first. Structural ceiling of Web Push.

**The fix: a native companion (`android/`).** A plain Kotlin app schedules an exact, Doze-exempt
`AlarmManager.setExactAndAllowWhileIdle` for **07:30 local**, re-armed on boot (`BootReceiver`) —
the phone wakes *itself*, no FCM/subscription/cron/internet-at-fire-time. At fire time `AlarmReceiver`
GETs the worker's `/diag`, reads `dueToday.{water,feed,total}`, and notifies (generic fallback when
offline); tapping opens the Plants PWA Today tab. Built on the borrowed Unity Android toolchain
(mirrors sister project `bike-dashboard`), sideloaded to the Pixel 8a. `applicationId`
`dev.bastable.plantsreminder`, v0.1.1.

> v0.1.1: swapped `setAlarmClock` → `setExactAndAllowWhileIdle` — both fire exactly through Doze,
> but the former forced a permanent status-bar alarm icon. Trade-off: no clock-app "next alarm"
> entry, so arm-state is only checkable via **Test reminder now** / logcat.

The **PWA is untouched** (still v0.9.0; its push code is now inert but harmless). The **worker is
demoted to a due-count data endpoint** — `/schedule` store + `/diag` read stay live; cron + Web
Push send are dead weight, retained for reference, deletable in a later cleanup.

### Remaining (Andy, on the Pixel — outside Claude)
1. `cd plants/android`; build `app-debug.apk` (see `android/README.md`), `adb install -r`.
2. Launch once → grant notification permission → **Test reminder now** → notification appears,
   tapping it opens the PWA Today tab.
3. **The real test:** confirm a reminder is scheduled, power off, power on, leave Plants
   **unopened**, confirm the 07:30 notification fires and re-arms. This is the exact scenario
   Web Push failed.

## Next phase

Phase 8 — Polish (icons, empty states, visual pass).

Fast-follows for the companion (noted, not built): "This evening" defer (one-shot 18:00 alarm
from a notification action); retiring the worker's now-dead cron/push code.

## Conventions

- Current version: **v0.9.0**
- Deploy URL: `https://andybastable-home.github.io/plants/`
- Three-location version bump on every shell commit: `index.html` brand-version span, `index.html` footer span, `service-worker.js` `CACHE_VERSION`.
- Each phase = one Claude context window. If a phase grows past that, split it.
- Visual style is locked. Lift component patterns from `notes/style-guide.html`; don't redesign.
- Sync (`sync.js`): full-replace backup/restore via Google Sheets REST API v4 + GIS OAuth. No Apps Script. `plants.*` localStorage keys. Sheet: 4 tabs (Rooms, Plants, CareEvents, Metadata). Auto-backup on every mutation (2s debounce via `window.scheduleBackup`).
