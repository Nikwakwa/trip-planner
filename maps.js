'use strict';

/* =========================================================
   Maps, route optimizing and address lookup.
   Uses OpenStreetMap data: map images (tiles, drawn by CARTO) and address search (Nominatim).
   The map library (Leaflet) is stored in the app and loaded on first use.
   Functions here use helpers from app.js, which is loaded right after.
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
   Plans with neither go last. */
const orderKey = it => it.time || it.slot || '~';
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

function needsLookup(item, guide) {
  return item.place && typeof item.lat !== 'number' && !item.geoMiss && !matchPlaces(item, guide).length;
}

// Looks up plans that have an address but no map position, one per second
// (OpenStreetMap's rule for its free search service).
function lookupMissing(trip, items) {
  if (!state.settings.lookup || !navigator.onLine) return;
  const guide = guideFor(trip);
  for (const item of items) {
    if (!needsLookup(item, guide) || geoPending.has(item.id)) continue;
    geoPending.add(item.id);
    geoChain = geoChain.then(async () => {
      const city = trip.place ? trip.place.name : guide ? guide.city : trip.name;
      const where = trip.place ? trip.place.label : city;
      // A full address ("…, 1200-359 Lisboa, Portugal") is searched as written first; a short
      // one ("Castelo") with the trip's city added. The first answer near the trip counts.
      const tries = norm(item.place).includes(norm(city)) || !item.place.includes(',')
        ? [norm(item.place).includes(norm(city)) ? item.place : `${item.place}, ${where}`]
        : [item.place, `${item.place}, ${where}`];
      const near = trip.place || (guide && guide.places[0]);
      // "Near the trip": within reach of a city, or anywhere inside a region's or country's borders.
      const reach = { region: 400, country: 1500 }[trip.place && trip.place.kind] || 60;
      const box = trip.place && trip.place.kind !== 'city' && trip.place.bbox;
      const fits = p => !near || miles(near, p) < reach
        || (box && p.lng >= box[0] - 1 && p.lng <= box[2] + 1 && p.lat >= box[1] - 1 && p.lat <= box[3] + 1);
      // One question to OpenStreetMap's address search (at most one a second).
      const ask = async (q) => {
        const waitMs = geoLast + 1100 - Date.now();
        if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
        geoLast = Date.now();
        const params = new URLSearchParams({ format: 'jsonv2', limit: '1', q, 'accept-language': 'en' });
        if (trip.place && trip.place.bbox) params.set('viewbox', trip.place.bbox.join(','));
        const res = await fetch('https://nominatim.openstreetmap.org/search?' + params);
        if (!res.ok) throw new Error('lookup ' + res.status);
        const [found] = await res.json();
        return found ? { lat: Number(found.lat), lng: Number(found.lon) } : null;
      };
      // The plans around it (the day before to the day after) that are on the map: a looser search
      // can answer with a place of the same name far away, so its answer has to be near them.
      const dayGap = (a, b) => Math.abs(daysBetween(a, b));
      const around = trip.items.filter(i => i !== item && typeof i.lat === 'number' && (!item.date || (i.date && dayGap(i.date, item.date) <= 1)));
      const plausible = p => fits(p) && (!around.length || around.some(i => miles(i, p) < 40));
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
        for (const q of tries) {
          const found = await ask(q);
          if (found && (tries.length === 1 || fits(found))) { hit = found; break; }
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
          const others = [
            parts.length >= 3 && `${parts[0]}, ${parts[parts.length - 1]}`,
            !['food', 'transport'].includes(item.category) && norm(name) !== norm(item.place) && name,
          ].filter(Boolean);
          for (const q of others) {
            const found = await ask(inCity(q));
            if (found && plausible(found)) { hit = found; break; }
          }
        }
        if (hit) {
          item.lat = hit.lat;
          item.lng = hit.lng;
        } else {
          item.geoMiss = true;
        }
        save();
        render();
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
  if (located.length < 3) return { error: 'Optimizing needs at least 3 stops on the map.' };
  const timed = located.filter(it => it.time);
  const free = located.filter(it => !it.time);
  if (!free.length) return { error: 'Every stop has a set time, so the order is fixed. Clear a time to let the app move that stop.' };

  // With a hotel (today.js), the day starts and ends there; the route counts both ways.
  const base = baseFor(trip, day, guide);
  const home = base && !items.includes(base.item) ? base.c : null;
  // Distance between two stops; a missing stop (null) is the hotel, or nothing without one.
  const dist = (a, b) => {
    if (!a && !b) return 0;
    if (!a || !b) return home ? miles(home, pts.get(a || b)) : 0;
    return miles(pts.get(a), pts.get(b));
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
  if (saved < 0.02) return { error: 'This day is already in the shortest order.' };

  const undo = items.map(it => [it, it.slot]);
  let anchor = '00:00', n = 0;
  for (const it of best) {
    if (it.time) { anchor = it.time; n = 0; }
    else it.slot = `${anchor}~${String(++n).padStart(2, '0')}`;
  }
  return {
    message: `Route optimized — ${fmtDist(saved)} less travel.`,
    undo: () => undo.forEach(([it, slot]) => { if (slot === undefined) delete it.slot; else it.slot = slot; }),
  };
}

/* ---------- Day tools (under each day's list) ---------- */

function dayToolsHTML(trip, day, items, guide) {
  const located = items.filter(it => coordsOf(it, guide));
  if (!located.length) return '';
  const canOptimize = located.length >= 3 && located.some(it => !it.time);
  // With 2+ stops there are travel times: this day can get around differently from the rest of the trip.
  const mode = TRAVEL_MODES[modeFor(trip, day)];
  const own = trip.dayTravel && trip.dayTravel[day];
  return `
    <div class="day-tools">
      <button type="button" class="assist-chip ripple" data-action="day-map" data-date="${day}">${icon('map')}Map</button>
      ${canOptimize ? `<button type="button" class="assist-chip ripple" data-action="optimize" data-date="${day}">${icon('route')}Optimize route</button>` : ''}
      ${located.length >= 2 ? `<button type="button" class="assist-chip ripple ${own ? 'selected' : ''}" data-action="day-travel" data-date="${day}"
        aria-label="Getting around this day: ${mode.label}. Tap to switch">${icon(mode.icon)}${mode.short}${own ? ' this day' : ''}</button>` : ''}
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
      await loadScript('vendor/maplibre/maplibre-gl.js');
      await loadScript('vendor/maplibre/leaflet-maplibre-gl.js');
      mapView.style = await loadMapStyle();
    } catch (e) {
      console.warn('Vector map unavailable, using the picture map', e);
      mapView.style = null;
    }
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
const dayColor = i => toHex(`oklch(.6 .16 ${DAY_HUES[i % DAY_HUES.length]})`);

// The stops to show: one day, or every day of the trip ("all").
function mapGroups(trip) {
  const guide = guideFor(trip);
  const days = mapView.day === 'all' ? tripDays(trip) : [mapView.day];
  return days.map((day, i) => {
    const items = dayItems(trip, day);
    return {
      day,
      color: mapView.day === 'all' ? dayColor(i) : cssColor('var(--primary)'),
      stops: items.map(it => ({ it, c: coordsOf(it, guide) })),
    };
  });
}

// A day's stops for the route, starting and ending at the hotel when there is one (today.js).
function withBase(trip, day, located) {
  const base = baseFor(trip, day);
  const pts = located.map(s => s.c);
  return base && pts.length && !located.some(s => s.it === base.item) ? [base.c, ...pts, base.c] : pts;
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

// Called after every render (app.js): shows or hides the docked map, and keeps it up to date.
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
    el.innerHTML = `<div class="map-empty">${icon('location_off')}The map couldn't load. Check your connection.</div>`;
  });
}

// The card over the docked map: which day it shows, and what can be done with it.
function renderMapPane() {
  const trip = activeTrip();
  const groups = mapGroups(trip);
  if (mapView.day === 'all') {
    const count = groups.reduce((n, g) => n + g.stops.filter(s => s.c).length, 0);
    $('#pane-title').textContent = 'All days';
    $('#pane-sub').textContent = count ? `${plural(count, 'stop')} · pick a day to see its route` : 'Plans with a place appear here';
    $('#pane-actions').innerHTML = groups.filter(g => g.stops.some(s => s.c)).map(g => `
      <button type="button" class="assist-chip ripple" data-action="day-map" data-date="${g.day}">
        <span class="legend-dot" style="background:${g.color}"></span>${esc(fmtDay(g.day, { weekday: 'short', day: 'numeric' }))}
      </button>`).join('');
    return;
  }
  const g = groups[0];
  const located = g.stops.filter(s => s.c);
  // The day's journey, from the stay and back to it when there is one.
  const route = withBase(trip, g.day, located);
  let total = 0, minutes = 0;
  route.forEach((c, k) => {
    if (!k) return;
    const d = miles(route[k - 1], c);
    total += d;
    minutes += travel(d, modeFor(trip, g.day)).mins;
  });
  $('#pane-title').textContent = fmtDay(g.day, { weekday: 'long', month: 'short', day: 'numeric' });
  $('#pane-sub').textContent = route.length > 1
    ? `${plural(located.length, 'stop')} · ${fmtDist(total)} · ${fmtDuration(Math.round(minutes))} of travel`
    : `${plural(located.length, 'stop')} on the map`;
  $('#pane-actions').innerHTML = `
    <button type="button" class="assist-chip ripple" data-action="trip-map">${icon('map')}All days</button>
    ${located.length >= 3 && located.some(s => !s.it.time) ? `<button type="button" class="assist-chip ripple" data-action="optimize" data-date="${g.day}">${icon('route')}Optimize route</button>` : ''}
    ${located.length >= 2 ? `<a class="assist-chip ripple" href="${esc(googleRouteUrl(withBase(trip, g.day, located), modeFor(trip, g.day)))}" target="_blank" rel="noopener">${icon('directions')}Google Maps</a>` : ''}`;
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
    $('#map').innerHTML = `<div class="map-empty">${icon('location_off')}The map couldn't load. Check your connection.</div>`;
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

  if (mapView.day === 'all') {
    const count = groups.reduce((n, g) => n + g.stops.filter(s => s.c).length, 0);
    $('#map-title').textContent = `${trip.name} · All days`;
    $('#map-sub').textContent = pending ? 'Finding places on the map…' : `${plural(count, 'stop')} on the map`;
    $('#map-body').innerHTML = `
      <div class="legend">
        ${groups.map((g) => {
          // The same day numbers as in the plan (a day outside the trip's dates has none).
          const inTrip = trip.start && g.day >= trip.start && g.day <= trip.end;
          return `
          <button type="button" class="assist-chip ripple" data-action="day-map" data-date="${g.day}">
            <span class="legend-dot" style="background:${g.color}"></span>${inTrip ? `Day ${daysBetween(trip.start, g.day) + 1} · ` : ''}${esc(fmtDay(g.day, { weekday: 'short', day: 'numeric' }))}
          </button>`;
        }).join('')}
      </div>
      ${count ? '' : '<p class="map-hint">Add plans with a place to see them here.</p>'}`;
    return;
  }

  const g = groups[0];
  const located = g.stops.filter(s => s.c);
  // The day's journey, from the stay and back to it when there is one.
  const route = withBase(trip, g.day, located);
  let total = 0, minutes = 0;
  route.forEach((c, k) => {
    if (!k) return;
    const d = miles(route[k - 1], c);
    total += d;
    minutes += travel(d, modeFor(trip, g.day)).mins;
  });
  $('#map-title').textContent = fmtDay(g.day, { weekday: 'long', month: 'short', day: 'numeric' });
  $('#map-sub').textContent = pending ? 'Finding places on the map…'
    : route.length > 1 ? `${plural(located.length, 'stop')} · ${fmtDist(total)} · ${fmtDuration(Math.round(minutes))} of travel`
    : `${plural(located.length, 'stop')} on the map`;

  const canOptimize = located.length >= 3 && located.some(s => !s.it.time);
  let n = 0;
  $('#map-body').innerHTML = `
    ${mapView.note ? `
      <div class="map-note" role="status">
        <span>${esc(mapView.note.text)}</span>
        ${mapView.note.undo ? '<button type="button" class="btn text ripple" data-action="undo-optimize">Undo</button>' : ''}
      </div>` : ''}
    <div class="map-actions">
      ${canOptimize ? `<button type="button" class="btn tonal ripple" data-action="optimize" data-date="${g.day}">${icon('route')}Optimize route</button>` : ''}
      ${located.length >= 2 ? `<a class="btn filled ripple" href="${esc(googleRouteUrl(withBase(trip, g.day, located), modeFor(trip, g.day)))}" target="_blank" rel="noopener">${icon('directions')}Open in Google Maps</a>` : ''}
    </div>
    <ol class="stops">
      ${g.stops.map(s => {
        const sub = [s.it.time && fmtTime(s.it.time), s.it.place !== s.it.title && s.it.place].filter(Boolean).join(' · ');
        if (!s.c) {
          const why = geoPending.has(s.it.id) ? 'Finding it on the map…'
            : !s.it.place ? 'No address — edit the plan to add one'
            : !state.settings.lookup ? 'Not on the map (address lookup is off)'
            : 'Not found on the map — try a fuller address';
          return `
            <li class="stop off"><span class="stop-num">${icon('location_off')}</span>
              <span class="stop-text"><span class="stop-title">${esc(s.it.title)}</span><span class="stop-sub">${esc(why)}</span></span></li>`;
        }
        n++;
        return `
          <li><button type="button" class="stop ripple" data-action="focus-stop" data-id="${esc(s.it.id)}">
            <span class="stop-num" style="background:${g.color}">${n}</span>
            <span class="stop-text"><span class="stop-title">${esc(s.it.title)}</span>${sub ? `<span class="stop-sub">${esc(sub)}</span>` : ''}</span>
          </button></li>`;
      }).join('')}
    </ol>
    <p class="map-credit">Map data © OpenStreetMap contributors. Travel times are estimates.</p>`;
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
  if (!L || !mapShown()) return;
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
  for (const g of mapGroups(trip)) {
    const pts = g.stops.filter(s => s.c);
    // A day's route starts and ends at the stay (today.js); the whole-trip view only links the stops.
    const line = mapView.day === 'all' ? pts.map(s => s.c) : withBase(trip, g.day, pts);
    if (line.length > 1) {
      L.polyline(line.map(c => [c.lat, c.lng]), { color: g.color, weight: 4, opacity: .85, dashArray: '1 9', lineCap: 'round' })
        .addTo(mapView.layer);
    }
    pts.forEach((s, k) => {
      const marker = L.marker([s.c.lat, s.c.lng], {
        title: s.it.title,
        icon: L.divIcon({
          className: 'pin',
          html: `<div class="pin-shape" style="background:${g.color}"><b>${k + 1}</b></div>`,
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
  const base = mapView.day !== 'all' && baseFor(trip, mapView.day);
  if (base && !all.some(([la, ln]) => la === base.c.lat && ln === base.c.lng)) {
    L.marker([base.c.lat, base.c.lng], {
      title: base.item.title,
      icon: L.divIcon({ className: 'pin', html: `<div class="pin-shape base">${icon('hotel')}</div>`, iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -30] }),
    }).bindPopup(`<strong>${esc(base.item.title)}</strong><br>Your home base`).addTo(mapView.layer);
    all.push([base.c.lat, base.c.lng]);
  }
  if (!fit) return;
  if (all.length > 1) mapView.map.fitBounds(all, { padding: [48, 48], maxZoom: 16 });
  else if (all.length === 1) mapView.map.setView(all[0], 15);
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
    snackbar(result.message, 'Undo', undo, 8000);
  }
}

/* ---------- Share the trip as text ---------- */

function tripText(trip) {
  const lines = [trip.name + (trip.start && trip.end ? ` — ${fmtDay(trip.start)} to ${fmtDay(trip.end)}` : '')];
  for (const day of tripDays(trip)) {
    const items = dayItems(trip, day);
    lines.push('', fmtDay(day, { weekday: 'long', month: 'short', day: 'numeric' }));
    if (!items.length) lines.push('• Free day');
    for (const it of items) {
      lines.push(`• ${it.time ? fmtTime(it.time) + ' ' : ''}${it.title}${it.place && it.place !== it.title ? ` (${it.place})` : ''}`);
    }
  }
  const ideas = trip.items.filter(i => !i.date);
  if (ideas.length) lines.push('', 'Ideas', ...ideas.map(i => `• ${i.title}`));
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
    snackbar('Itinerary copied — paste it anywhere');
  } catch (e) {
    if (e && e.name !== 'AbortError') snackbar("Couldn't share the itinerary");
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
