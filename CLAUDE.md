# Project notes for Claude

## Single user, single device

This app has **exactly one user (Andy) on exactly one device (his Pixel 8a)**. It is not a product, not multi-tenant, not multi-device. Desktop Chrome is dev only; the phone is the only deployment.

Implications:
- No user accounts, no settings for "other users", no role abstractions.
- No multi-device conflict resolution. Sync is one phone <-> one Google Sheet.
- No onboarding flow, no empty-state copy aimed at strangers, no generic "welcome" UX. Andy already knows what the app does.
- Hard-coded assumptions about Andy's plants and rooms are fine and preferred over configurability.
- "What if a user..." edge cases that require a second user or device to trigger are **not real** and should not be coded for.

## Primary surface: installed PWA on Android (Pixel 8a)

This app is **used as an installed PWA on Andy's Pixel 8a**, not as a desktop site. Desktop Chrome on Windows is for development and debugging only — it is not the deployment target.

Implications for every change:
- **Touch-first.** Tap targets >= 44px. No hover-only affordances. No right-click menus.
- **Mobile viewport.** Design for ~412px wide portrait. Don't add layouts that only make sense at desktop widths.
- **One-handed thumb reach.** Primary actions belong near the bottom of the screen, not the top.
- **Offline / flaky network is normal.** Anything that touches sync must degrade gracefully when offline. Service worker caching matters.
- **Mid-tier mobile perf.** Pixel 8a is capable but not a desktop. Don't ship large dependencies or heavy per-frame work.
- **PWA install flow matters.** Don't break `manifest.json` or the service worker registration without flagging it. Andy can't easily re-install.

When verifying UI work, the canonical test is "open it on the Pixel 8a installed PWA," not "open it in desktop Chrome." Desktop Chrome DevTools device emulation is acceptable for fast iteration but is not the final check.

## Multi-phase plan

Each phase below is sized to fit in a **single Claude context window** — Andy starts a fresh session per phase. If a phase grows past that budget, split it; do not compress two phases into one.

| Phase | Title                                  | Status      |
| ----- | -------------------------------------- | ----------- |
| 1     | Bootstrap & Claude plumbing            | in progress |
| 2     | Data model + Rooms/Plants CRUD (local) | not started |
| 3     | Today tab — due/overdue logic          | not started |
| 4     | Google Sheets sync                     | not started |
| 5     | Gemini text classification             | not started |
| 6     | Gemini image classification (vision)   | not started |
| 7     | Daily push notification                | not started |
| 8     | Polish                                 | not started |

`STATUS.md` is the live source of truth for which phase is current and what the next 2-3 steps are. The table above is just orientation; do not edit it as a tracker — update `STATUS.md` instead.

## Code map

Tiny vanilla web app — no build step. Skim this before grepping; only read whole files when the map points you there.

```
index.html         single page; header, tab strip, panes, footer
app.js             all UI; will grow to include IndexedDB (Dexie), settings, AI
sync.js            (Phase 4+) Google Sheets OAuth + sync, schema migrations
service-worker.js  network-first shell cache; bump CACHE_VERSION on every release
styles.css         design tokens + styles (don't open unless task is visual)
manifest.json      PWA manifest (don't touch without flagging)
icons/             placeholder SVG (will be polished in Phase 8)
.scripts/          export-context.ps1 (Gemini planner workflow)
notes/             design spikes — read when starting the matching phase
```

As `app.js` and `sync.js` grow, add `// ----` banner section comments and document them here so future Claude sessions can grep banners instead of reading whole files. The sister project `food-and-weight/CLAUDE.md` has the established format for that section — mirror it.

## Working under a token budget

This project runs on Claude Pro with hard usage limits. Be deliberate about context.

- **Each phase is its own session.** Don't try to compress multiple phases into one — that's how context windows get blown.
- **No browser automation.** Playwright MCP is not installed and must not be re-introduced. UI verification is manual — describe what to check and Andy will run it in a browser and report back.
- **Don't read `styles.css` unless the task is visual styling.** It's mostly irrelevant to data/sync work.
- **Read `STATUS.md` once per session, not repeatedly.** It is the source of truth for current phase + next steps.
- **Prefer Grep over reading whole files** when locating a symbol or string. Read the whole file only after you know which one matters.
- **No speculative refactors, no "while we're here" cleanup.** Do exactly what was asked.
- **Skip end-of-turn recap prose.** A one-line "done; STATUS updated" is enough.
- **Perform git operations** (commit and push) as the final step of every task. Don't wait to be asked — stage relevant files, commit with a clear message, and push. Andy drives git only if he says so explicitly.

## STATUS.md discipline

`STATUS.md` is loaded into context every session. Keep it lean:
- Current phase block + next 2-3 steps + open questions only.
- When a phase closes, archive the detail to a phase-specific note or just delete it — don't accrete.

## Versioning

**Bump the version with every commit.** This app is deployed as a PWA and version numbers are the primary way Andy confirms the correct build loaded on his phone during testing.

- Version lives in three places — always bump all three in lockstep: `index.html` (brand-version span + footer span) and `service-worker.js` (`CACHE_VERSION`). Missing any one causes the display version and cached assets to diverge.
- Use semver patch bumps (v0.1.0 -> v0.1.1) for most changes; minor bumps (v0.1.x -> v0.2.0) for significant feature milestones (typically a new phase landing).

## Constraints

- **No paid subscriptions, ever.** This is a personal hobby project. Any solution that requires a paid plan (GitHub Pro, hosting tiers, paid APIs beyond free quotas, etc.) is off the table — find a free alternative or flag the constraint and ask. Free tiers of services (Gemini, Apps Script, GitHub Pages on public repos, Cloudflare/Netlify free) are fine.

## Gemini as planning agent

Andy occasionally uses Gemini Pro as a planning/context agent to maximize token efficiency across multiple models:

1. Run `.scripts/export-context.ps1` (PowerShell) to generate three `.aicontext` files (claude, website, misc) by category.
2. Paste the `.aicontext` files into Gemini as context (Gemini's 1M context window handles them easily).
3. Gemini plans the implementation (designs, pseudocode, API shapes, decision rationale).
4. Andy pastes the Gemini plan into a Claude conversation and Claude implements it.

The `.aicontext` files are git-ignored and regenerated on demand.

## Repo

- Personal repo: `andybastable-home/plants` on github.com (public).
- Deployed at: `https://andybastable-home.github.io/plants/`
- Authenticated via SSH; the local clone uses whatever default key is configured for github.com on this machine.
- Sister project: `andybastable-home/food-and-weight` at `C:\UnitySrc\git_personal\food-and-weight` — same architectural patterns (PWA + Google Sheets sync + Gemini + GitHub Pages). Reference it when designing new features for `plants`, especially for OAuth/sync (Phase 4) and Gemini integration (Phase 5+).
