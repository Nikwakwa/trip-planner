/* Service worker: keeps a copy of the app on the phone so it opens offline.
   Strategy: show the saved copy instantly, and quietly fetch a fresh copy
   in the background (when online) for next time. */

const CACHE = 'trip-planner-v4';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'guides.js',
  'manifest.webmanifest',
  'fonts/google-sans-flex.woff2',
  'icons/sprite.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

// First visit or new version: save every app file.
// cache: 'reload' skips the browser's short-term copy (GitHub Pages keeps files
// for 10 minutes), so a new version really stores the newest files.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(url => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

// New version: throw away older saved copies.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle this app's own files; links to Google Maps etc. go straight to the internet.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    // 'no-cache' = always check with the server (cheap when nothing changed).
    const fresh = fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => undefined);

    if (cached) {
      event.waitUntil(fresh);
      return cached;
    }
    const res = await fresh;
    if (res) return res;
    // No connection and this page isn't saved: show the app itself.
    if (req.mode === 'navigate') {
      const app = await cache.match('./');
      if (app) return app;
    }
    return new Response('Offline and not saved yet.', { status: 503 });
  })());
});
