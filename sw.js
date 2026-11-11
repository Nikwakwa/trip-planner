/* Service worker: keeps a copy of the app on the phone so it opens offline.
   Strategy: show the saved copy instantly, and quietly fetch a fresh copy
   in the background (when online) for next time. */

importScripts('js/version.js');             // APP_VERSION: a new number makes phones fetch the new files
const CACHE = 'trip-planner-v' + APP_VERSION;
const TILES = 'trip-planner-map-tiles';   // map images you've viewed, kept across versions
const LIBRARIES = 'trip-planner-libs';     // the big libraries (LIBS), kept across versions
const MAX_TILES = 900;                     // map pieces kept, roughly 40 MB at most
const FILES = [
  './',
  'index.html',
  'css/base.css',
  'css/components.css',
  'css/shell.css',
  'css/plan.css',
  'css/ideas.css',
  'css/checklist.css',
  'css/map.css',
  'css/sheets.css',
  'css/desktop.css',
  'firebase-config.js',
  // The code: the same files as index.html loads (the self-check compares the two lists).
  'js/theme.js',
  'js/version.js',
  'js/i18n.js',
  'js/lang/fr.js',
  'js/core.js',
  'js/places.js',
  'js/weather.js',
  'js/hours.js',
  'js/essentials.js',
  'js/mapstyle.js',
  'js/maps.js',
  'js/routes.js',
  'js/drag.js',
  'js/today.js',
  'js/calendar.js',
  'js/files.js',
  'js/packing.js',
  'js/info.js',
  'js/assistant.js',
  'js/meals.js',
  'js/translate.js',
  'js/vote.js',
  'js/share.js',
  'js/sync.js',
  'js/ui.js',
  'js/guide.js',
  'js/store.js',
  'js/render.js',
  'js/view-plan.js',
  'js/view-ideas.js',
  'js/view-checklist.js',
  'js/view-settings.js',
  'js/form-plan.js',
  'js/form-trip.js',
  'js/archive.js',
  'js/account.js',
  'js/sheets.js',
  'js/backup.js',
  'js/about.js',
  'js/pad.js',
  'js/app.js',
  'js/selfcheck.js',                        // only loaded with "?selfcheck", but it has to match the saved app
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'manifest.webmanifest',
  'fonts/google-sans-flex.woff2',
  'icons/sprite.svg',
  'icons/logo.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];
// The big libraries: the detailed map, and sign-in and sync. Saved too, so they are there offline
// even if they were never used while online. The app still installs if one can't be fetched.
// They are 2.5 MB and hardly ever change, so they have a saved copy of their own that a new version of the
// app keeps: downloading and writing them again at each update slowed the next start. Like the other files,
// one is saved again when the server's copy has changed.
const LIBS = [
  'vendor/maplibre/maplibre-gl.mjs',
  'vendor/maplibre/maplibre-gl-worker.mjs',
  'vendor/maplibre/maplibre-gl.css',
  'vendor/maplibre/leaflet-maplibre-gl.js',
  'vendor/firebase/firebase-app-compat.js',
  'vendor/firebase/firebase-auth-compat.js',
  'vendor/firebase/firebase-firestore-compat.js',
  'vendor/firebase/firebase-app-check-compat.js',
];

// First visit or new version: save every app file.
// cache: 'reload' skips the browser's short-term copy (GitHub Pages keeps files
// for 10 minutes), so a new version really stores the newest files.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES.map(url => new Request(url, { cache: 'reload' })));
    const libs = await caches.open(LIBRARIES);
    await Promise.all(LIBS.map(async (url) => {
      if (await libs.match(url)) return;
      // The copy a version before 2.31.2 kept with its own files, else the internet.
      const had = await caches.match(url);
      await (had ? libs.put(url, had) : libs.add(url)).catch(() => {});
    }));
    await self.skipWaiting();
  })());
});

// New version: throw away older saved copies.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![CACHE, TILES, LIBRARIES].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Map data: reuse what was already viewed (so maps work offline), fetch the rest.
// fresh: ask the internet first (the map's style and index change now and then), the saved copy when offline.
const FRESH_WAIT = 2500;                   // how long a saved copy waits for a fresher one
let tilesAdded = 0;
async function mapTile(event, fresh = false) {
  const req = event.request;
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit && !fresh) return hit;
  const online = (async () => {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      if (++tilesAdded % 25 === 0) {
        const keys = await cache.keys();       // oldest first
        for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
      }
    }
    return res;
  })();
  if (!hit) return online.catch(() => new Response('', { status: 504 }));
  // A saved copy is there: it is used when the internet answers with an error, or on a connection that
  // hardly moves, after a short wait (the fresher one is still saved when it arrives, for next time).
  event.waitUntil(online.catch(() => {}));
  return Promise.race([online.then(res => (res.ok ? res : hit)), new Promise(resolve => setTimeout(resolve, FRESH_WAIT, hit))]).catch(() => hit);
}

// The app's saved copies, each opened once while the worker runs.
const opened = new Map();
function openCache(name) {
  if (!opened.has(name)) opened.set(name, caches.open(name).catch((e) => { opened.delete(name); throw e; }));
  return opened.get(name);
}
const libPaths = new Set(LIBS.map(url => new URL(url, self.location).pathname));

// The saved copy is the file the server has now: same ETag, or else same date and size (GitHub Pages sends both).
function sameFile(saved, res) {
  if (!saved) return false;
  const h = name => [saved.headers.get(name), res.headers.get(name)];
  const [e1, e2] = h('etag');
  if (e1 || e2) return !!e1 && e1 === e2;
  const [m1, m2] = h('last-modified');
  const [l1, l2] = h('content-length');
  return !!m1 && m1 === m2 && l1 === l2;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // The vector map (OpenFreeMap): its style and index fresh when online, its data and fonts reused.
  if (url.hostname === 'tiles.openfreemap.org') {
    event.respondWith(mapTile(event, url.pathname.startsWith('/styles/') || url.pathname === '/planet'));
    return;
  }
  if (url.hostname.endsWith('.basemaps.cartocdn.com') || url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(mapTile(event));
    return;
  }
  // Firebase (sign-in and sync) talks to Google's servers directly and handles being offline itself.
  // Only handle this app's own files; links to Google Maps etc. go straight to the internet.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await openCache(libPaths.has(url.pathname) ? LIBRARIES : CACHE);
    // Files are saved under their plain address, so it is looked up as is: with ignoreSearch the browser
    // reads every saved entry for each file, some 4000 reads from the phone's storage at each start.
    const cached = await cache.match(url.search ? url.origin + url.pathname : req);

    // 'no-cache' = always check with the server (cheap when nothing changed).
    const fresh = fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }).then(async (res) => {
      // Saved again only when the file really changed. Rewriting every file at every start kept the phone's
      // storage busy while the app was reading its own files from it (the long blue screen at startup), and
      // threw away the compiled code the browser keeps next to each script.
      // Saved under the plain address: "?fresh=24" and the like would pile up as separate copies.
      if (res.ok && !sameFile(cached, res)) await cache.put(url.search ? url.origin + url.pathname : req, res.clone());
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
      const app = await (await openCache(CACHE)).match('./');
      if (app) return app;
    }
    return new Response('Offline and not saved yet.', { status: 503 });
  })());
});
