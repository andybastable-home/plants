// Bump CACHE_VERSION whenever shell files change so updates roll cleanly.
const CACHE_VERSION = 'v0.9.6';
const CACHE_NAME = `plants-shell-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './sync.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/badge-96.png',
  './assets/fonts/fraunces-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Network-first with cache fallback. While developing this means updates land
// on the next online refresh instead of needing a double-refresh. When offline,
// requests fall back to the cache so the app stays usable.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});

// ----------------------------------------------------------------------------
// Push notifications (Phase 7). The Cloudflare worker sends a JSON payload
// { title, body, url, actions? }; the morning push sets actions:true to offer
// "This evening" defer. Android brands this as "Plants" (installed PWA), not
// Chrome, using the icon below.
// ----------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  const title = payload.title || 'Plants 🌱';
  const url   = payload.url || './?tab=today';
  const options = {
    body: payload.body || 'Something needs your attention.',
    icon: './icons/icon-192.png',   // full-colour, large (right side)
    badge: './icons/badge-96.png',  // monochrome status-bar glyph
    tag: 'plants-daily',
    renotify: true,
    vibrate: [80, 40, 80],
    data: { url },
  };
  if (payload.actions) {
    options.actions = [
      { action: 'open', title: 'Open' },
      { action: 'defer', title: 'This evening' },
    ];
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

// Worker endpoint for the defer action. Hardcoded here (not passed from the page)
// because when the app is closed the SW is killed and revived to handle the
// notification — any in-memory config from the page would be gone. The token is
// already a public client const; it only guards writes to Andy's own KV.
const WORKER_URL = 'https://plants.plants-andyb.workers.dev';
const PUSH_TOKEN = 'SuperSecretPlants837492!';
const VAPID_PUBLIC_KEY = 'BG3-MCSSCdyPhV__rDZtrOZryJUjC2qNEH8owW5hVy0dH4IO3TpFwRtUHKOhMvTqsJq1g16hvEjqw3ap-8knN4k';

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// The browser may rotate the push subscription; re-subscribe and re-register it
// with the worker even if the app is closed (the page-side sync can't run then).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      await fetch(`${WORKER_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PUSH_TOKEN}` },
        body: JSON.stringify(sub),
      });
    } catch {}
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'defer') {
    event.waitUntil(deferToWorker());
    return;
  }

  const scope = self.registration.scope; // https://…/plants/
  const rel = (event.notification.data && event.notification.data.url) || './?tab=today';
  const target = new URL(rel, scope).href;

  event.waitUntil((async () => {
    let info = `act=${event.action || 'body'}`;
    try {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      info += ` n=${all.length}`;
      all.forEach((c, i) => { info += ` [${i}]${c.visibilityState}/foc=${c.focused}/${c.url.startsWith(scope) ? 'in' : 'out'}`; });

      // Only focus a window that's actually visible — focus() is a silent no-op on
      // a backgrounded/closed PWA here. Otherwise openWindow, which foregrounds the
      // existing installed PWA (or launches it). Deep-link first, then bare scope
      // root (exact start_url) as a fallback; Today is the default tab anyway.
      const visible = all.find((c) => c.url.startsWith(scope) && c.visibilityState === 'visible');
      if (visible) {
        await visible.focus();
        if ('navigate' in visible) { try { await visible.navigate(target); } catch {} }
        info += ' focusedVisible';
      } else {
        let win = await self.clients.openWindow(target);
        info += ` open1=${win ? 'ok' : 'null'}`;
        if (!win) { win = await self.clients.openWindow(scope); info += ` open2=${win ? 'ok' : 'null'}`; }
      }
    } catch (e) {
      info += ` ERR=${e.name}:${(e.message || '').slice(0, 50)}`;
    }
    // Temporary always-on diagnostic so we can see the path taken on-device.
    try { await self.registration.showNotification('diag', { body: info, tag: 'plants-diag', icon: './icons/icon-192.png' }); } catch {}
  })());
});

async function deferToWorker() {
  try {
    await fetch(`${WORKER_URL}/defer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PUSH_TOKEN}` },
    });
  } catch {}
}
