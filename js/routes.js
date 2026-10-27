'use strict';

/* =========================================================
   Road routes: by car, the real way between a day's stops, in place of the estimate from the
   straight line (far off where the road winds around a valley or has to find a bridge).
   Asked from OpenStreetMap's routing server (run by FOSSGIS: free, no key), one question for a
   whole day, then saved on the device. Only by car: there is no free service for public transit,
   and a short walk stays an estimate.
   Functions here also use the screen's files (ui.js … app.js), which load after this one.
   ========================================================= */

const ROUTES_KEY = 'tripPlanner.routes';
const ROUTER = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';
const ROUTES_MAX = 600;              // legs kept on the device
const ROUTES_MAX_AGE = 90 * 864e5;   // roads change slowly
const ROUTE_SNAP = 1500;             // meters: a stop further than this from any road is not reached by car

const roadRoutes = {
  // "lat,lng>lat,lng" → { m: meters by road, s: seconds, t: when it was saved } or { none: true, t } (no road)
  saved: (() => { try { return JSON.parse(localStorage.getItem(ROUTES_KEY)) || {}; } catch { return {}; } })(),
  pending: new Set(),
  chain: Promise.resolve(),
  last: 0,
  retryAt: 0,           // after a failed request, wait a few minutes before asking again
};

const roadSpot = p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
const roadKey = (a, b) => `${roadSpot(a)}>${roadSpot(b)}`;
const fmtRoadTime = m => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);

// The travel between two stops: by car the real road, once it is known; else the estimate (travel, in core.js).
function legTravel(a, b, mode) {
  const t = travel(miles(a, b), mode);
  const road = t.mode === 'driving' && roadRoutes.saved[roadKey(a, b)];
  if (!road || road.none) return t;
  const mins = Math.max(5, Math.round(road.s / 60 / 5) * 5);
  return { ...t, mins, dist: road.m / 1609.34, road: true, text: T('{time} drive', { time: fmtRoadTime(mins) }) };
}

// The server's answer for a row of stops → what to save for each leg between them.
function readRoads(points, data) {
  const legs = data && data.code === 'Ok' && data.routes && data.routes[0] && data.routes[0].legs;
  if (!Array.isArray(legs) || legs.length !== points.length - 1) return null;
  const off = (data.waypoints || []).map(w => (w && typeof w.distance === 'number' ? w.distance : 0));
  const t = Date.now();
  return legs.map((leg, k) => {
    const ok = typeof leg.distance === 'number' && typeof leg.duration === 'number'
      && !(off[k] > ROUTE_SNAP) && !(off[k + 1] > ROUTE_SNAP);
    return [roadKey(points[k], points[k + 1]), ok ? { m: Math.round(leg.distance), s: Math.round(leg.duration), t } : { none: true, t }];
  });
}

function saveRoads(found) {
  for (const [key, road] of found) roadRoutes.saved[key] = road;
  const keys = Object.keys(roadRoutes.saved).sort((a, b) => roadRoutes.saved[b].t - roadRoutes.saved[a].t);
  for (const old of keys.slice(ROUTES_MAX)) delete roadRoutes.saved[old];
  try { localStorage.setItem(ROUTES_KEY, JSON.stringify(roadRoutes.saved)); } catch { /* storage full */ }
}

// One question to the routing server (at most one a second): the way by car through these stops.
function askRoads(points) {
  const keys = points.slice(1).map((p, k) => roadKey(points[k], p));
  keys.forEach(k => roadRoutes.pending.add(k));
  roadRoutes.chain = roadRoutes.chain.then(async () => {
    let split = false;
    try {
      if (!navigator.onLine || Date.now() < roadRoutes.retryAt) return;
      const waitMs = roadRoutes.last + 1100 - Date.now();
      if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
      roadRoutes.last = Date.now();
      const res = await fetch(`${ROUTER}${points.map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';')}?overview=false`);
      // 400 is the server's "no route between these" (an island, a place no road reaches).
      if (!res.ok && res.status !== 400) throw new Error('route ' + res.status);
      const found = readRoads(points, await res.json());
      if (found) saveRoads(found);
      // No way through all of them: each leg is asked on its own, and the one without a road is noted.
      else if (points.length > 2) split = true;
      else saveRoads([[keys[0], { none: true, t: Date.now() }]]);
      renderSoon();
    } catch (err) {
      console.warn('No road route', err);
      roadRoutes.retryAt = Date.now() + 5 * 60e3;
    } finally {
      keys.forEach(k => roadRoutes.pending.delete(k));
      if (split) points.slice(1).forEach((p, k) => askRoads([points[k], p]));
    }
  });
}

// Asks for the road between the stops of each day that is done by car, where it isn't known yet.
// Called while the Plan is drawn; the answer redraws it.
function lookupRoads(trip) {
  if (!state.settings.lookup || !navigator.onLine || Date.now() < roadRoutes.retryAt) return;
  const guide = guideFor(trip);
  for (const day of tripDays(trip)) {
    if (modeFor(trip, day) !== 'drive') continue;
    const located = dayItems(trip, day).map(it => ({ it, c: coordsOf(it, guide) })).filter(s => s.c);
    const points = withBase(trip, day, located).slice(0, 40);
    const missing = points.some((p, k) => {
      if (!k || travel(miles(points[k - 1], p), 'drive').mode !== 'driving') return false;
      const key = roadKey(points[k - 1], p);
      const had = roadRoutes.saved[key];
      return !(had && Date.now() - had.t < ROUTES_MAX_AGE) && !roadRoutes.pending.has(key);
    });
    if (missing) askRoads(points);
  }
}
