# STATUS

## Current phase

**Phase 6 — Gemini image classification (vision)** (not started)

Goal: Photograph a plant and have Gemini identify it + fill the maintenance fields, building on the Phase 5 text autofill.

Phase 5 (Gemini text autofill) is done in v0.6.0: prompt box + ✨ Generate in the plant modal fills name/emoji/water/feed/label/notes; `ai_prompt` saved per plant and synced; `plants.geminiKey` local-only, `plants.aiContext` synced via Metadata.

## Next 2-3 steps

1. Reuse `requestPlantAutofill` shape; add an image part to the Gemini `contents` request.
2. Add a camera/file-picker control to the plant modal (touch-first, near the prompt box).
3. Decide image handling: send inline base64 vs. resize first (Pixel 8a perf / free quota).

## Conventions

- Current version: **v0.6.0**
- Deploy URL: `https://andybastable-home.github.io/plants/`
- Three-location version bump on every shell commit: `index.html` brand-version span, `index.html` footer span, `service-worker.js` `CACHE_VERSION`.
- Each phase = one Claude context window. If a phase grows past that, split it.
- Visual style is locked. Lift component patterns from `notes/style-guide.html`; don't redesign.
- Sync (`sync.js`): full-replace backup/restore via Google Sheets REST API v4 + GIS OAuth. No Apps Script. `plants.*` localStorage keys. Sheet: 4 tabs (Rooms, Plants, CareEvents, Metadata). Auto-backup on every mutation (2s debounce via `window.scheduleBackup`).
