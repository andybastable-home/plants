# Plants push worker

Tiny Cloudflare Worker that sends the daily "what's due" Web Push. Deployed
**separately** from the GitHub Pages app (Pages ignores this folder).

## How it works

- The app POSTs a schedule blob (`[{name, nextWaterDue, nextFeedDue}]`) to
  `/schedule` on every mutation. Absolute due-dates, so they stay correct as days
  pass and only change when care is logged in-app.
- A single Cron Trigger (`*/5 * * * *`) runs the handler every 5 min. It reads
  **Europe/London** via `Intl` and acts only in the target hour — 07 (morning) / 18
  (evening defer) — made once-per-day by a KV dedupe guard. DST-proof, and robust
  against Cloudflare's delayed/dropped firings: the target hour gets ~12 attempts, not
  1. (The old twice-daily UTC schedule missed a single delayed firing, which silently
  killed the whole day's morning → defer → evening chain — the bug this replaces.)
- Morning: counts plants due today; if > 0, pushes `"2 to water · 1 to feed 🌱"` at
  **high urgency** so FCM wakes the (likely Dozing) phone immediately — no app-open
  needed; Web Push delivers to the **closed PWA**. If nothing's due it stays silent.
  A valid subscription persists for months and is kept warm by these daily pushes — it
  does not need the app reopened. The per-day send guard is only set once a push
  actually succeeds, so a transient miss is retried across the hour's ~12 firings.
- Evening: only fires if Andy tapped **This evening** that day *and* something is
  still due.

## One-time setup (already mostly done)

```sh
cd worker
npm install
wrangler login                       # if not already
wrangler secret put VAPID_PRIVATE_KEY  # paste the private VAPID key
wrangler secret put PUSH_TOKEN         # paste the shared bearer (matches the client const)
wrangler deploy
```

`wrangler deploy` prints the Worker URL (e.g. `https://plants.<subdomain>.workers.dev`).
**Put that URL into `WORKER_URL` in `../app.js`** (replace the `REPLACE-ME` placeholder),
then commit + redeploy Pages.

The public VAPID key and KV namespace id are already in `wrangler.toml`. The private
key and bearer token are secrets and must never be committed (public repo).

## Verify / diagnose a missed scheduled push

The full pipeline (subscription → VAPID → push service → phone) is exercised by the
in-app **Settings → Send test** button (it calls `/test-send`). So if a *test* lands
but a *scheduled* push didn't, the fault is cron firing, not delivery — diagnose that:

```sh
wrangler tail     # live logs: expect "[push] cron fired — London HH:MM" every ~5 min
```

Tappable from the phone (token is the public single-user client const):

- **Health check —** `https://plants.plants-andyb.workers.dev/diag?token=SuperSecretPlants837492!`
  Returns `build` (which deployed code is live), `nowLondon` (the worker's own clock —
  sanity-check the timezone), `cronLast` (should be < ~5 min old when crons are
  healthy), `hasSubscription`, `subRegistered`/`subDeleted` (the subscription's lifecycle —
  see below), `dueToday`, and today's `sentMorning/EveningToday` guards.
- **Unconditional cron test —** hit `…/heartbeat-on?token=…`; within ≤5 min the phone
  gets a "Plants ⏱ cron test" push *regardless of whether anything is due*, proving the
  scheduled handler runs end-to-end. Turn off with `…/heartbeat-off?token=…` (or let it
  self-expire in ~2h).

Decision tree when a scheduled push goes missing:
- `cronLast` stale / `(none)` → crons aren't firing. Re-run `wrangler deploy`; confirm
  the dashboard (Worker → Settings → Triggers) shows `*/5 * * * *` and `wrangler
  deployments list` has your latest. An old `build` in `/diag` means the deploy didn't take.
- `cronLast` fresh but `hasSubscription:false` with a fresh **`subDeleted`** → the most
  common failure: the subscription went **`Gone` (410)** and the worker deleted it. On a
  never-opened PWA, Android reclaims the "unused" app's FCM channel overnight, so the sub
  is dead by the 07:00 send. `pushsubscriptionchange` doesn't recover this (it's for
  *browser* rotation, not OS teardown). **Fix is device-side:** set the PWA's battery to
  *Unrestricted* and disable "Pause app activity if unused" / auto-revoke-permissions, then
  re-open once to re-subscribe. `subRegistered` vs `subDeleted` timestamps show the
  overnight death and whether anything re-registered.
- `cronLast` fresh but no heartbeat → push send failing from cron (rare, since
  `/test-send` works) — read the `[push] sent status=…` line in `wrangler tail`.
- heartbeat arrives but no 07:30 push → nothing was due that morning (silent by design);
  confirm via `dueToday` in `/diag`.

`/test-send` still runs the morning logic immediately — notification arrives if
something's due, otherwise the response says `"nothing due"`.
