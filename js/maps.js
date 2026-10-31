'use strict';

/* =========================================================
   Maps, route optimizing and address lookup.
   Uses OpenStreetMap data: map images (tiles, drawn by CARTO) and address search (Nominatim).
   The map library (Leaflet) is stored in the app and loaded on first use.
   Functions here also use the screen's files (ui.js … app.js), which load after this one.
   ========================================================= */

// Map images. With a CARTO key (firebase-config.js; free for personal use): CARTO's clean styles drawn
// from OpenStreetMap data, a light and a dark one, following the app's theme ({r} asks for sharper
// images on high-resolution screens). Without a key: the standard OpenStreetMap map, darkened by CSS in dark mode.
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const cartoKey = () => window.CARTO_KEY || '';
const mapTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
function tileUrl(theme) {
  if (!cartoKey()) return OSM_TILES;
  const style = theme === 'dark' ? 'dark_all' : 'rastertiles/voyager';
  return `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoKey())}`;
}
const DAY_HUES = [25, 250, 145, 300, 60, 200, 340, 100];

/* ---------- Plan order ----------
   Plans with a time sort by time. Plans without a time can carry a "slot"
   (set by Optimize route), e.g. "12:30~01" = first stop after the 12:30 plan.
   Plans with neither go in the afternoon, after the plans until 17:00: a sight without a time
   used to come after an 8 PM dinner, and the day's route went there and back. */
const orderKey = it => it.time || it.slot || '17:00~~';
function byPlanOrder(a, b) {
  const x = orderKey(a), y = orderKey(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
function dayItems(trip, day) {
  return trip.items.filter(i => i.date === day).sort(byPlanOrder);
}

/* ---------- Address lookup (OpenStreetMap Nominatim) ---------- */

const geoPending = new Set();
let geoChain = Promise.resolve();
let geoLast = 0;

// "476 Fifth Avenue" → "476 5th Avenue", for an address with a house number: OpenStreetMap's search only
// knows the numbered streets of American towns by their number.
const ORDINALS = { first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th', eleventh: '11th', twelfth: '12th' };
function numbered(place) {
  const [first, ...rest] = String(place || '').split(',');
  if (!/^\s*\d/.test(first)) return place;
  return [first.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\b(?=\s+(avenue|ave|street|st)\b)/gi, w => ORDINALS[w.toLowerCase()]), ...rest].join(',');
}

// Once after "476 Fifth Avenue" started being searched as "476 5th Avenue" (the library was pinned 3 miles
// up Fifth Avenue): such plans are looked up again. A pin only moves when the house itself is found
// somewhere else, so a plan that was right stays where it is.
function repinNumbered() {
  if (state.settings.geoRetry >= 6 || !state.settings.lookup || !navigator.onLine) return;
  const todo = state.trips.flatMap(trip => trip.items
    .filter(i => typeof i.lat === 'number' && typeof i.lng === 'number' && !i.guideId && numbered(i.place) !== i.place)
    .map(item => ({ tripId: trip.id, id: item.id, place: item.place, where: trip.place ? trip.place.label : trip.name })));
  geoChain = geoChain.then(async () => {
    let moved = false;
    for (const { tripId, id, place, where } of todo) {
      const waitMs = geoLast + 1100 - Date.now();
      if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
      geoLast = Date.now();
      const q = norm(place).includes(norm(where)) ? numbered(place) : `${numbered(place)}, ${where}`;
      const res = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ format: 'jsonv2', limit: '5', q, 'accept-language': 'en' }));
      if (!res.ok) throw new Error('lookup ' + res.status);
      const answer = await res.json();
      // Found again now: an answer from the account may have replaced the plans while waiting.
      const trip = state.trips.find(t => t.id === tripId);
      const item = trip && trip.items.find(i => i.id === id);
      if (!item || item.place !== place || typeof item.lat !== 'number') continue;
      const around = plansAround(item, trip);
      const sameDay = around.filter(i => i.date === item.date);
      const close = sameDay.length ? sameDay : around;
      const far = p => (close.length ? Math.min(...close.map(i => miles(i, p))) : 0);
      const found = answer
        .filter(f => f.category !== 'highway' && f.addresstype !== 'road')
        .map(f => ({ lat: Number(f.lat), lng: Number(f.lon) }))
        .filter(p => !around.length || around.some(i => miles(i, p) < AROUND_REACH))
        .sort((a, b) => far(a) - far(b))[0];
      if (found && miles(item, found) > 0.2) {
        item.lat = found.lat;
        item.lng = found.lng;
        moved = true;
      }
    }
    state.settings.geoRetry = 6;
    if (moved) { save(); renderSoon(); } else saveLocal();
  }).catch(() => { /* no connection: at the next start */ });
}

// A plan with an address is looked up, also when its name is a place in the guide: the address says
// where it is, the name doesn't (a "Residenz" in the guide can be another town's).
function needsLookup(item) {
  return item.place && typeof item.lat !== 'number' && !item.geoMiss;
}

