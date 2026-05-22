# STATUS

## Current phase

**Phase 2 — Data model + Rooms/Plants CRUD (local)** (not started)

Goal: Model rooms and plants in IndexedDB via Dexie, mirroring `food-and-weight`'s schema-versioned pattern. Build the Plants tab UI: rooms as collapsible sections, plants as rows. Add an "Add plant" form (name, emoji, room, water cadence, feed cadence — all manual; no AI yet). Persist locally. No sync.

## Next 2-3 steps

1. Confirm the data model with Andy before writing the schema. Working assumption: stores for `rooms` (id, name, order), `plants` (id, room_id, name, emoji, quantity, water_days, feed_days, feed_label, notes), and `care_events` (id, plant_id, kind: 'water'|'feed', timestamp). **Open question:** does `care_events` land in Phase 2 (so Plants rows can show "last watered" timestamps) or slip to Phase 3?
2. Lift component CSS from `notes/style-guide.html` into `styles.css`: `.plant-card`, `.plant-row`, `.room`, `.action-btn`, `.status-pill`. Keep the class names so Phase 3 can reuse them on the Today tab.
3. Build the Plants tab: render rooms from Dexie, plant rows under each, "Add plant" floating action button at the bottom of the screen for thumb reach, modal-style form.

## Conventions

- Current version: **v0.2.0**
- Deploy URL: `https://andybastable-home.github.io/plants/`
- Three-location version bump on every shell commit: `index.html` brand-version span, `index.html` footer span, `service-worker.js` `CACHE_VERSION`.
- Each phase = one Claude context window. If a phase grows past that, split it.
- Visual style is locked. Lift component patterns from `notes/style-guide.html`; don't redesign.
