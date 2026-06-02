// Plants push worker — Cloudflare Worker (deployed separately from GitHub Pages).
//
// Cron Triggers fire the morning ("what's due") notification and the optional
// evening defer. The app pushes a tiny schedule blob on every mutation so the
// worker never needs Google credentials and never duplicates the due-logic —
// it just compares absolute due-dates against "today in London".
//
// KV keys:
//   subscription          — the browser PushSubscription JSON
//   schedule              — [{ name, nextWaterDue, nextFeedDue }] (ISO dates or null)
//   deferred:<YYYY-MM-DD>  — set when Andy taps "This evening" (TTL ~20h)
//   sent:morning:<date> / sent:evening:<date> — per-day send dedupe guards (TTL ~36h)
//   cron-last             — ISO + London HH:MM of the most recent cron firing
//   heartbeat             — when set, every cron firing sends a test push (TTL ~2h)
//   lastdiag              — last client-posted diag string
//
// Auth: every endpoint takes the token as `Authorization: Bearer <PUSH_TOKEN>` or a
// `?token=` query param (so /diag and the toggles open from a phone tap). The token is
// a const in the public client; single-user public repo, so it only guards Andy's own
// KV — acceptable.

import { buildPushPayload } from '@block65/webcrypto-web-push';

const LONDON_TZ = 'Europe/London';
const SUBJECT = 'mailto:andy.bastable@gmail.com';
// Worker build stamp — bump on every worker change. Surfaced via GET /diag and in the
// heartbeat push so Andy can confirm which worker code is actually live after a
// `wrangler deploy` (the worker analog of the PWA CACHE_VERSION).
const WORKER_BUILD = '2026-06-02.1';

// ---- helpers ----
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

// Accept the token either as `Authorization: Bearer <token>` (app/SW calls) or as a
// `?token=<token>` query param, so the diagnostic endpoints (/diag, /heartbeat-on…)
// can be opened by just tapping a URL on the phone — no header-setting needed. The
// token is already a public client const guarding only Andy's own KV, so query-param
// exposure is acceptable for this single-user app.
function authed(request, env) {
  const header = (request.headers.get('Authorization') || '') === `Bearer ${env.PUSH_TOKEN}`;
  let query = false;
  try { query = new URL(request.url).searchParams.get('token') === env.PUSH_TOKEN; } catch {}
  return header || query;
}

// London wall-clock now — self-correcting across BST/GMT via Intl.
function londonNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: LONDON_TZ, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date()).map(p => [p.type, p.value])
  );
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dateStr: `${parts.year}-${parts.month}-${parts.day}`, // YYYY-MM-DD, lexically comparable
  };
}

function countDue(schedule, todayStr) {
  let water = 0, feed = 0;
  for (const p of schedule || []) {
    if (p.nextWaterDue && p.nextWaterDue <= todayStr) water++;
    if (p.nextFeedDue && p.nextFeedDue <= todayStr) feed++;
  }
  return { water, feed, total: water + feed };
}

function buildBody(water, feed) {
  const parts = [];
  if (water) parts.push(`${water} to water`);
  if (feed) parts.push(`${feed} to feed`);
  return `${parts.join(' · ')} today 🌱`;
}

async function sendPush(env, payloadObj) {
  const subRaw = await env.plants.get('subscription');
  if (!subRaw) { console.log('[push] no subscription stored'); return { sent: false, reason: 'no subscription' }; }
  const subscription = JSON.parse(subRaw);
  const message = { data: JSON.stringify(payloadObj), options: { ttl: 12 * 3600, urgency: 'normal' } };
  const payload = await buildPushPayload(message, subscription, {
    subject: SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  });
  const res = await fetch(subscription.endpoint, payload);
  if (res.status === 404 || res.status === 410) {
    await env.plants.delete('subscription'); // expired/unsubscribed at the push service
    console.log('[push] subscription gone, deleted');
  }
  console.log(`[push] sent status=${res.status} body="${payloadObj.body}"`);
  return { sent: res.ok, status: res.status };
}

// ---- scheduled logic ----
async function getSchedule(env) {
  const raw = await env.plants.get('schedule');
  return raw ? JSON.parse(raw) : [];
}

async function runMorning(env) {
  const { dateStr } = londonNow();
  const { water, feed, total } = countDue(await getSchedule(env), dateStr);
  if (total === 0) { console.log(`[push] nothing due ${dateStr} — staying silent`); return { sent: false, reason: 'nothing due' }; }
  return sendPush(env, { title: 'Plants 🌱', body: buildBody(water, feed), url: './?tab=today', actions: true });
}

// Run `fn` at most once per UTC-ish day for the given guard key. Cloudflare cron
// firings can be delayed and (rarely) retried, so without this a late/duplicate
// firing in the same hour window could double-send.
async function runOnce(env, key, fn) {
  if (await env.plants.get(key)) { console.log(`[push] ${key} already ran — skipping`); return { sent: false, reason: 'already ran' }; }
  await env.plants.put(key, '1', { expirationTtl: 36 * 3600 });
  return fn();
}

async function runEvening(env) {
  const { dateStr } = londonNow();
  const deferred = await env.plants.get(`deferred:${dateStr}`);
  if (!deferred) { console.log('[push] evening: not deferred today'); return { sent: false, reason: 'not deferred' }; }
  const { water, feed, total } = countDue(await getSchedule(env), dateStr);
  await env.plants.delete(`deferred:${dateStr}`);
  if (total === 0) { console.log('[push] evening: nothing left due'); return { sent: false, reason: 'nothing due' }; }
  return sendPush(env, { title: 'Plants 🌱 — this evening', body: buildBody(water, feed), url: './?tab=today' });
}

