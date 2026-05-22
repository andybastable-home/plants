# STATUS

## Current phase

**Phase 1 — Bootstrap & Claude plumbing** (in progress)

Goal: New repo, GitHub Pages live, installable PWA shell with 3 empty tabs (Today / Plants / Settings), Claude plumbing (`CLAUDE.md`, this file, `.scripts/export-context.ps1`) ready for Phase 2.

Phase 1 is intentionally feature-free. The tabs render and switch; nothing else works yet.

## Visual style — locked

Aesthetic: refined botanical journal. Fraunces variable serif for display (local woff2 at `./assets/fonts/fraunces-latin.woff2`), system sans for body. HSL palette with light + dark themes, accent green at `hsl(150 42% 30%)`, warm-paper background at `hsl(60 25% 97%)`.

Phase 2+ should reference `notes/style-guide.html` for the full vocabulary — it has the canonical card / plant-row / room / action-btn / status-pill styles ready to lift into `styles.css` when those components are needed. Don't reinvent.

## Next 2-3 steps

1. Finish Phase 1 verification on the Pixel 8a — install the PWA, confirm standalone mode, confirm offline reload still shows the shell, confirm Fraunces loads (the brand wordmark should render as serif, not Georgia fallback).
2. Start a fresh Claude session for **Phase 2: Data model + Rooms/Plants CRUD (local)**. Mirror `food-and-weight`'s Dexie schema patterns. Add tabs: room list with collapsible plant entries, add-plant form (manual name/emoji/cadence — no AI yet). Persist to IndexedDB. No sync yet. Lift component styles from `notes/style-guide.html` rather than designing new ones.
3. After Phase 2 lands, **Phase 3: Today tab** will compute "Water in N days" / "Overdue by N days" from a `care_events` table and make Today the default tab on open.

## Open questions

(none right now)

## Conventions

- Current version: **v0.2.0**
- Deploy URL: `https://andybastable-home.github.io/plants/`
- Three-location version bump on every commit: `index.html` brand-version span, `index.html` footer span, `service-worker.js` `CACHE_VERSION`.
- Each phase = one Claude context window. If a phase grows past that, split it.