// Looks up plans that have an address but no map position, one per second
// (OpenStreetMap's rule for its free search service).
function lookupMissing(trip, items) {
  if (!state.settings.lookup || !navigator.onLine) return;
  const guide = guideFor(trip);
  for (const item of items) {
    if (!needsLookup(item) || geoPending.has(item.id)) continue;
    geoPending.add(item.id);
    geoChain = geoChain.then(async () => {
      const city = trip.place ? trip.place.name : guide ? guide.city : trip.name;
      const where = trip.place ? trip.place.label : city;
      // A full address ("…, 1200-359 Lisboa, Portugal") is searched as written first; a short
      // one ("Castelo") with the trip's city added. The first answer near the trip counts.
      // "476 Fifth Avenue" is only found as "476 5th Avenue": with the word, the search answers with the
      // street alone, and the pin lands miles along it.
      const addr = numbered(item.place);
      const tries = norm(addr).includes(norm(city)) || !addr.includes(',')
        ? [norm(addr).includes(norm(city)) ? addr : `${addr}, ${where}`]
        : [addr, `${addr}, ${where}`];
      const fits = nearTrip(trip, guide);
      // One question to OpenStreetMap's address search (at most one a second). box: only inside it.
      const ask = async (q, box) => {
        const waitMs = geoLast + 1100 - Date.now();
        if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
        geoLast = Date.now();
        const params = new URLSearchParams({ format: 'jsonv2', limit: '5', q, 'accept-language': 'en' });
        if (box) { params.set('viewbox', box.join(',')); params.set('bounded', '1'); }
        else if (trip.place && trip.place.bbox) params.set('viewbox', trip.place.bbox.join(','));
        const res = await fetch('https://nominatim.openstreetmap.org/search?' + params);
        if (!res.ok) throw new Error('lookup ' + res.status);
        const all = (await res.json()).map(f => ({
          lat: Number(f.lat), lng: Number(f.lon),
          area: (f.boundingbox || []).map(Number),      // what was found reaches from south to north, west to east
          // Asked for a house number ("9 West Street", "Hauptstraße 52") but only the street was found:
          // the pin could be miles along it.
          street: /^\s*\d|\s\d+\s?[a-z]?\s*$/i.test(q.split(',')[0]) && (f.category === 'highway' || f.addresstype === 'road'),
        }));
        if (!all.length) return null;
        // The same address can exist in several places ("117 MacDougal St, New York" is in Brooklyn and
        // in Manhattan): the one nearest the plans around it comes first, and the others are kept as "rivals".
        const exact = all.filter(p => !p.street && fits(p));
        const far = p => (close.length ? Math.min(...close.map(i => miles(i, p))) : 0);
        // Only the street was found, in several stretches: the one nearest those plans.
        if (!exact.length) return all.filter(fits).sort((a, b) => far(a) - far(b))[0] || all[0];
        if (exact.length < 2) return exact[0];
        exact.sort((a, b) => far(a) - far(b));
        return { ...exact[0], rivals: exact.slice(1).filter(p => miles(p, exact[0]) > 0.1) };
      };
      // The plans around it (the day before to the day after) that are on the map: a looser search
      // can answer with a place of the same name far away, so its answer has to be near them.
      const around = plansAround(item, trip);
      const plausible = p => fits(p) && (!around.length || around.some(i => miles(i, p) < AROUND_REACH));
      // The closest of them: the plans of its own day, when some are on the map.
      const sameDay = around.filter(i => item.date && i.date === item.date);
      const close = sameDay.length ? sameDay : around;
      // A short address on a trip across a country ("Hauptbahnhof", "Marktplatz 3") exists in every town:
      // it is first looked for around those plans.
      const pad = 0.3;      // degrees: some 20 miles
      const nearby = close.length && !item.place.includes(',') && !(trip.place && trip.place.kind === 'city')
        ? [Math.min(...close.map(i => i.lng)) - pad, Math.min(...close.map(i => i.lat)) - pad,
          Math.max(...close.map(i => i.lng)) + pad, Math.max(...close.map(i => i.lat)) + pad]
        : null;
      // A looser search (Photon): it copes with "Near …" and odd spellings, but the house number must be the one asked for.
      const askLoosely = async (q) => {
        const params = new URLSearchParams({ q, limit: '1', lang: 'en' });
        const by = around[0] || (trip.place && trip.place.kind === 'city' ? trip.place : null);
        if (by) { params.set('lat', by.lat); params.set('lon', by.lng); }
        const res = await fetch('https://photon.komoot.io/api/?' + params);
        if (!res.ok) return null;
        const f = (await res.json()).features[0];
        const number = /^\s*(\d[\w-]*)\s/.exec(q);
        if (!f || (number && norm(f.properties.housenumber) !== norm(number[1]))) return null;
        return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
      };
      const inCity = q => (trip.place && trip.place.kind === 'city' && !norm(q).includes(norm(city)) ? `${q}, ${where}` : q);
      try {
        let hit = null;
        let street = null; // only the street of the address: kept in case nothing better turns up
        for (const q of tries) {
          const found = (nearby && await ask(q, nearby)) || await ask(q);
          if (found && (tries.length === 1 || fits(found))) {
            if (!found.street) { hit = found; break; }
            street = street || found;
          }
        }
        // Several places with that address: the one where the plan's own name is found ("Comedy Cellar") is it.
        if (hit && hit.rivals && hit.rivals.length && !['food', 'transport'].includes(item.category) && norm(item.title) !== norm(item.place)) {
          const named = await ask(inCity(item.title)).catch(() => null);
          const same = named && !named.street && [hit, ...hit.rivals].find(p => miles(p, named) < 0.2);
          if (same) hit = same;
        }
        // Not found as written ("27-05 39th Avenue, Long Island City" is filed under Queens). Other ways:
        // the looser search, the place's name without its street ("Pier 86, Manhattan"), then the plan's own name.
        if (!hit) {
          const loose = await askLoosely(inCity(item.place)).catch(() => null);
          if (loose && plausible(loose)) hit = loose;
        }
        if (!hit) {
          const parts = item.place.split(',').map(s => s.trim()).filter(Boolean);
          const name = item.title.replace(/^check[ -]?(in|out)\s*:?\s*/i, '').trim();
          // "High Line at W 34th Street": the place itself, without where along it.
          const bare = q => q.split(/\s+(?:at|near)\s+/i)[0].trim();
          const head = q => q.split(/\s*[:(–—]\s*|\s+-\s+/)[0].trim();
          const others = [
            parts.length >= 3 && `${parts[0]}, ${parts[parts.length - 1]}`,
            !['food', 'transport'].includes(item.category) && norm(name) !== norm(item.place) && name,
            bare(parts[0] || '') !== parts[0] && bare(parts[0]),
            bare(name) !== name && norm(bare(name)) !== norm(bare(parts[0] || '')) && bare(name),
            // "New York Public Library: Rose Main Reading Room tour": the place, without what is done there.
            !['food', 'transport'].includes(item.category) && head(name) !== name && head(name),
          ].filter((q, i, all) => q && !all.slice(0, i).some(o => o && norm(o) === norm(q)));
          for (const q of others) {
            const found = await ask(inCity(q));
            if (found && !found.street && plausible(found)) { hit = found; break; }
          }
        }
        if (!hit && street) hit = street;
        // The address is a whole town or a park ("Munich", "Englischer Garten") and the plan is named after
        // a place of the guide inside it: that place is the spot.
        const [south, north, west, east] = (hit && hit.area) || [];
        const named = hit && matchPlaces({ title: item.title, place: item.place, date: item.date }, guide, trip)
          .find(p => p.lat >= south && p.lat <= north && p.lng >= west && p.lng <= east);
        if (named) hit = named;
        if (hit) {
          item.lat = hit.lat;
          item.lng = hit.lng;
        } else {
          item.geoMiss = true;
        }
        save();
        renderSoon();      // not while something is being typed in the page (the lookups can take a while)
      } catch {
        // No connection: try again next time.
      } finally {
        geoPending.delete(item.id);
        if (mapShown()) refreshMap();
      }
    });
  }
}

/* ---------- Optimize route ---------- */

// Finds the shortest order for a day's stops. Stops with a set time keep their
// order; stops without a time are slotted in where they save the most distance.
function optimizeDay(trip, day) {
  const guide = guideFor(trip);
  const items = dayItems(trip, day);
  const pts = new Map();
  for (const it of items) {
    const c = coordsOf(it, guide);
    if (c) pts.set(it, c);
  }
  const located = items.filter(it => pts.has(it));
  if (located.length < 3) return { error: T('Optimizing needs at least 3 stops on the map.') };
  const timed = located.filter(it => it.time);
  const free = located.filter(it => !it.time);
  if (!free.length) return { error: T('Every stop has a set time, so the order is fixed. Clear a time to let the app move that stop.') };

  // With a hotel (today.js), the day starts and ends there; the route counts both ways.
  const ends = dayEnds(trip, day, items, guide);
  // Distance between two stops; a missing stop (null) is the hotel the day starts from (before the
  // first stop) or ends at (after the last one), or nothing without one.
  const dist = (a, b) => {
    if (!a && !b) return 0;
    const from = a ? pts.get(a) : ends.start && ends.start.c;
    const to = b ? pts.get(b) : ends.end && ends.end.c;
    return from && to ? miles(from, to) : 0;
  };
  const length = seq => seq.reduce((sum, it, k) => sum + dist(seq[k - 1] || null, it), 0) + (seq.length ? dist(seq[seq.length - 1], null) : 0);

  let best;
  if (located.length <= 10) {
    // Try every order (skipping ones that break the time order), keeping the shortest.
    let bestLen = Infinity;
    const used = new Set();
    const seq = [];
    const search = (len, nextTimed) => {
      if (len >= bestLen) return;
      if (seq.length === located.length) {
        const total = len + dist(seq[seq.length - 1], null);
        if (total < bestLen) { bestLen = total; best = seq.slice(); }
        return;
      }
      for (const it of located) {
        if (used.has(it)) continue;
        if (it.time && it !== timed[nextTimed]) continue;
        const add = dist(seq[seq.length - 1] || null, it);
        used.add(it); seq.push(it);
        search(len + add, it.time ? nextTimed + 1 : nextTimed);
        seq.pop(); used.delete(it);
      }
    };
    search(0, 0);
  } else {
    // Many stops: insert each untimed stop where it adds the least distance.
    best = timed.slice();
    for (const it of free) {
      let pos = 0, cost = Infinity;
      for (let p = 0; p <= best.length; p++) {
        const before = best[p - 1] || null, after = best[p] || null;
        const c = dist(before, it) + dist(it, after) - dist(before, after);
        if (c < cost) { cost = c; pos = p; }
      }
      best.splice(pos, 0, it);
    }
  }

  const saved = length(located) - length(best);
  if (saved < 0.02) return { error: T('This day is already in the shortest order.') };

  const undo = items.map(it => [it, it.slot]);
  let anchor = '00:00', n = 0;
  for (const it of best) {
    if (it.time) { anchor = it.time; n = 0; }
    else it.slot = `${anchor}~${String(++n).padStart(2, '0')}`;
  }
  return {
    message: T('Route optimized — {dist} less travel.', { dist: fmtDist(saved) }),
    undo: () => undo.forEach(([it, slot]) => { if (slot === undefined) delete it.slot; else it.slot = slot; }),
  };
}

/* ---------- Day tools (under each day's list) ---------- */

function dayToolsHTML(trip, day, items, guide) {
  const located = items.filter(it => coordsOf(it, guide));
  const fill = canAutoFill(day, guide)
    ? `<button type="button" class="assist-chip ripple" data-action="autofill" data-date="${day}">${icon('auto_awesome')}${T('Auto-fill day')}</button>` : '';
  if (!located.length) return fill ? `<div class="day-tools">${fill}</div>` : '';
  const canOptimize = located.length >= 3 && located.some(it => !it.time);
  // With 2+ stops there are travel times: this day can get around differently from the rest of the trip.
  const mode = TRAVEL_MODES[modeFor(trip, day)];
  const own = trip.dayTravel && trip.dayTravel[day];
  // The day's travel, from the stay and back (as on the map).
  const route = withBase(trip, day, located.map(it => ({ it, c: coordsOf(it, guide) })));
  const { total, time } = routeTravel(route, modeFor(trip, day));
  return `
    ${route.length > 1 ? `<p class="day-total">${icon('route', 'sm')}${T('{time} of travel', { time: esc(time) })} · ${esc(fmtDist(total))}</p>` : ''}
    <div class="day-tools">
      <button type="button" class="assist-chip ripple" data-action="day-map" data-date="${day}">${icon('map')}${T('Map')}</button>
      ${canOptimize ? `<button type="button" class="assist-chip ripple" data-action="optimize" data-date="${day}">${icon('route')}${T('Optimize route')}</button>` : ''}
      ${located.length >= 2 ? `<button type="button" class="assist-chip ripple ${own ? 'selected' : ''}" data-action="day-travel" data-date="${day}"
        aria-label="${T('Getting around this day: {mode}. Tap to switch', { mode: mode.label })}">${icon(mode.icon)}${own ? T('{mode} this day', { mode: mode.short }) : mode.short}</button>` : ''}
      ${fill}
    </div>`;
}

/* ---------- Map sheet ---------- */

let leafletLoading = null;
function loadLeaflet() {
  leafletLoading = leafletLoading || new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/leaflet/leaflet.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = 'vendor/leaflet/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => { leafletLoading = null; reject(new Error('map library failed to load')); };
    document.head.append(js);
  }).then(async (L) => {
    // The detailed vector map (mapstyle.js) is a bonus on top: if its library or style
    // can't load (offline the first time, an old browser), the picture map is used instead.
    try {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/maplibre/maplibre-gl.css';
      document.head.append(css);
      // MapLibre is a module (it fetches its worker from the file next to it); the bridge looks for it as maplibregl.
      window.maplibregl = await import(new URL('vendor/maplibre/maplibre-gl.mjs', document.baseURI).href);
      await loadScript('vendor/maplibre/leaflet-maplibre-gl.js');
      mapView.style = await loadMapStyle();
    } catch (e) {
      console.warn('Vector map unavailable, using the picture map', e);
      mapView.style = null;
    }
    mapView.ready = true;
    return L;
  });
  return leafletLoading;
}

