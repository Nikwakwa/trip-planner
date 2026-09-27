'use strict';

/* =========================================================
   Maps, route optimizing and address lookup.
   Uses OpenStreetMap: map images (tiles) and address search (Nominatim).
   The map library (Leaflet) is stored in the app and loaded on first use.
   Functions here use helpers from app.js, which is loaded right after.
   ========================================================= */

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
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

const GEO_AREAS = { boston: '-71.20,42.45,-70.95,42.23', nyc: '-74.26,40.92,-73.70,40.49' };
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
      const waitMs = geoLast + 1100 - Date.now();
      if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
      geoLast = Date.now();
      const city = guide ? guide.city : trip.name;
      const q = norm(item.place).includes(norm(city)) ? item.place : `${item.place}, ${city}`;
      const params = new URLSearchParams({ format: 'jsonv2', limit: '1', q, 'accept-language': 'en' });
      if (guide && GEO_AREAS[guide.id]) params.set('viewbox', GEO_AREAS[guide.id]);
      try {
        const res = await fetch('https://nominatim.openstreetmap.org/search?' + params);
        if (!res.ok) return;
        const [hit] = await res.json();
        if (hit) {
          item.lat = Number(hit.lat);
          item.lng = Number(hit.lon);
        } else {
          item.geoMiss = true;
        }
        save();
        render();
      } catch {
        // No connection: try again next time.
      } finally {
        geoPending.delete(item.id);
        if ($('#map-dialog').open) refreshMap();
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

  const dist = (a, b) => miles(pts.get(a), pts.get(b));
  const length = seq => seq.reduce((sum, it, k) => (k ? sum + dist(seq[k - 1], it) : 0), 0);

  let best;
  if (located.length <= 10) {
    // Try every order (skipping ones that break the time order), keeping the shortest.
    let bestLen = Infinity;
    const used = new Set();
    const seq = [];
    const search = (len, nextTimed) => {
      if (len >= bestLen) return;
      if (seq.length === located.length) { bestLen = len; best = seq.slice(); return; }
      for (const it of located) {
        if (used.has(it)) continue;
        if (it.time && it !== timed[nextTimed]) continue;
        const add = seq.length ? dist(seq[seq.length - 1], it) : 0;
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
        const before = best[p - 1], after = best[p];
        const c = (before ? dist(before, it) : 0) + (after ? dist(it, after) : 0) - (before && after ? dist(before, after) : 0);
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
    message: `Route optimized — ${fmtMiles(saved)} less travel.`,
    undo: () => undo.forEach(([it, slot]) => { if (slot === undefined) delete it.slot; else it.slot = slot; }),
  };
}

/* ---------- Day tools (under each day's list) ---------- */

function dayToolsHTML(trip, day, items, guide) {
  const located = items.filter(it => coordsOf(it, guide));
  if (!located.length) return '';
  const canOptimize = located.length >= 3 && located.some(it => !it.time);
  return `
    <div class="day-tools">
      <button type="button" class="assist-chip ripple" data-action="day-map" data-date="${day}">${icon('map')}Map</button>
      ${canOptimize ? `<button type="button" class="assist-chip ripple" data-action="optimize" data-date="${day}">${icon('route')}Optimize route</button>` : ''}
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

function googleRouteUrl(points) {
  const fmt = p => `${p.lat},${p.lng}`;
  const params = new URLSearchParams({ api: '1', origin: fmt(points[0]), destination: fmt(points[points.length - 1]) });
  const middle = points.slice(1, -1);
  if (middle.length) params.set('waypoints', middle.map(fmt).join('|'));
  const long = points.some((p, k) => k && miles(points[k - 1], p) > 1.2);
  if (!long) params.set('travelmode', 'walking');
  else if (!middle.length) params.set('travelmode', 'transit');
  return 'https://www.google.com/maps/dir/?' + params;
}

function openMap(day) {
  mapView.day = day;
  mapView.note = null;
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
  renderMapBody();
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
        ${groups.map((g, i) => `
          <button type="button" class="assist-chip ripple" data-action="day-map" data-date="${g.day}">
            <span class="legend-dot" style="background:${g.color}"></span>Day ${i + 1} · ${esc(fmtDay(g.day, { weekday: 'short', day: 'numeric' }))}
          </button>`).join('')}
      </div>
      ${count ? '' : '<p class="map-hint">Add plans with a place to see them here.</p>'}`;
    return;
  }

  const g = groups[0];
  const located = g.stops.filter(s => s.c);
  let total = 0, minutes = 0;
  located.forEach((s, k) => {
    if (!k) return;
    const d = miles(located[k - 1].c, s.c);
    total += d;
    minutes += d <= 1.2 ? d * 1.3 / 3 * 60 : 10 + d * 1.3 / 12 * 60;
  });
  $('#map-title').textContent = fmtDay(g.day, { weekday: 'long', month: 'short', day: 'numeric' });
  $('#map-sub').textContent = pending ? 'Finding places on the map…'
    : located.length > 1 ? `${plural(located.length, 'stop')} · ${fmtMiles(total)} · ${fmtDuration(Math.round(minutes))} of travel`
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
      ${located.length >= 2 ? `<a class="btn filled ripple" href="${esc(googleRouteUrl(located.map(s => s.c)))}" target="_blank" rel="noopener">${icon('directions')}Open in Google Maps</a>` : ''}
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
          <li><button type="button" class="stop ripple" data-action="focus-stop" data-id="${s.it.id}">
            <span class="stop-num" style="background:${g.color}">${n}</span>
            <span class="stop-text"><span class="stop-title">${esc(s.it.title)}</span>${sub ? `<span class="stop-sub">${esc(sub)}</span>` : ''}</span>
          </button></li>`;
      }).join('')}
    </ol>
    <p class="map-credit">Map data © OpenStreetMap contributors. Travel times are estimates.</p>`;
}

function drawMap(fit) {
  const L = window.L;
  if (!L || !$('#map-dialog').open) return;
  if (!mapView.map) {
    mapView.map = L.map('map', { zoomControl: false });
    L.control.zoom({ position: 'topright' }).addTo(mapView.map);
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(mapView.map);
    mapView.layer = L.layerGroup().addTo(mapView.map);
  }
  const trip = activeTrip();
  mapView.layer.clearLayers();
  mapView.markers.clear();
  const all = [];
  for (const g of mapGroups(trip)) {
    const pts = g.stops.filter(s => s.c);
    if (pts.length > 1) {
      L.polyline(pts.map(s => [s.c.lat, s.c.lng]), { color: g.color, weight: 4, opacity: .85, dashArray: '1 9', lineCap: 'round' })
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
      marker.addTo(mapView.layer);
      mapView.markers.set(s.it.id, marker);
      all.push([s.c.lat, s.c.lng]);
    });
  }
  if (!fit) return;
  if (all.length > 1) mapView.map.fitBounds(all, { padding: [48, 48], maxZoom: 16 });
  else if (all.length === 1) mapView.map.setView(all[0], 15);
  else {
    const guide = guideFor(trip);
    const places = guide ? guide.places : [];
    if (places.length) mapView.map.setView([avg(places.map(p => p.lat)), avg(places.map(p => p.lng))], 12);
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
