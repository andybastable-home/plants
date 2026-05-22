# STATUS

## Current phase

**Phase 1 — Bootstrap & Claude plumbing** (in progress)

Goal: New repo, GitHub Pages live, installable PWA shell with 3 empty tabs (Today / Plants / Settings), Claude plumbing (`CLAUDE.md`, this file, `.scripts/export-context.ps1`) ready for Phase 2.

Phase 1 is intentionally feature-free. The tabs render and switch; nothing else works yet.

## Next 2-3 steps

1. Review the visual style preview at `notes/style-guide.html` (deployed at `https://andybastable-home.github.io/plants/notes/style-guide.html`). Decisions to lock down before Phase 2: accent green hue, Fraunces display weights, spacing/radii scales, card vs row patterns. Iterate until Andy is happy, then port the locked tokens into `styles.css`.
2. Finish Phase 1 verification on the Pixel 8a — install the PWA, confirm standalone mode, confirm offline reload still shows the shell.
3. Start a fresh Claude session for **Phase 2: Data model + Rooms/Plants CRUD (local)**. Mirror `food-and-weight`'s Dexie schema patterns. Add tabs: room list with collapsible plant entries, add-plant form (manual name/emoji/cadence — no AI yet). Persist to IndexedDB. No sync yet.

## Open questions

(none right now)

## Conventions

- Current version: **v0.1.0**
- Deploy URL: `https://andybastable-home.github.io/plants/`
- Three-location version bump on every commit: `index.html` brand-version span, `index.html` footer span, `service-worker.js` `CACHE_VERSION`.
- Each phase = one Claude context window. If a phase grows past that, split it.