const mapView = { day: null, map: null, layer: null, markers: new Map(), note: null };

// Resolves a theme color (e.g. var(--primary)) to a plain hex color for the map.
function cssColor(expr) {
  const probe = $('#theme-probe');
  probe.style.color = expr;
  const c = getComputedStyle(probe).color;
  probe.style.color = '';
  return toHex(c);
}
// Each day of a trip has its own color: its stop numbers in the plan, its pins and its route on the map.
const dayTint = i => `oklch(.6 .16 ${DAY_HUES[Math.max(0, i) % DAY_HUES.length]})`;
const dayColor = i => toHex(dayTint(i));

// The stops to show: one day, or every day of the trip ("all").
function mapGroups(trip) {
  const guide = guideFor(trip);
  const days = mapView.day === 'all' ? tripDays(trip) : [mapView.day];
  return days.map((day, i) => {
    const items = dayItems(trip, day);
    return {
      day,
      color: dayColor(mapView.day === 'all' ? i : tripDays(trip).indexOf(day)),
      stops: items.map(it => ({ it, c: coordsOf(it, guide) })),
    };
  });
}

// A day's stops for the route, starting and ending at the hotel when there is one (today.js);
// on the day of a move to another stay, from the one being left to the new one.
function withBase(trip, day, located) {
  const pts = located.map(s => s.c);
  if (!pts.length) return pts;
  const { start, end } = dayEnds(trip, day, located.map(s => s.it));
  const back = end && miles(pts[pts.length - 1], end.c) >= 0.05;     // not when the day's last stop is the stay
  return [...(start ? [start.c] : []), ...pts, ...(back ? [end.c] : [])];
}

