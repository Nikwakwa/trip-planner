/* Service worker: keeps a copy of the app on the phone so it opens offline.
   Strategy: show the saved copy instantly, and quietly fetch a fresh copy
   in the background (when online) for next time. */

const CACHE = 'trip-planner-v9';
const TILES = 'trip-planner-map-tiles';   // map images you've viewed, kept across versions
const MAX_TILES = 800;                     // roughly 15 MB at most
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'firebase-config.js',
  'guides.js',
  'places.js',
  'weather.js',
  'hours.js',
  'essentials.js',
  'maps.js',
  'drag.js',
  'sync.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
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
    for (const key of await caches.keys()) if (key !== CACHE && key !== TILES) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Map images: reuse ones already viewed (so maps work offline), fetch the rest.
let tilesAdded = 0;
async function mapTile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      if (++tilesAdded % 25 === 0) {
        const keys = await cache.keys();       // oldest first
        for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
      }
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(mapTile(req));
    return;
  }
  // Firebase (sign-in and sync) talks to Google's servers directly and handles being offline itself.
  // Only handle this app's own files; links to Google Maps etc. go straight to the internet.
  if (url.origin !== self.location.origin) return;

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
