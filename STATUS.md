# STATUS

## Current phase

**Phase 7 — Daily push notification** (not started)

Goal: A daily local/push notification reminding Andy what's due (water/feed) on his Pixel 8a PWA.

Interleaved feature landed (v0.8.0): **manual care logging on the Plants pane** — swipe a row right→water / left→feed (Spotify-style coloured wipe, blue water / amber feed, commit threshold), tap a row opens a bottom action sheet (last watered/fed + Edit/Delete) instead of the edit form, and a swipe shows an undo toast (~4s). All UI in `app.js` (`attachRowSwipe`, `openPlantActionSheet`, `showUndoToast`, `lastCareLabel`) + styles. Phase 7 still next.

Phase 6 (Gemini vision) is done (v0.7.1): the plant modal's **Name field doubles as the AI prompt** (overwritten by the result; raw text persisted as `ai_prompt` via `panel.dataset.aiPrompt`). The ✨ generate and 📷 camera are overlay icons inside the Name field; the camera input uses `capture="environment"` to open the camera app directly. A single photo is resized to a 1024px JPEG, sent as `inline_data`, not saved/synced. Success shows a confidence + reasoning status line. Model is `gemini-3.5-flash` (falls back to `gemini-2.5-flash` on quota/unavailable; `gemini-3-flash` was a wrong id that 404'd). Plants-list rows show "Feed every Xd" only (feed label dropped — Gemini labels overflowed).

## Next 2-3 steps

1. Review the PWA notification options (Notification API + service worker; Android PWA supports scheduled/periodic where available, else a daily check on launch).
2. Decide trigger: periodic background sync vs. a server-free local schedule (no paid push service — free constraint).
3. Wire the "what's due today" summary (reuse `dueStatus`/`renderToday` logic) into the notification body.

## Conventions

- Current version: **v0.8.0**
- Deploy URL: `https://andybastable-home.github.io/plants/`
- Three-location version bump on every shell commit: `index.html` brand-version span, `index.html` footer span, `service-worker.js` `CACHE_VERSION`.
- Each phase = one Claude context window. If a phase grows past that, split it.
- Visual style is locked. Lift component patterns from `notes/style-guide.html`; don't redesign.
- Sync (`sync.js`): full-replace backup/restore via Google Sheets REST API v4 + GIS OAuth. No Apps Script. `plants.*` localStorage keys. Sheet: 4 tabs (Rooms, Plants, CareEvents, Metadata). Auto-backup on every mutation (2s debounce via `window.scheduleBackup`).