// A route's travel, added up stop by stop: the way by road (miles) and the time (see travel in core.js).
function routeTravel(route, mode) {
  let total = 0, minutes = 0, guessed = 0;
  route.forEach((c, k) => {
    if (!k) return;
    const t = legTravel(route[k - 1], c, mode);      // routes.js: by car the real road, once it is known
    total += t.dist;
    minutes += t.mins;
    if (!t.road && t.mode !== 'walking') guessed++;
  });
  // Real roads add up to the minute; an estimate is only good to the half hour.
  const time = guessed ? fmtDuration(Math.round(minutes)) : fmtRoadTime(Math.round(minutes / 5) * 5);
  return { total, minutes, time };
}

function googleRouteUrl(points, mode) {
  const fmt = p => `${p.lat},${p.lng}`;
  const params = new URLSearchParams({ api: '1', origin: fmt(points[0]), destination: fmt(points[points.length - 1]) });
  const middle = points.slice(1, -1);
  if (middle.length) params.set('waypoints', middle.map(fmt).join('|'));
  const long = points.some((p, k) => k && travel(miles(points[k - 1], p), mode).mode !== 'walking');
  if (!long) params.set('travelmode', 'walking');
  else if (mode === 'drive') params.set('travelmode', 'driving');
  // Google Maps can't do transit with stops in between: it then picks the mode itself.
  else if (!middle.length) params.set('travelmode', 'transit');
  return 'https://www.google.com/maps/dir/?' + params;
}

/* ---------- Ideas on the map: a layer to switch on and off (Settings, per device) ----------
   An idea is a round pin with its type's icon, apart from the numbered stops, and its popup adds it to a day. */

const ideasLayerOn = () => state.settings.mapIdeas !== false;

// The ideas with a spot on the map, the ones the group likes most first (share.js).
function mapIdeas(trip) {
  const guide = guideFor(trip);
  return byHearts(trip, trip.items.filter(i => !i.date)).map(it => ({ it, c: coordsOf(it, guide) })).filter(s => s.c);
}

// The switch, over the map or on the docked map's card. None while no idea has a place.
function ideasToggleHTML(trip) {
  const n = mapIdeas(trip).length;
  if (!n) return '';
  const on = ideasLayerOn();
  return `<button type="button" class="assist-chip ideas-toggle ripple ${on ? 'selected' : ''}" data-action="map-ideas" aria-pressed="${on}"
    title="${on ? T('Hide ideas on the map') : T('Show ideas on the map')}">${icon('lightbulb')}${Tn(n, '{n} idea', '{n} ideas')}</button>`;
}