// Unconditional diagnostic push, gated by the `heartbeat` KV flag (set via
// /heartbeat-on, self-expires in ~2h). Fires on EVERY cron firing while enabled, so
// it proves the scheduled() handler is genuinely running end-to-end to the phone —
// independent of whether anything is due, which the real morning/evening pushes are
// not. Turn off with /heartbeat-off (or just let the flag lapse).
async function runHeartbeat(env, hhmm, dateStr) {
  if (!(await env.plants.get('heartbeat'))) return { sent: false, reason: 'heartbeat off' };
  const { water, feed, total } = countDue(await getSchedule(env), dateStr);
  console.log(`[push] heartbeat firing — London ${hhmm}, ${total} due`);
  return sendPush(env, {
    title: 'Plants ⏱ cron test',
    body: `Cron fired ${hhmm} London · ${total} due (${water}w/${feed}f) · build ${WORKER_BUILD}`,
    url: './?tab=today',
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    const url = new URL(request.url);
    const path = url.pathname;

    if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);

    try {
      if (request.method === 'POST' && path === '/subscribe') {
        const sub = await request.json();
        await env.plants.put('subscription', JSON.stringify(sub));
        return json({ ok: true });
      }
      if (request.method === 'POST' && path === '/schedule') {
        const blob = await request.json();
        await env.plants.put('schedule', JSON.stringify(blob));
        return json({ ok: true, count: Array.isArray(blob) ? blob.length : 0 });
      }
      if (request.method === 'POST' && path === '/unsubscribe') {
        await env.plants.delete('subscription');
        return json({ ok: true });
      }
      if (request.method === 'POST' && path === '/defer') {
        const { dateStr } = londonNow();
        await env.plants.put(`deferred:${dateStr}`, '1', { expirationTtl: 20 * 3600 });
        return json({ ok: true, deferred: dateStr });
      }
      // Heartbeat toggles — GET or POST so they can be opened by tapping a URL on the
      // phone. While on, every cron firing sends an unconditional test push (see
      // runHeartbeat). The flag self-expires so a forgotten "on" can't nag forever.
      if (path === '/heartbeat-on') {
        await env.plants.put('heartbeat', new Date().toISOString(), { expirationTtl: 2 * 3600 });
        return json({ ok: true, heartbeat: 'on', selfExpiresSec: 7200,
          note: 'every cron firing now pushes a test until /heartbeat-off or this lapses' });
      }
      if (path === '/heartbeat-off') {
        await env.plants.delete('heartbeat');
        return json({ ok: true, heartbeat: 'off' });
      }
      if (request.method === 'POST' && path === '/diag') {
        const body = await request.text();
        await env.plants.put('lastdiag', `${new Date().toISOString()} ${body}`);
        return json({ ok: true });
      }
      if (request.method === 'GET' && path === '/diag') {
        const now = londonNow();
        const sched = await getSchedule(env);
        const { water, feed, total } = countDue(sched, now.dateStr);
        return json({
          build: WORKER_BUILD,
          nowLondon: `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')} ${now.dateStr}`,
          cronLast: (await env.plants.get('cron-last')) || '(none)',
          heartbeat: (await env.plants.get('heartbeat')) ? 'on' : 'off',
          hasSubscription: !!(await env.plants.get('subscription')),
          scheduleCount: sched.length,
          dueToday: { water, feed, total },
          sentMorningToday: !!(await env.plants.get(`sent:morning:${now.dateStr}`)),
          sentEveningToday: !!(await env.plants.get(`sent:evening:${now.dateStr}`)),
          deferredToday: !!(await env.plants.get(`deferred:${now.dateStr}`)),
          diag: (await env.plants.get('lastdiag')) || '(none)',
        });
      }
      if (request.method === 'GET' && path === '/test-send') {
        const result = await runMorning(env);
        return json(result);
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.error('[push] error', err.stack || err);
      return json({ error: String(err.message || err) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    const { hour, minute, dateStr } = londonNow();
    const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    console.log(`[push] cron fired — London ${hhmm} (${dateStr})`);
    // Record the fire so cron health is inspectable via GET /diag without wrangler tail.
    // A single */5 cron drives this, so cron-last is never older than ~5 min when crons
    // are healthy — the first thing to check when a scheduled push goes missing.
    ctx.waitUntil(env.plants.put('cron-last', `${new Date().toISOString()} London ${hhmm}`));

    // Unconditional diagnostic push when /heartbeat-on is active — proves firing works.
    ctx.waitUntil(runHeartbeat(env, hhmm, dateStr));

    // A single frequent cron (wrangler.toml: */5) runs this handler all day. Act only
    // in the target London HOUR, made once-per-day by runOnce. So the morning/evening
    // push gets ~12 firing attempts inside the hour and survives Cloudflare's delayed
    // or dropped individual firings (a single missed firing was the old failure mode),
    // while still sending at most once. DST self-corrects — the hour is read in London.
    if (hour === 7) {
      ctx.waitUntil(runOnce(env, `sent:morning:${dateStr}`, () => runMorning(env)));
    } else if (hour === 18) {
      ctx.waitUntil(runOnce(env, `sent:evening:${dateStr}`, () => runEvening(env)));
    }
  },
};
