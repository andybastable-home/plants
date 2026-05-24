# STATUS

## Current phase

**Phase 5 — Gemini text classification** (not started)

Goal: Use Gemini to classify free-text plant-care notes / add intelligent suggestions.

## Next 2-3 steps

1. Review `notes/phase-5.md` (or design note) for the Gemini integration plan.
2. Implement Gemini API call in a new helper (or extend `sync.js`).
3. Wire a text-input field in the plant modal to suggest feed labels / care notes.

## Conventions

- Current version: **v0.5.0**
- Deploy URL: `https://andybastable-home.github.io/plants/`
- Three-location version bump on every shell commit: `index.html` brand-version span, `index.html` footer span, `service-worker.js` `CACHE_VERSION`.
- Each phase = one Claude context window. If a phase grows past that, split it.
- Visual style is locked. Lift component patterns from `notes/style-guide.html`; don't redesign.
- Sync (`sync.js`): full-replace backup/restore via Google Sheets REST API v4 + GIS OAuth. No Apps Script. `plants.*` localStorage keys. Sheet: 4 tabs (Rooms, Plants, CareEvents, Metadata). Auto-backup on every mutation (2s debounce via `window.scheduleBackup`).
