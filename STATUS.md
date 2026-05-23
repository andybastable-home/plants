# STATUS

## Current phase

**Phase 4 — Google Sheets sync** (not started)

Goal: Sync plants, rooms, and care_events to a personal Google Sheet via Google Apps Script + OAuth so data is backed up and viewable outside the app.

## Next 2-3 steps

1. Review `food-and-weight`'s OAuth flow (`sync.js`) to understand the established pattern: Apps Script web app as proxy, `gapi` client-side token flow, incremental writes.
2. Design the Sheet schema: one tab per table (rooms, plants, care_events), with UUID as the stable key for upserts.
3. Implement `sync.js` with a `syncToSheet()` function wired to a manual "Sync" button; offline queueing (write locally first, sync when online) can land in Phase 4 or slip to Phase 5.

## Conventions

- Current version: **v0.4.1**
- Deploy URL: `https://andybastable-home.github.io/plants/`
- Three-location version bump on every shell commit: `index.html` brand-version span, `index.html` footer span, `service-worker.js` `CACHE_VERSION`.
- Each phase = one Claude context window. If a phase grows past that, split it.
- Visual style is locked. Lift component patterns from `notes/style-guide.html`; don't redesign.
