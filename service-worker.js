// Bump CACHE_VERSION whenever shell files change so updates roll cleanly.
const CACHE_VERSION = 'v0.9.1';
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './?tab=today';

  if (event.action === 'defer') {
    // Fire-and-forget defer to the worker; config is injected at install via the
    // page (postMessage) — fall back to silently closing if not configured.
    event.waitUntil(deferToWorker());
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) { client.navigate?.(url); return client.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});

// The page hands the worker URL + bearer token to the SW so notificationclick
// (which runs with no page open) can POST /defer.
let WORKER_CFG = null;
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'worker-config') WORKER_CFG = event.data.config;
});

async function deferToWorker() {
  if (!WORKER_CFG?.url || !WORKER_CFG?.token) return;
  try {
    await fetch(`${WORKER_CFG.url}/defer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WORKER_CFG.token}` },
    });
  } catch {}
}