// What an idea's pin says: who likes it, how far it is from the day's stops, and the days it can go on.
function ideaPopupHTML(trip, s) {
  const guide = guideFor(trip);
  const cat = CATEGORIES[s.it.category] || CATEGORIES.other;
  const who = heartsOn(trip) ? heartsFor(trip, s.it.id) : [];
  let near = '';
  if (mapView.day !== 'all') {
    const stops = dayItems(trip, mapView.day).map(it => ({ it, c: coordsOf(it, guide) })).filter(x => x.c);
    const best = stops.map(x => ({ x, d: miles(x.c, s.c) })).sort((a, b) => a.d - b.d)[0];
    if (best) near = T('{dist} from {name}', { dist: fmtDist(best.d), name: best.x.it.title });
  }
  const days = mapView.day === 'all' ? tripDays(trip) : [mapView.day];
  const add = days.length === 1
    ? `<button type="button" class="btn filled ripple" data-action="map-add-idea" data-date="${days[0]}">${icon('add')}${T('Add to {day}', { day: esc(fmtDay(days[0], { weekday: 'long' })) })}</button>`
    : days.length ? `<p class="pop-label">${T('Add to a day')}</p><div class="pop-days">${days.map(d => `
        <button type="button" class="assist-chip ripple" data-action="map-add-idea" data-date="${d}">${esc(fmtDay(d, { weekday: 'short', day: 'numeric' }))}</button>`).join('')}</div>` : '';
  return `<div class="idea-pop" data-id="${esc(s.it.id)}">
    <p class="pop-over">${icon('lightbulb')}${T('Idea')} · ${esc(cat.label)}</p>
    <strong>${esc(s.it.title)}</strong>
    ${s.it.place && norm(s.it.place) !== norm(s.it.title) ? `<p class="pop-line">${esc(s.it.place)}</p>` : ''}
    ${who.length ? `<p class="pop-line hearts">${icon('favorite-fill')}${esc(heartNames(trip, who))}</p>` : ''}
    ${near ? `<p class="pop-line">${icon('near_me')}${esc(near)}</p>` : ''}
    ${add}
  </div>`;
}

/* On a wide window the map isn't a sheet: it stays docked on the right of the Plan tab,
   and "opening" a map just points it at that day. The same map element moves between the two. */
const dockQuery = matchMedia('(min-width: 1200px)');
const mapDocked = () => dockQuery.matches && ui.view === 'plan' && !!activeTrip();
const mapShown = () => $('#map-dialog').open || mapDocked();
// The window got wider or narrower: dock or undock the map if needed.
function checkMapDock() {
  if (mapDocked() !== document.body.classList.contains('has-map')) render();
}
dockQuery.addEventListener('change', checkMapDock);
window.addEventListener('resize', checkMapDock);

// Called after every render (render.js): shows or hides the docked map, and keeps it up to date.
function syncMapDock() {
  const docked = mapDocked();
  const el = $('#map');
  const slot = $('#map-slot');
  document.body.classList.toggle('has-map', docked);
  $('#map-pane').hidden = !docked;
  let moved = false;
  if (docked && el.parentNode !== slot) { slot.append(el); moved = true; }
  if (!docked && el.parentNode === slot) { $('#map-dialog').insertBefore(el, $('#map-body')); moved = true; }
  if (!docked) {
    if (moved && mapView.map) mapView.map.invalidateSize();
    return;
  }
  const trip = activeTrip();
  const days = tripDays(trip);
  // A new trip, or a day that no longer exists: today's route during the trip, otherwise the whole trip.
  if (mapView.tripId !== trip.id || (mapView.day !== 'all' && !days.includes(mapView.day))) {
    const today = todayISO();
    mapView.day = days.includes(today) && dayItems(trip, today).some(it => coordsOf(it, guideFor(trip))) ? today : 'all';
  }
  mapView.tripId = trip.id;
  renderMapPane();
  const view = `${trip.id}|${mapView.day}`;
  const fit = moved || mapView.fitted !== view;      // otherwise keep where the user has panned to
  mapView.fitted = view;
  loadLeaflet().then(() => {
    if (!mapDocked()) return;
    if (moved && mapView.map) mapView.map.invalidateSize();
    drawMap(fit);
  }).catch(() => {
    el.innerHTML = `<div class="map-empty">${icon('location_off')}${T('The map couldn’t load. Check your connection.')}</div>`;
  });
}

// The card over the docked map: which day it shows, and what can be done with it.
function renderMapPane() {
  const trip = activeTrip();
  const groups = mapGroups(trip);
  if (mapView.day === 'all') {
    const count = groups.reduce((n, g) => n + g.stops.filter(s => s.c).length, 0);
    $('#pane-title').textContent = T('All days');
    $('#pane-sub').textContent = count ? `${Tn(count, '{n} stop', '{n} stops')} · ${T('pick a day to see its route')}` : T('Plans with a place appear here');
    $('#pane-actions').innerHTML = ideasToggleHTML(trip) + groups.filter(g => g.stops.some(s => s.c)).map(g => `
      <button type="button" class="assist-chip ripple" data-action="day-map" data-date="${g.day}">
        <span class="legend-dot" style="background:${g.color}"></span>${esc(fmtDay(g.day, { weekday: 'short', day: 'numeric' }))}
      </button>`).join('');
    return;
  }
  const g = groups[0];
  const located = g.stops.filter(s => s.c);
  // The day's journey, from the stay and back to it when there is one.
  const route = withBase(trip, g.day, located);
  const { total, time } = routeTravel(route, modeFor(trip, g.day));
  $('#pane-title').textContent = fmtDay(g.day, { weekday: 'long', month: 'short', day: 'numeric' });
  $('#pane-sub').textContent = route.length > 1
    ? `${Tn(located.length, '{n} stop', '{n} stops')} · ${fmtDist(total)} · ${T('{time} of travel', { time })}`
    : Tn(located.length, '{n} stop on the map', '{n} stops on the map');
  $('#pane-actions').innerHTML = `
    <button type="button" class="assist-chip ripple" data-action="trip-map">${icon('map')}${T('All days')}</button>
    ${ideasToggleHTML(trip)}
    ${located.length >= 3 && located.some(s => !s.it.time) ? `<button type="button" class="assist-chip ripple" data-action="optimize" data-date="${g.day}">${icon('route')}${T('Optimize route')}</button>` : ''}
    ${located.length >= 2 ? `<a class="assist-chip ripple" href="${esc(googleRouteUrl(withBase(trip, g.day, located), modeFor(trip, g.day)))}" target="_blank" rel="noopener">${icon('directions')}${T('Google Maps')}</a>` : ''}`;
}

