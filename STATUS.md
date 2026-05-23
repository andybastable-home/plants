# STATUS

## Current phase

**Phase 3 — Today tab — due/overdue logic** (not started)

Goal: Populate the Today tab. For each plant, calculate days since last care event (from `care_events`), compare against `water_days`/`feed_days`, and surface due/overdue plants as cards. Log water/feed events from plant cards. Show "last watered: Nd ago" on plant rows in the Plants tab.

## Next 2-3 steps

1. Add `logCareEvent(plant_id, kind)` data-access function; wire up "Water" and "Feed" action buttons on Today-tab plant cards to write `care_events` rows.
2. Build `renderToday()`: query all plants, compute `daysSince(plant_id, kind)` from `care_events`, render due/overdue cards sorted by urgency (overdue first).
3. Back-fill Plants tab rows with "last watered: Nd ago" (or "never") by querying `care_events` per plant during `renderPlants()`.

## Conventions

- Current version: **v0.3.1**
- Deploy URL: `https://andybastable-home.github.io/plants/`
- Three-location version bump on every shell commit: `index.html` brand-version span, `index.html` footer span, `service-worker.js` `CACHE_VERSION`.
- Each phase = one Claude context window. If a phase grows past that, split it.
- Visual style is locked. Lift component patterns from `notes/style-guide.html`; don't redesign.
