# Plants push worker

Tiny Cloudflare Worker that sends the daily "what's due" Web Push. Deployed
**separately** from the GitHub Pages app (Pages ignores this folder).

## How it works

- The app POSTs a schedule blob (`[{name, nextWaterDue, nextFeedDue}]`) to
  `/schedule` on every mutation. Absolute due-dates, so they stay correct as days
  pass and only change when care is logged in-app.
- Cron Triggers fire at 06:30 + 07:30 UTC (morning) and 17:00 + 18:00 UTC (evening).
  The handler reads **Europe/London** time via `Intl` and only sends on the trigger
  equal to 07:30 London (morning) / 18:00 London (evening defer). Self-corrects
  across BST/GMT — no manual edits, ever.
- Morning: counts plants due today; if > 0, pushes `"2 to water · 1 to feed 🌱"`.
  If nothing's due it stays silent (so the notification is never noise).
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

## Verify

```sh
wrangler tail                                  # live logs
curl -H "Authorization: Bearer <PUSH_TOKEN>" https://plants.<subdomain>.workers.dev/test-send
```

`/test-send` runs the morning logic immediately — notification arrives if something's
due, otherwise the log says "nothing due".