// A pin was clicked on the docked map: show its plan in the list.
function showPlanInList(id) {
  const el = document.querySelector(`#view-plan .item[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash');
  void el.offsetWidth;            // restart the highlight if it's still running
  el.classList.add('flash');
}

function openMap(day) {
  mapView.day = day;
  mapView.note = null;
  syncMapDock();                 // makes sure the map element is where it should be
  if (mapDocked()) return;
  const dlg = $('#map-dialog');
  if (!dlg.open) dlg.showModal();
  refreshMap();
  const trip = activeTrip();
  lookupMissing(trip, day === 'all' ? trip.items.filter(i => i.date) : dayItems(trip, day));
  loadLeaflet().then(() => {
    setTimeout(() => {
      if (mapView.map) mapView.map.invalidateSize();
      drawMap(true);
    }, 0);
  }).catch(() => {
    $('#map').innerHTML = `<div class="map-empty">${icon('location_off')}${T('The map couldn’t load. Check your connection.')}</div>`;
  });
}

function refreshMap() {
  if (mapDocked()) renderMapPane(); else renderMapBody();
  drawMap(false);
}

function renderMapBody() {
  const trip = activeTrip();
  const groups = mapGroups(trip);
  const pending = groups.some(g => g.stops.some(s => geoPending.has(s.it.id)));
  // Above the list: what was just done (with Undo), and the switch for the ideas.
  const toggle = ideasToggleHTML(trip);
  const top = `${mapView.note ? `
      <div class="map-note" role="status">
        <span>${esc(mapView.note.text)}</span>
        ${mapView.note.undo ? `<button type="button" class="btn text ripple" data-action="undo-optimize">${T('Undo')}</button>` : ''}
      </div>` : ''}${toggle ? `<div class="map-layers">${toggle}</div>` : ''}`;

  if (mapView.day === 'all') {
    const count = groups.reduce((n, g) => n + g.stops.filter(s => s.c).length, 0);
    $('#map-title').textContent = `${trip.name} · ${T('All days')}`;
    $('#map-sub').textContent = pending ? T('Finding places on the map…') : Tn(count, '{n} stop on the map', '{n} stops on the map');
    $('#map-body').innerHTML = `
      ${top}
      <div class="legend">
        ${groups.map((g) => {
          // The same day numbers as in the plan (a day outside the trip's dates has none).
          const inTrip = trip.start && g.day >= trip.start && g.day <= trip.end;
          return `
          <button type="button" class="assist-chip ripple" data-action="day-map" data-date="${g.day}">
            <span class="legend-dot" style="background:${g.color}"></span>${inTrip ? `${T('Day {n}', { n: daysBetween(trip.start, g.day) + 1 })} · ` : ''}${esc(fmtDay(g.day, { weekday: 'short', day: 'numeric' }))}
          </button>`;
        }).join('')}
      </div>
      ${count ? '' : `<p class="map-hint">${T('Add plans with a place to see them here.')}</p>`}`;
    return;
  }

  const g = groups[0];
  const located = g.stops.filter(s => s.c);
  // The day's journey, from the stay and back to it when there is one.
  const route = withBase(trip, g.day, located);
  const { total, time } = routeTravel(route, modeFor(trip, g.day));
  $('#map-title').textContent = fmtDay(g.day, { weekday: 'long', month: 'short', day: 'numeric' });
  $('#map-sub').textContent = pending ? T('Finding places on the map…')
    : route.length > 1 ? `${Tn(located.length, '{n} stop', '{n} stops')} · ${fmtDist(total)} · ${T('{time} of travel', { time })}`
    : Tn(located.length, '{n} stop on the map', '{n} stops on the map');

  const canOptimize = located.length >= 3 && located.some(s => !s.it.time);
  let n = 0;
  $('#map-body').innerHTML = `
    ${top}
    <div class="map-actions">
      ${canOptimize ? `<button type="button" class="btn tonal ripple" data-action="optimize" data-date="${g.day}">${icon('route')}${T('Optimize route')}</button>` : ''}
      ${located.length >= 2 ? `<a class="btn filled ripple" href="${esc(googleRouteUrl(withBase(trip, g.day, located), modeFor(trip, g.day)))}" target="_blank" rel="noopener">${icon('directions')}${T('Open in Google Maps')}</a>` : ''}
    </div>
    <ol class="stops">
      ${g.stops.map(s => {
        const sub = [s.it.time && fmtTime(s.it.time), s.it.place !== s.it.title && s.it.place].filter(Boolean).join(' · ');
        if (!s.c) {
          const why = geoPending.has(s.it.id) ? T('Finding it on the map…')
            : !s.it.place ? T('No address — edit the plan to add one')
            : !state.settings.lookup ? T('Not on the map (address lookup is off)')
            : T('Not found on the map — try a fuller address');
          return `
            <li class="stop off"><span class="stop-num">${icon('location_off')}</span>
              <span class="stop-text"><span class="stop-title">${esc(s.it.title)}</span><span class="stop-sub">${esc(why)}</span></span></li>`;
        }
        const stay = s.it.category === 'stay';
        return `
          <li><button type="button" class="stop ripple" data-action="focus-stop" data-id="${esc(s.it.id)}">
            ${stay ? `<span class="stop-num base">${icon('hotel')}</span>` : `<span class="stop-num" style="background:${g.color}">${++n}</span>`}
            <span class="stop-text"><span class="stop-title">${esc(s.it.title)}</span>${sub ? `<span class="stop-sub">${esc(sub)}</span>` : ''}</span>
          </button></li>`;
      }).join('')}
    </ol>
    <p class="map-credit">${T('Map data © OpenStreetMap contributors. Travel times are estimates.')}</p>`;
}

// Light or dark map, to match the app (called when the theme changes, and whenever the map is drawn).
function setMapTheme() {
  // The plain OpenStreetMap picture map has no dark version: it's darkened by CSS instead.
  $('#map').classList.toggle('inverted', !mapView.gl && !cartoKey() && mapTheme() === 'dark');
  if ((!mapView.tiles && !mapView.gl) || mapView.theme === mapTheme()) return;
  mapView.theme = mapTheme();
  if (mapView.gl) mapView.gl.getMaplibreMap().setStyle(tuneMapStyle(mapView.style, mapView.theme));
  else mapView.tiles.setUrl(tileUrl(mapView.theme));
}

function drawMap(fit) {
  const L = window.L;
  // Not before the detailed map has loaded or given up: a redraw in between would settle for the picture map.
  if (!L || !mapView.ready || !mapShown()) return;
  if (!mapView.map) {
    mapView.map = L.map('map', { zoomControl: false });
    L.control.zoom({ position: 'topright' }).addTo(mapView.map);
    mapView.theme = mapTheme();
    const osm = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
    if (mapView.style && L.maplibreGL) {
      // The vector map: OpenFreeMap's data, drawn in the app's own light or night style.
      mapView.gl = L.maplibreGL({ style: tuneMapStyle(mapView.style, mapView.theme), attributionControl: false }).addTo(mapView.map);
      mapView.map.setMaxZoom(20);
      mapView.map.attributionControl.setPrefix(false);      // keeps the credit line short enough for a phone
      mapView.map.attributionControl.addAttribution(`${osm} © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>`);
    } else {
      mapView.tiles = L.tileLayer(tileUrl(mapView.theme), {
        maxZoom: cartoKey() ? 20 : 19,
        subdomains: cartoKey() ? 'abcd' : 'abc',
        crossOrigin: true,
        attribution: cartoKey() ? `${osm} © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>` : osm,
      }).addTo(mapView.map);
    }
    mapView.layer = L.layerGroup().addTo(mapView.map);
  }
  setMapTheme();
  const trip = activeTrip();
  mapView.layer.clearLayers();
  mapView.markers.clear();
  const all = [];
  // The ideas, under the stops: round pins with their type's icon, and on a shared trip their hearts.
  const ideaPts = [];
  if (ideasLayerOn()) {
    lookupMissing(trip, trip.items.filter(i => !i.date));
    for (const s of mapIdeas(trip)) {
      const cat = CATEGORIES[s.it.category] || CATEGORIES.other;
      const hearts = heartsOn(trip) ? heartsFor(trip, s.it.id).length : 0;
      L.marker([s.c.lat, s.c.lng], {
        title: s.it.title,
        zIndexOffset: -1000,
        icon: L.divIcon({
          className: 'pin',
          html: `<div class="pin-idea" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}${hearts ? `<span class="pin-hearts">${icon('favorite-fill')}${hearts}</span>` : ''}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          popupAnchor: [0, -14],
        }),
      }).bindPopup(ideaPopupHTML(trip, s), { maxWidth: 280, minWidth: 200 }).addTo(mapView.layer);
      ideaPts.push([s.c.lat, s.c.lng]);
    }
  }
  for (const g of mapGroups(trip)) {
    const pts = g.stops.filter(s => s.c);
    // A day's route starts and ends at the stay (today.js); the whole-trip view only links the stops.
    const line = mapView.day === 'all' ? pts.map(s => s.c) : withBase(trip, g.day, pts);
    if (line.length > 1) {
      L.polyline(line.map(c => [c.lat, c.lng]), { color: g.color, weight: 4, opacity: .85, dashArray: '1 9', lineCap: 'round' })
        .addTo(mapView.layer);
    }
    // A stay is the hotel pin, also on the day it is a plan (check-in); the other stops are numbered.
    let n = 0;
    pts.forEach((s) => {
      const marker = L.marker([s.c.lat, s.c.lng], {
        title: s.it.title,
        icon: L.divIcon({
          className: 'pin',
          html: s.it.category === 'stay' ? `<div class="pin-shape base">${icon('hotel')}</div>`
            : `<div class="pin-shape" style="background:${g.color}"><b>${++n}</b></div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -30],
        }),
      }).bindPopup(`<strong>${esc(s.it.title)}</strong>${s.it.time ? `<br>${esc(fmtTime(s.it.time))}` : ''}${s.it.place ? `<br>${esc(s.it.place)}` : ''}`);
      marker.on('click', () => { if (mapDocked()) showPlanInList(s.it.id); });
      marker.addTo(mapView.layer);
      mapView.markers.set(s.it.id, marker);
      all.push([s.c.lat, s.c.lng]);
    });
  }
  // The hotel on a day's map (today.js).
  // On the day of a move or a check-out, the stay being left.
  const ends = mapView.day !== 'all' ? dayEnds(trip, mapView.day, dayItems(trip, mapView.day)) : {};
  for (const [base, what] of [[ends.start, ends.out ? T('Check out') : T('Your home base')], [ends.end, T('Your home base')]]) {
    if (!base || all.some(([la, ln]) => la === base.c.lat && ln === base.c.lng)) continue;
    L.marker([base.c.lat, base.c.lng], {
      title: base.item.title,
      icon: L.divIcon({ className: 'pin', html: `<div class="pin-shape base">${icon('hotel')}</div>`, iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -30] }),
    }).bindPopup(`<strong>${esc(base.item.title)}</strong><br>${what}`).addTo(mapView.layer);
    all.push([base.c.lat, base.c.lng]);
  }
  if (!fit) return;
  // The whole trip fits its ideas in too; a day only its own stops (its ideas around them are a bonus), unless it has none.
  const pts = mapView.day === 'all' || !all.length ? [...all, ...ideaPts] : all;
  if (pts.length > 1) mapView.map.fitBounds(pts, { padding: [48, 48], maxZoom: 16 });
  else if (pts.length === 1) mapView.map.setView(pts[0], 15);
  else {
    const guide = guideFor(trip);
    const places = guide ? guide.places : [];
    if (trip.place) mapView.map.setView([trip.place.lat, trip.place.lng], { city: 12, region: 8, country: 6 }[trip.place.kind] || 10);
    else if (places.length) mapView.map.setView([avg(places.map(p => p.lat)), avg(places.map(p => p.lng))], 12);
    else mapView.map.setView([39.5, -98.35], 3);
  }
}

function focusStop(id) {
  const marker = mapView.markers.get(id);
  if (!marker) return;
  mapView.map.setView(marker.getLatLng(), Math.max(mapView.map.getZoom(), 16));
  marker.openPopup();
  $('#map').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function runOptimize(day) {
  const trip = activeTrip();
  const result = optimizeDay(trip, day);
  const inMap = $('#map-dialog').open;
  if (result.error) {
    if (inMap) { mapView.note = { text: result.error }; refreshMap(); }
    else snackbar(result.error);
    return;
  }
  save();
  render();
  const undo = () => { result.undo(); save(); render(); if ($('#map-dialog').open) { mapView.note = null; refreshMap(); } };
  if (inMap) {
    mapView.note = { text: result.message, undo };
    refreshMap();
  } else {
    snackbar(result.message, T('Undo'), undo, 8000);
  }
}

/* ---------- Share the trip as text ---------- */

function tripText(trip) {
  const lines = [trip.name + (trip.start && trip.end ? ' — ' + T('{start} to {end}', { start: fmtDay(trip.start), end: fmtDay(trip.end) }) : '')];
  for (const day of tripDays(trip)) {
    const items = dayItems(trip, day);
    lines.push('', fmtDay(day, { weekday: 'long', month: 'short', day: 'numeric' }));
    const leaving = trip.items.filter(i => stayUntil(i) === day);      // today.js: a stay's check-out day
    for (const it of leaving) lines.push('• ' + T('Check out: {name}', { name: it.title }));
    if (!items.length && !leaving.length) lines.push('• ' + T('Free day'));
    for (const it of items) {
      lines.push(`• ${it.time ? fmtTime(it.time) + ' ' : ''}${it.title}${it.place && it.place !== it.title ? ` (${it.place})` : ''}`);
    }
  }
  const ideas = trip.items.filter(i => !i.date);
  if (ideas.length) lines.push('', T('Ideas'), ...ideas.map(i => `• ${i.title}`));
  return lines.join('\n');
}

async function shareTrip() {
  const trip = activeTrip();
  const text = tripText(trip);
  try {
    if (navigator.share) {
      await navigator.share({ title: trip.name, text });
      return;
    }
    await navigator.clipboard.writeText(text);
    snackbar(T('Itinerary copied — paste it anywhere'));
  } catch (e) {
    if (e && e.name !== 'AbortError') snackbar(T('Couldn’t share the itinerary'));
  }
}

/* ---------- Docked map: pointing at a plan in the list lights up its pin ---------- */

function hotPin(id) {
  if (mapView.hot === id) return;
  const old = mapView.markers.get(mapView.hot);
  if (old && old._icon) { old._icon.classList.remove('hot'); old.setZIndexOffset(0); }
  mapView.hot = id;
  const marker = id && mapView.markers.get(id);
  if (marker && marker._icon) { marker._icon.classList.add('hot'); marker.setZIndexOffset(1000); }
}
document.addEventListener('mouseover', (e) => {
  if (!document.body.classList.contains('has-map')) return;
  const li = e.target.closest('#view-plan .item[data-id]');
  hotPin(li ? li.dataset.id : null);
});

/* ---------- Taps ---------- */

onAction('day-map', el => openMap(el.dataset.date));
onAction('trip-map', () => openMap('all'));
onAction('optimize', el => runOptimize(el.dataset.date));
onAction('undo-optimize', () => {
  if (mapView.note && mapView.note.undo) mapView.note.undo();
});
onAction('focus-stop', el => focusStop(el.dataset.id));
// The ideas layer, switched on or off (kept per device).
onAction('map-ideas', () => {
  state.settings.mapIdeas = !ideasLayerOn();
  saveLocal();
  refreshMap();
});
// An idea's pin: "Add to {day}" puts it on that day, where it becomes a numbered stop.
onAction('map-add-idea', (el) => {
  const found = findItem(idOf(el));
  if (!found || found.item.date) return;
  const { item } = found;
  item.date = el.dataset.date;
  if (mapView.map) mapView.map.closePopup();
  save();
  render();
  const text = T('Added to {day}', { day: fmtDay(item.date, { weekday: 'long' }) });
  const inSheet = $('#map-dialog').open;
  const undo = () => {
    item.date = '';
    save();
    render();
    if ($('#map-dialog').open) mapView.note = null;
    if (mapShown()) refreshMap();
  };
  // In the map sheet the message shows over the stops (a snackbar would be hidden under the sheet).
  if (inSheet) mapView.note = { text, undo };
  refreshMap();
  if (!inSheet) snackbar(text, T('Undo'), undo);
});
