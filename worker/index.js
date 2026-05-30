// Plants push worker — Cloudflare Worker (deployed separately from GitHub Pages).
//
// Cron Triggers fire the morning ("what's due") notification and the optional
// evening defer. The app pushes a tiny schedule blob on every mutation so the
// worker never needs Google credentials and never duplicates the due-logic —
// it just compares absolute due-dates against "today in London".
//
// KV keys:
//   subscription        — the browser PushSubscription JSON
//   schedule            — [{ name, nextWaterDue, nextFeedDue }] (ISO dates or null)
//   deferred:<YYYY-MM-DD> — set when Andy taps "This evening" (TTL ~20h)
//
// Auth: every endpoint requires `Authorization: Bearer <PUSH_TOKEN>`. The same
// token is a const in the public client. Single-user public repo, so it only
// guards writes to Andy's own KV — acceptable.

import { buildPushPayload } from '@block65/webcrypto-web-push';

const LONDON_TZ = 'Europe/London';
const SUBJECT = 'mailto:andy.bastable@gmail.com';

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

function authed(request, env) {
  return (request.headers.get('Authorization') || '') === `Bearer ${env.PUSH_TOKEN}`;
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
  return `${parts.join(' · ')} 🌱`;
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

async function runEvening(env) {
  const { dateStr } = londonNow();
  const deferred = await env.plants.get(`deferred:${dateStr}`);
  if (!deferred) { console.log('[push] evening: not deferred today'); return { sent: false, reason: 'not deferred' }; }
  const { water, feed, total } = countDue(await getSchedule(env), dateStr);
  await env.plants.delete(`deferred:${dateStr}`);
  if (total === 0) { console.log('[push] evening: nothing left due'); return { sent: false, reason: 'nothing due' }; }
  return sendPush(env, { title: 'Plants 🌱 — this evening', body: buildBody(water, feed), url: './?tab=today' });
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
    const { hour, minute } = londonNow();
    console.log(`[push] cron fired — London ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    if (hour === 7 && minute === 30) {
      ctx.waitUntil(runMorning(env));
    } else if (hour === 18 && minute === 0) {
      ctx.waitUntil(runEvening(env));
    } else {
      console.log('[push] not a London send-time, skipping');
    }
  },
};
