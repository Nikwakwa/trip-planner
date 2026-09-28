'use strict';

/* =========================================================
   Trip Planner — all app behavior lives in this file.
   Data is kept in the browser's localStorage on the phone.
   ========================================================= */

const STORAGE_KEY = 'tripPlanner.v1';
const SPRITE = 'icons/sprite.svg';

const COLORS = ['#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f', '#455a64'];

// Each type of plan gets its own icon and color hue.
const CATEGORIES = {
  sight:     { label: 'Sightseeing',  icon: 'museum',         hue: 255 },
  food:      { label: 'Food & drink', icon: 'restaurant',     hue: 45 },
  event:     { label: 'Show / event', icon: 'local_activity', hue: 345 },
  shopping:  { label: 'Shopping',     icon: 'shopping_bag',   hue: 300 },
  transport: { label: 'Transport',    icon: 'train',          hue: 205 },
  stay:      { label: 'Stay',         icon: 'hotel',          hue: 150 },
  other:     { label: 'Other',        icon: 'push_pin',       hue: 85 },
};

/* ---------- Small helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);

const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" aria-hidden="true"><use href="${SPRITE}#${name}"/></svg>`;

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Makes user text safe to put inside HTML.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Dates are stored as "YYYY-MM-DD" text; these turn them into real dates and back.
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function toISO(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
function todayISO() { return toISO(new Date()); }
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
function fmtDay(s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return parseDate(s).toLocaleDateString(undefined, opts);
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Only allow normal web links (blocks tricks like "javascript:").
function safeUrl(s) {
  if (!s) return '';
  let v = s.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
  } catch { return ''; }
}
function hostLabel(url) {
  const h = new URL(url).hostname.replace(/^www\./, '');
  return h.length > 22 ? h.slice(0, 21) + '…' : h;
}

function mapsUrl(place, trip) {
  const where = trip.place ? trip.place.label : trip.name;
  const q = place.toLowerCase().includes((trip.place ? trip.place.name : trip.name).toLowerCase()) ? place : `${place}, ${where}`;
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

/* ---------- Expressive "cookie" shape ---------- */

// A circle with gentle scalloped edges, like the shapes on Pixel phones.
function cookiePath(size, lobes, depth) {
  const r = size / 2;
  const pts = [];
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * 2 * Math.PI;
    const rr = r * (1 - depth) + r * depth * Math.cos(lobes * a);
    pts.push(`${(r + rr * Math.sin(a)).toFixed(2)} ${(r - rr * Math.cos(a)).toFixed(2)}`);
  }
  return 'M' + pts.join('L') + 'Z';
}
const HERO_SHAPE = cookiePath(100, 12, 0.045);
const EMPTY_SHAPE = cookiePath(100, 9, 0.06);
document.documentElement.style.setProperty('--cookie-56', `path('${cookiePath(56, 9, 0.06)}')`);

const shape = (d, cls) => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><path d="${d}"/></svg>`;

function emptyState(ic, title, text, action = '') {
  return `
    <div class="empty-state">
      <div class="empty-art">${shape(EMPTY_SHAPE, 'shape')}${icon(ic)}</div>
      <h2>${title}</h2>
      <p>${text}</p>
      ${action}
    </div>`;
}

function progressBar(fraction, label) {
  const p = Math.max(0, Math.min(1, fraction));
  return `
    <div class="progress" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}">
      ${p > 0 ? `<span class="on" style="flex-grow:${p}"></span>` : ''}
      ${p < 1 ? `<span class="off" style="flex-grow:${1 - p}"></span>` : ''}
    </div>`;
}

/* ---------- City guides: matching, distances, suggestions ---------- */

const norm = s => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Prepare each guide place once: a pattern that recognises its name in your plans.
function prepGuide(g) {
  for (const p of g.places) {
    const names = [p.name, ...(p.aliases || [])].map(a => escRe(norm(a))).join('|');
    p.re = new RegExp(`(^|[^a-z0-9])(${names})($|[^a-z0-9])`);
    p.tags = p.tags || [];
    p.cat = p.cat || 'sight';
  }
  g.dayAreas = g.dayAreas || [];
  return g;
}
GUIDES.forEach(prepGuide);

// The built-in Boston / NYC guides when the trip is there; otherwise the guide
// fetched for the trip's place (see places.js).
function guideFor(trip) {
  const builtIn = GUIDES.find(g => g.match.test(trip.name));
  if (builtIn && (!trip.place || miles(trip.place, builtIn.places[0]) < 30)) return builtIn;
  return placeGuide(trip);
}

const placeLabel = trip => (trip.place ? trip.place.label : trip.name);

// Which guide places does a plan refer to? ("Boston Common" → the Boston Common entry)
function matchPlaces(item, guide) {
  if (!guide) return [];
  if (item.guideId) return guide.places.filter(p => p.id === item.guideId);
  const text = norm(`${item.place} | ${item.title}`);
  return guide.places.filter(p => p.re.test(text));
}

function coordsOf(item, guide) {
  if (typeof item.lat === 'number' && typeof item.lng === 'number') return { lat: item.lat, lng: item.lng };
  const p = matchPlaces(item, guide)[0];
  return p ? { lat: p.lat, lng: p.lng } : null;
}

// Straight-line distance in miles.
function miles(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

// Rough estimate: real streets are ~30% longer than a straight line.
function travel(d) {
  if (d <= 1.2) {
    return { icon: 'directions_walk', mode: 'walking', text: `${Math.max(1, Math.round(d * 1.3 / 3 * 60))} min walk` };
  }
  if (d > 25) {
    return { icon: 'directions_car', mode: 'driving', text: `${fmtDuration(Math.round(d * 1.3 / 50 * 60 / 5) * 5)} drive` };
  }
  return { icon: 'directions_subway', mode: 'transit', text: `~${Math.round((10 + d * 1.3 / 12 * 60) / 5) * 5} min by transit` };
}
const fmtMiles = d => (d < 0.1 ? '<0.1 mi' : `${d.toFixed(d < 10 ? 1 : 0)} mi`);
const fmtDuration = m => (m < 60 ? `${m} min` : `~${Math.round(m / 30) / 2} h`);
function directionsUrl(a, b, mode) {
  return `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=${mode}`;
}
const avg = list => list.reduce((s, v) => s + v, 0) / list.length;

// Picks up to 3 suggestions for each upcoming day:
// near that day's plans, or — for an empty day — around a neighborhood not yet covered.
function planSuggestions(trip, guide, days) {
  const out = new Map();
  if (!guide || !state.settings.suggestions) return out;
  const today = todayISO();
  const taken = new Set(trip.items.flatMap(i => matchPlaces(i, guide).map(p => p.id)));
  const shown = new Set();
  const usedAreas = new Set();
  const anchorsByDay = new Map();
  for (const day of days) {
    const anchors = [];
    for (const item of trip.items.filter(i => i.date === day)) {
      const c = coordsOf(item, guide);
      if (!c) continue;
      anchors.push({ item, c });
      const p = matchPlaces(item, guide)[0];
      if (p) usedAreas.add(p.area);
    }
    anchorsByDay.set(day, anchors);
  }
  const freeAreas = guide.dayAreas.filter(a => !usedAreas.has(a));
  const areaList = freeAreas.length ? freeAreas : guide.dayAreas;
  let areaIndex = 0;

  for (const day of days) {
    if (day < today) continue;
    const anchors = anchorsByDay.get(day);
    const pool = guide.places.filter(p => !taken.has(p.id) && !shown.has(p.id));
    let ranked, title;
    if (anchors.length) {
      title = 'Nearby ideas';
      ranked = pool.map(p => {
        let best = null;
        for (const a of anchors) {
          const d = miles(a.c, p);
          if (!best || d < best.d) best = { d, from: a.item };
        }
        return { p, ...best };
      }).sort((x, y) => x.d - y.d);
    } else if (areaList.length) {
      const area = areaList[areaIndex++ % areaList.length];
      const inArea = guide.places.filter(p => p.area === area);
      const center = { lat: avg(inArea.map(p => p.lat)), lng: avg(inArea.map(p => p.lng)) };
      title = (guide.dayTitles && guide.dayTitles[area]) || `Ideas for a day in ${area}`;
      ranked = pool.map(p => ({ p, d: miles(center, p) })).sort((x, y) => x.d - y.d);
    } else {
      // A small town, or a country / region's destinations: best known first.
      title = guide.kind === 'destinations' ? `Places to go in ${guide.city}` : `Ideas for a day in ${guide.city}`;
      ranked = pool.map(p => ({ p }));
    }

    // Shuffle steps through the 12 closest; keep a mix of types (max 2 of one kind).
    const top = ranked.slice(0, 12);
    const start = top.length ? ((ui.shuffle[day] || 0) * 3) % top.length : 0;
    const ordered = top.map((_, k) => top[(start + k) % top.length]);
    const picked = [];
    const perType = {};
    for (const r of ordered) {
      if (picked.length === 3) break;
      if ((perType[r.p.cat] || 0) >= 2) continue;
      perType[r.p.cat] = (perType[r.p.cat] || 0) + 1;
      picked.push(r);
    }
    for (const r of ordered) if (picked.length < 3 && !picked.includes(r)) picked.push(r);
    picked.forEach(r => shown.add(r.p.id));
    out.set(day, { title, cards: picked });
  }
  return out;
}

function whenTag(p) {
  if (p.when === 'morning') return `<span class="tag">${icon('wb_sunny')}Morning</span>`;
  if (p.when === 'evening') return `<span class="tag">${icon('bedtime')}Evening</span>`;
  if (p.tags.includes('rainy')) return `<span class="tag">${icon('umbrella')}Indoors</span>`;
  return '';
}

function suggestionCard(r, day) {
  const p = r.p;
  const cat = CATEGORIES[p.cat] || CATEGORIES.other;
  const why = r.from
    ? `${icon('near_me')}<span>${esc(travel(r.d).text)} from ${esc(r.from.title)}</span>`
    : p.area ? `${icon('location_on')}<span>${esc(p.area)}</span>` : '';
  return `
    <article class="s-card" aria-label="${esc(p.name)}">
      <div class="s-top"><span class="avatar" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}</span>${whenTag(p)}</div>
      <h4 class="s-name">${esc(p.name)}</h4>
      ${why ? `<p class="s-why">${why}</p>` : ''}
      <p class="s-blurb">${esc(p.blurb)}</p>
      <div class="s-foot">
        ${p.mins < 360 ? `<span class="tag">${icon('schedule')}${fmtDuration(p.mins)}</span>` : ''}
        ${p.tags.includes('free') ? '<span class="tag">Free</span>' : ''}
        <button type="button" class="btn tonal sm ripple" data-action="add-suggestion" data-place="${p.id}" data-date="${day}"
          aria-label="Add ${esc(p.name)}">${icon('add')}Add</button>
      </div>
    </article>`;
}

/* ---------- Snackbar (message bar at the bottom, with optional Undo) ---------- */

let snackTimer;
function snackbar(msg, actionLabel, onAction, duration) {
  const bar = $('#snackbar');
  const btn = $('#snackbar-action');
  $('#snackbar-msg').textContent = msg;
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  btn.onclick = () => { hideSnackbar(); onAction && onAction(); };
  bar.classList.add('show');
  document.body.classList.add('snack-open');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnackbar, duration || (actionLabel ? 5000 : 2800));
}
function hideSnackbar() {
  $('#snackbar').classList.remove('show');
  document.body.classList.remove('snack-open');
}

/* ---------- Confirmation dialog for big decisions ---------- */

function askConfirm({ icon: ic, title, text, ok, cancel = 'Cancel' }) {
  const dlg = $('#confirm-dialog');
  $('#confirm-icon').setAttribute('href', `${SPRITE}#${ic}`);
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = ok;
  $('#confirm-cancel').textContent = cancel;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise(resolve =>
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

/* ---------- Starting data (only used the very first time) ---------- */

function idea(title, category, place, notes = '') {
  return { id: uid(), title, category, date: '', time: '', place, link: '', notes, done: false };
}

function defaultState() {
  const boston = {
    id: uid(), name: 'Boston', color: COLORS[0], start: '', end: '',
    items: [
      idea('Walk the Freedom Trail', 'sight', 'Boston Common', '2.5 mile red-brick path past 16 historic sites.'),
      idea('Cannoli in the North End', 'food', 'Hanover Street, North End'),
      idea('Quincy Market & Faneuil Hall', 'food', 'Faneuil Hall Marketplace'),
      idea('Fenway Park tour or game', 'event', 'Fenway Park'),
      idea('Harvard Square stroll', 'sight', 'Harvard Square, Cambridge'),
    ],
  };
  const nyc = {
    id: uid(), name: 'NYC', color: COLORS[1], start: '', end: '',
    items: [
      idea('Train from Boston to NYC', 'transport', 'Boston South Station', 'Book ahead for better fares. Arrives at Penn Station / Moynihan Hall.'),
      idea('Central Park', 'sight', 'Central Park, New York'),
      idea('The Met museum', 'sight', 'The Metropolitan Museum of Art'),
      idea('Walk the Brooklyn Bridge', 'sight', 'Brooklyn Bridge'),
      idea('Broadway show', 'event', 'Times Square, New York'),
    ],
  };
  const check = (text) => ({ id: uid(), text, done: false });
  return {
    version: 1,
    activeTripId: boston.id,
    trips: [boston, nyc],
    checklist: [
      check('Phone charger + power bank'),
      check('Comfortable walking shoes'),
      check('ID / wallet'),
      check('Tap-to-pay set up on phone (subway)'),
      check('Light jacket / layers'),
    ],
    settings: defaultSettings(),
  };
}

function defaultSettings() {
  return { theme: 'auto', suggestions: true, lookup: true };
}

/* ---------- Loading & saving ---------- */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.trips) && data.trips.length) return data;
    }
  } catch (e) {
    console.warn('Could not read saved data', e);
  }
  return defaultState();
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    snackbar('Could not save — phone storage may be full');
  }
}

// Saves on the phone, and sends the change to the account when signed in (sync.js).
function save() {
  saveLocal();
  pushChanges();
}

let state = load();
state.settings = { ...defaultSettings(), ...state.settings };
saveLocal();

const ui = { view: 'plan', ideasTab: 'mine', filter: 'all', shuffle: {} };

function activeTrip() {
  return state.trips.find(t => t.id === state.activeTripId) || state.trips[0];
}
function findItem(id) {
  for (const t of state.trips) {
    const it = t.items.find(i => i.id === id);
    if (it) return { trip: t, item: it };
  }
  return null;
}

/* ---------- Theme: the trip's color drives the whole palette ---------- */

const colorCanvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function toHex(css) {
  colorCanvas.fillStyle = '#000';
  colorCanvas.fillStyle = css;
  colorCanvas.fillRect(0, 0, 1, 1);
  const [r, g, b] = colorCanvas.getImageData(0, 0, 1, 1).data;
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Light or dark: your choice in More → Appearance, or the phone's setting when "Automatic".
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyAppearance() {
  const t = state.settings.theme;
  document.documentElement.dataset.theme =
    (t === 'light' || t === 'dark') ? t : (darkQuery.matches ? 'dark' : 'light');
}
darkQuery.addEventListener('change', () => render());

function applyTheme(seed) {
  applyAppearance();
  document.documentElement.style.setProperty('--seed', seed);
  // Paint Android's status bar to match the app background.
  const bg = getComputedStyle($('#theme-probe')).backgroundColor;
  $('meta[name="theme-color"]').setAttribute('content', toHex(bg));
}

/* ---------- Drawing the screen ---------- */

const TITLES = { plan: '', ideas: '', pack: 'Checklist', more: 'More' };

// Trips made before place search (or saved while offline) get their place looked up once.
const placeTried = new Set();
function ensurePlace(trip) {
  if (trip.place || placeTried.has(trip.id) || !navigator.onLine) return;
  if (GUIDES.some(g => g.match.test(trip.name))) return;
  placeTried.add(trip.id);
  findPlace(trip.name).then((place) => {
    if (!place || trip.place || !state.trips.includes(trip)) return;
    trip.place = place;
    save();
    render();
  });
}

// A guide has just been fetched for a place (places.js).
function onGuideReady(place, guide) {
  readyGuides.delete(placeKey(place));
  render();
  const trip = activeTrip();
  if (trip.place && placeKey(trip.place) === placeKey(place) && ui.view !== 'ideas') {
    snackbar(`${plural(guide.places.length, 'idea')} for ${place.name} ready`, 'Explore', () => {
      ui.view = 'ideas';
      ui.ideasTab = 'explore';
      window.scrollTo(0, 0);
      render();
    });
  }
}

function render() {
  const trip = activeTrip();
  state.activeTripId = trip.id;
  ensurePlace(trip);
  applyTheme(trip.color);

  for (const v of ['plan', 'ideas', 'pack', 'more']) {
    $('#view-' + v).hidden = v !== ui.view;
  }
  document.querySelectorAll('.navbar button').forEach(b => {
    const on = b.dataset.go === ui.view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });

  const tripViews = ui.view === 'plan' || ui.view === 'ideas';
  $('#trip-tabs').hidden = !tripViews;
  $('#appbar-title').hidden = tripViews;
  $('#appbar-title').textContent = TITLES[ui.view];
  $('#fab').hidden = !tripViews;
  $('#fab-label').textContent = ui.view === 'ideas' ? 'New idea' : 'New plan';
  $('#fab').setAttribute('aria-label', $('#fab-label').textContent);
  if (tripViews) renderTripTabs(trip);

  if (ui.view === 'plan') renderPlan(trip);
  if (ui.view === 'ideas') renderIdeas(trip);
  if (ui.view === 'pack') renderChecklist();
  if (ui.view === 'more') renderMore();
  onScroll();
}

function renderTripTabs(trip) {
  $('#trip-tabs').innerHTML =
    state.trips.map(t => `
      <button type="button" class="trip-chip ripple ${t.id === trip.id ? 'active' : ''}" data-trip="${t.id}"
        style="--c:${esc(t.color)}" aria-pressed="${t.id === trip.id}">
        <span class="dot"></span>${esc(t.name)}
      </button>`).join('') +
    `<button type="button" class="trip-chip add ripple" data-action="new-trip" aria-label="Add a trip">${icon('add', 'sm')}</button>`;
}

function itemHTML(item, trip, { showDate = false } = {}) {
  const cat = CATEGORIES[item.category] || CATEGORIES.other;
  const link = safeUrl(item.link);
  const over = [
    item.time && fmtTime(item.time),
    showDate && item.date && fmtDay(item.date),
    cat.label,
  ].filter(Boolean).join(' · ');
  const chips = [
    item.place && `<a class="assist-chip ripple" href="${esc(mapsUrl(item.place, trip))}" target="_blank" rel="noopener">${icon('location_on')}Directions</a>`,
    link && `<a class="assist-chip ripple" href="${esc(link)}" target="_blank" rel="noopener">${icon('link')}${esc(hostLabel(link))}</a>`,
  ].filter(Boolean).join('');
  return `
    <li class="item ${item.done ? 'done' : ''}" data-id="${item.id}">
      <button type="button" class="item-main ripple" data-action="edit">
        <span class="avatar" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}</span>
        <span class="item-text">
          <span class="overline">${esc(over)}</span>
          <span class="item-title">${esc(item.title)}</span>
          ${item.place ? `<span class="item-sub">${esc(item.place)}</span>` : ''}
          ${item.notes ? `<span class="item-notes">${esc(item.notes)}</span>` : ''}
        </span>
      </button>
      <button type="button" class="check ripple" data-action="toggle" role="checkbox"
        aria-checked="${item.done}" aria-label="Done: ${esc(item.title)}"><span class="box">${icon('check')}</span></button>
      ${chips ? `<div class="item-chips">${chips}</div>` : ''}
    </li>`;
}

// Every day between the trip's first and last day, plus any other days that have plans.
function tripDays(trip) {
  const days = new Set();
  if (trip.start && trip.end) {
    const d = parseDate(trip.start);
    const end = parseDate(trip.end);
    for (let i = 0; d <= end && i < 90; i++) {
      days.add(toISO(d));
      d.setDate(d.getDate() + 1);
    }
  }
  for (const it of trip.items) if (it.date) days.add(it.date);
  return [...days].sort();
}

function tripStatus(trip) {
  if (!trip.start || !trip.end) return null;
  const today = todayISO();
  if (today < trip.start) {
    const n = daysBetween(today, trip.start);
    return { icon: 'flight_takeoff', text: n === 1 ? 'Starts tomorrow' : `Starts in ${n} days` };
  }
  if (today > trip.end) return { icon: 'check', text: 'Trip complete' };
  return { icon: 'today', text: `Day ${daysBetween(trip.start, today) + 1} of ${daysBetween(trip.start, trip.end) + 1}` };
}

function renderPlan(trip) {
  const days = tripDays(trip);
  const today = todayISO();
  const hasDates = trip.start && trip.end;
  const n = hasDates ? daysBetween(trip.start, trip.end) + 1 : 0;
  const status = tripStatus(trip);
  const planned = trip.items.filter(i => i.date);
  const done = planned.filter(i => i.done).length;
  const ideas = trip.items.length - planned.length;

  let html = `
    <section class="hero">
      ${shape(HERO_SHAPE, 'hero-shape')}
      ${icon('location_on-fill', 'hero-shape-icon')}
      <p class="hero-overline">${hasDates ? `${n}-day trip` : 'Your trip'}</p>
      <h1 class="hero-title">${esc(trip.name)}</h1>
      <p class="hero-dates">${hasDates
        ? esc(`${fmtDay(trip.start)} – ${fmtDay(trip.end)}`)
        : 'No dates yet'}</p>
      ${status
        ? `<span class="status-chip">${icon(status.icon, 'sm')}${esc(status.text)}</span>`
        : `<button type="button" class="btn filled ripple" data-action="edit-trip">${icon('calendar_add_on')}Add dates</button>`}
      ${planned.length ? `
        <div class="hero-progress">
          <span>${done} of ${plural(planned.length, 'plan')} done</span>
          ${progressBar(done / planned.length, 'Plans done')}
        </div>` : ''}
      <div class="hero-actions">
        ${planned.length ? `<button type="button" class="hero-btn ripple" data-action="trip-map">${icon('map')}Trip map</button>` : ''}
        <button type="button" class="hero-btn ripple" data-action="share-trip">${icon('share')}Share</button>
      </div>
      <button type="button" class="icon-btn hero-edit ripple" data-action="edit-trip" aria-label="Edit trip">${icon('edit')}</button>
    </section>`;

  const guide = guideFor(trip);
  const suggestions = planSuggestions(trip, guide, days);
  if (!guide && guideState(trip) === 'loading' && state.settings.suggestions) {
    html += `<p class="guide-note" role="status">${icon('auto_awesome')}Finding things to do in ${esc(trip.place.name)}…</p>`;
  }

  if (!days.length) {
    html += emptyState('event_available', 'Your days will appear here',
      `Add the dates for ${esc(trip.name)} and you'll see the trip day by day.`,
      `<div class="empty-actions">
        ${ideas ? `<button type="button" class="btn tonal ripple" data-action="open-ideas" data-tab="mine">${icon('lightbulb')}See ${plural(ideas, 'idea')}</button>` : ''}
        ${guide ? `<button type="button" class="btn tonal ripple" data-action="open-ideas" data-tab="explore">${icon('explore')}Explore ${esc(guide.city)}</button>` : ''}
      </div>`);
  }

  for (const day of days) {
    const items = dayItems(trip, day);
    const inRange = hasDates && day >= trip.start && day <= trip.end;
    const isToday = day === today;
    const sub = [
      isToday ? '<b>Today</b>' : '',
      esc(fmtDay(day, { month: 'short', day: 'numeric' })),
      inRange ? `Day ${daysBetween(trip.start, day) + 1}` : 'Outside trip dates',
    ].filter(Boolean).join(' · ');
    html += `
      <section class="day" id="day-${day}">
        <div class="day-head">
          <div class="date-badge ${isToday ? 'today' : ''}" aria-hidden="true">
            <small>${esc(fmtDay(day, { weekday: 'short' }))}</small>
            <strong>${parseDate(day).getDate()}</strong>
          </div>
          <div class="day-text">
            <div class="day-title">${esc(fmtDay(day, { weekday: 'long' }))}</div>
            <div class="day-sub">${sub}</div>
          </div>
          <button type="button" class="icon-btn tonal ripple" data-action="add-on-day" data-date="${day}"
            aria-label="Add a plan on ${esc(fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric' }))}">${icon('add')}</button>
        </div>
        ${items.length
          ? `<ul class="group">${dayListHTML(items, trip, guide)}</ul>`
          : `<button type="button" class="empty-day ripple" data-action="add-on-day" data-date="${day}">${icon('add')}Free day — tap to add a plan</button>`}
        ${dayToolsHTML(trip, day, items, guide)}
        ${suggestionsHTML(suggestions.get(day), day)}
      </section>`;
  }

  $('#view-plan').innerHTML = html;
  // Plans with an address that isn't in the guide get looked up on the map.
  lookupMissing(trip, planned);
}

// A day's plans, with the travel time between each pair of stops.
function dayListHTML(items, trip, guide) {
  let html = '';
  let prev = null;
  for (const item of items) {
    const c = coordsOf(item, guide);
    if (prev && c) {
      const d = miles(prev, c);
      if (d >= 0.05) {
        const t = travel(d);
        html += `
          <li class="leg"><a class="leg-link ripple" href="${esc(directionsUrl(prev, c, t.mode))}" target="_blank" rel="noopener"
            aria-label="Directions: ${esc(t.text)}, ${fmtMiles(d)}">${icon(t.icon)}${esc(t.text)} · ${fmtMiles(d)}${icon('open_in_new', 'open')}</a></li>`;
      }
    }
    html += itemHTML(item, trip);
    prev = c;
  }
  return html;
}

function suggestionsHTML(s, day) {
  if (!s || !s.cards.length) return '';
  return `
    <div class="suggest">
      <div class="suggest-head">
        <span class="suggest-title">${icon('auto_awesome')}${esc(s.title)}</span>
        <button type="button" class="icon-btn ripple" data-action="shuffle" data-date="${day}" aria-label="Show other suggestions">${icon('shuffle')}</button>
      </div>
      <div class="suggest-row">${s.cards.map(r => suggestionCard(r, day)).join('')}</div>
    </div>`;
}

const FILTERS = [
  ['all', 'All', () => true],
  ['sight', 'Sights', p => p.cat === 'sight'],
  ['food', 'Food & drink', p => p.cat === 'food'],
  ['event', 'Shows & sports', p => p.cat === 'event'],
  ['shopping', 'Shopping', p => p.cat === 'shopping'],
  ['free', 'Free', p => p.tags.includes('free'), 'money_off'],
  ['rainy', 'Rainy day', p => p.tags.includes('rainy'), 'umbrella'],
  ['evening', 'Evening', p => p.when === 'evening', 'bedtime'],
];

function placeHTML(p, added, trip) {
  const cat = CATEGORIES[p.cat] || CATEGORIES.other;
  const over = [p.area, p.mins < 360 && fmtDuration(p.mins), p.tags.includes('free') && 'Free'].filter(Boolean).join(' · ');
  return `
    <li class="item place">
      <div class="item-main">
        <span class="avatar" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}</span>
        <span class="item-text">
          <span class="overline">${esc(over)}</span>
          <span class="item-title">${esc(p.name)}</span>
          <span class="item-notes">${esc(p.blurb)}</span>
        </span>
      </div>
      <button type="button" class="icon-btn tonal add-btn ripple ${added ? 'added' : ''}"
        data-action="${added ? 'noop' : 'add-suggestion'}" data-place="${p.id}" data-date=""
        aria-label="${added ? `${esc(p.name)} is already in your trip` : `Save ${esc(p.name)} to your ideas`}">${icon(added ? 'check' : 'add')}</button>
      <div class="item-chips">
        <a class="assist-chip ripple" href="${esc(mapsUrl(p.place || p.name, trip))}" target="_blank" rel="noopener">${icon('map')}Map</a>
      </div>
    </li>`;
}

function renderIdeas(trip) {
  const guide = guideFor(trip);
  const ideas = trip.items.filter(i => !i.date);
  const tab = ui.ideasTab;
  let html = `
    <h1 class="headline">Ideas</h1>
    <div class="segmented" role="group" aria-label="Ideas view">
      <button type="button" class="ripple" data-action="ideas-tab" data-tab="mine" aria-pressed="${tab === 'mine'}">${icon('lightbulb')}My ideas${ideas.length ? ` (${ideas.length})` : ''}</button>
      <button type="button" class="ripple" data-action="ideas-tab" data-tab="explore" aria-pressed="${tab === 'explore'}">${icon('explore')}Explore ${esc(guide ? guide.city : trip.name)}</button>
    </div>`;

  if (tab === 'mine') {
    html += `
      <p class="supporting">Things you might do in ${esc(trip.name)}. Tap one and pick a day to add it to your plan.</p>
      ${ideas.length
        ? `<ul class="group">${ideas.map(it => itemHTML(it, trip)).join('')}</ul>`
        : emptyState('travel_explore', 'No ideas yet', 'Save places you hear about here, then schedule them later.',
            guide ? `<button type="button" class="btn tonal ripple" data-action="ideas-tab" data-tab="explore">${icon('explore')}Explore ${esc(guide.city)}</button>` : '')}`;
  } else if (!guide) {
    const googleIdeas = `<a class="btn tonal ripple" href="https://www.google.com/maps/search/${encodeURIComponent('things to do in ' + placeLabel(trip))}" target="_blank" rel="noopener">${icon('map')}Things to do on Google Maps</a>`;
    const changePlace = `<button type="button" class="btn tonal ripple" data-action="edit-trip">${icon('search')}Change place</button>`;
    const status = guideState(trip);
    if (status === 'loading') {
      html += emptyState('travel_explore', `Finding things to do in ${esc(trip.place.name)}…`,
        'Looking up sights, food and more in the Wikivoyage travel guide.');
    } else if (!trip.place && !navigator.onLine) {
      html += emptyState('cloud_off', `Ideas for ${esc(trip.name)} need a connection`,
        'Connect to the internet once, and the guide is saved on your phone for later.');
    } else if (!trip.place) {
      html += emptyState('location_off', `Couldn’t find ${esc(trip.name)} on the map`,
        'Edit the trip and pick the city or country from the list to get ideas for it.',
        `<div class="empty-actions">${changePlace}${googleIdeas}</div>`);
    } else if (status === 'failed') {
      html += emptyState('travel_explore', `No guide found for ${esc(trip.place.label)}`,
        'The travel guide may not cover it, or the connection dropped. You can still look for ideas on Google Maps.',
        `<div class="empty-actions">
          <button type="button" class="btn tonal ripple" data-action="retry-guide">${icon('restart_alt')}Try again</button>
          ${changePlace}${googleIdeas}
        </div>`);
    } else {
      html += emptyState('cloud_off', `Ideas for ${esc(trip.place.name)} need a connection`,
        'Connect to the internet once, and the guide is saved on your phone for later.');
    }
  } else {
    const taken = new Set(trip.items.flatMap(i => matchPlaces(i, guide).map(p => p.id)));
    const destinations = guide.kind === 'destinations';
    const filter = destinations ? FILTERS[0] : FILTERS.find(f => f[0] === ui.filter) || FILTERS[0];
    const list = guide.places.filter(filter[2]);
    const intro = !guide.source ? `${guide.places.length} hand-picked places in ${esc(guide.city)}.`
      : destinations ? `${guide.places.length} cities and destinations in ${esc(guide.city)}, from the ${guide.source} travel guide.`
      : `${guide.places.length} places in ${esc(guide.city)}, from ${guide.source}.`;
    html += `
      <p class="supporting">${intro} Tap + to save one to your ideas.</p>
      ${trip.place && guide.source ? `
        <div class="place-row">
          <span class="place-pin">${icon('location_on')}${esc(trip.place.label)}</span>
          <button type="button" class="btn text ripple" data-action="edit-trip">Change</button>
        </div>` : ''}
      ${destinations ? '' : `
        <div class="filter-row" role="group" aria-label="Filter places">
          ${FILTERS.map(([key, label, , ic]) => `
            <button type="button" class="filter-chip ripple" data-action="filter" data-filter="${key}" aria-pressed="${filter[0] === key}">${ic ? icon(ic) : ''}${label}</button>`).join('')}
        </div>`}
      ${list.length
        ? `<ul class="group">${list.map(p => placeHTML(p, taken.has(p.id), trip)).join('')}</ul>`
        : emptyState('travel_explore', 'Nothing here', 'Try another filter.')}
      <p class="footnote">${icon('schedule', 'sm')}Opening hours change — check before you go.</p>
      ${guide.source === 'Wikivoyage' ? `<p class="footnote"><span>Places and descriptions: <a href="${esc(guide.sourceUrl)}" target="_blank" rel="noopener">Wikivoyage</a>, CC BY-SA.</span></p>` : ''}
      ${guide.source === 'Wikipedia' ? '<p class="footnote">Places and descriptions: Wikipedia, CC BY-SA.</p>' : ''}`;
  }
  $('#view-ideas').innerHTML = html;
}

function taskHTML(c) {
  return `
    <li class="task ${c.done ? 'done' : ''}" data-check="${c.id}">
      <button type="button" class="check ripple" data-action="toggle-check" role="checkbox"
        aria-checked="${c.done}" aria-label="Done: ${esc(c.text)}"><span class="box">${icon('check')}</span></button>
      <span class="task-text">${esc(c.text)}</span>
      <button type="button" class="icon-btn ripple" data-action="del-check" aria-label="Remove ${esc(c.text)}">${icon('close')}</button>
    </li>`;
}

function renderChecklist() {
  const list = state.checklist;
  const todo = list.filter(c => !c.done);
  const done = list.filter(c => c.done);
  $('#view-pack').innerHTML = `
    <h1 class="headline">Checklist</h1>
    <p class="supporting">Packing and to-dos for the whole trip.</p>
    ${list.length ? `
      <div class="progress-card">
        <div><span class="big">${done.length}</span><span class="of"> / ${list.length}</span></div>
        <p>${done.length === list.length ? "All done — you're ready to go!" : 'packed & done'}</p>
        ${progressBar(done.length / list.length, 'Checklist progress')}
      </div>` : ''}
    <form class="add-bar" data-form="check">
      <input name="text" placeholder="Add something to pack or do" maxlength="200" autocomplete="off" aria-label="New checklist item">
      <button type="submit" class="icon-btn filled ripple" aria-label="Add">${icon('add')}</button>
    </form>
    ${todo.length ? `<ul class="group">${todo.map(taskHTML).join('')}</ul>` : ''}
    ${!list.length ? emptyState('luggage', 'Nothing to pack yet', 'Add chargers, tickets, snacks — anything you don’t want to forget.') : ''}
    ${done.length ? `
      <div class="label-row">
        <h2 class="group-label">Completed (${done.length})</h2>
        <button type="button" class="btn text ripple" data-action="clear-checked">Clear</button>
      </div>
      <ul class="group">${done.map(taskHTML).join('')}</ul>` : ''}`;
}

function renderMore() {
  const offlineReady = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
  const signedIn = !!sync.saved;
  let account;
  if (!sync.configured) {
    account = `
      <li><div class="row">
        <span class="row-icon">${icon('sync')}</span>
        <span class="row-text"><span class="row-title">Sync between phones</span>
          <span class="row-sub">Not set up yet — see “Sync between phones” in the README</span></span>
      </div></li>`;
  } else if (!signedIn) {
    account = `
      <li><button type="button" class="row accent ripple" data-action="sign-in">
        <span class="row-icon">${icon('login')}</span>
        <span class="row-text"><span class="row-title">Sign in to sync</span>
          <span class="row-sub">Share trips and plans with another phone using the same login</span></span>
      </button></li>`;
  } else {
    account = `
      <li><div class="row">
        <span class="row-icon">${icon(sync.status === 'error' ? 'error' : navigator.onLine ? 'cloud_done' : 'cloud_off')}</span>
        <span class="row-text"><span class="row-title">${esc(sync.saved.email)}</span>
          <span class="row-sub">${syncStatusText()}</span></span>
      </div></li>
      <li><button type="button" class="row ripple" data-action="sign-out">
        <span class="row-icon">${icon('logout')}</span>
        <span class="row-text"><span class="row-title">Sign out</span><span class="row-sub">Plans stay on this phone but stop syncing</span></span>
      </button></li>`;
  }

  $('#view-more').innerHTML = `
    <h1 class="headline">More</h1>

    <h2 class="group-label">Account</h2>
    <ul class="group">${account}</ul>

    <h2 class="group-label">Trips</h2>
    <ul class="group">
      ${state.trips.map(t => `
        <li><button type="button" class="row ripple" data-action="edit-trip" data-trip-id="${t.id}">
          <span class="trip-avatar" style="--c:${esc(t.color)}">${esc(t.name.charAt(0).toUpperCase())}</span>
          <span class="row-text">
            <span class="row-title">${esc(t.name)}</span>
            <span class="row-sub">${t.start && t.end ? esc(fmtDay(t.start) + ' – ' + fmtDay(t.end)) : 'No dates'} · ${plural(t.items.length, 'plan')}</span>
          </span>
          <span class="row-trail">${icon('edit')}</span>
        </button></li>`).join('')}
      <li><button type="button" class="row ripple" data-action="new-trip">
        <span class="row-icon">${icon('add')}</span>
        <span class="row-text"><span class="row-title">Add a trip</span></span>
      </button></li>
    </ul>

    <h2 class="group-label">Appearance</h2>
    <ul class="group">
      <li><div class="row">
        <div class="segmented" role="group" aria-label="Theme">
          ${[['auto', 'brightness_auto', 'Automatic'], ['light', 'light_mode', 'Light'], ['dark', 'dark_mode', 'Dark']].map(([value, ic, label]) => `
            <button type="button" class="ripple" data-action="theme" data-value="${value}" aria-pressed="${state.settings.theme === value}">${icon(ic)}${label}</button>`).join('')}
        </div>
      </div></li>
      <li><button type="button" class="row ripple" data-action="toggle-suggestions" role="switch" aria-checked="${state.settings.suggestions}">
        <span class="row-icon">${icon('auto_awesome')}</span>
        <span class="row-text"><span class="row-title">Day suggestions</span><span class="row-sub">Ideas under each day, from the city’s travel guide</span></span>
        <span class="switch ${state.settings.suggestions ? 'on' : ''}" aria-hidden="true"></span>
      </button></li>
      <li><button type="button" class="row ripple" data-action="toggle-lookup" role="switch" aria-checked="${state.settings.lookup}">
        <span class="row-icon">${icon('pin_drop')}</span>
        <span class="row-text"><span class="row-title">Find addresses on the map</span><span class="row-sub">Sends the place name you typed (not your plans) to OpenStreetMap's search</span></span>
        <span class="switch ${state.settings.lookup ? 'on' : ''}" aria-hidden="true"></span>
      </button></li>
    </ul>

    <h2 class="group-label">App</h2>
    <ul class="group">
      ${installPrompt ? `
        <li><button type="button" class="row accent ripple" data-action="install">
          <span class="row-icon">${icon('install_mobile')}</span>
          <span class="row-text"><span class="row-title">Install app</span><span class="row-sub">Add Trip Planner to your home screen</span></span>
        </button></li>` : ''}
      <li><div class="row">
        <span class="row-icon">${icon('offline_pin')}</span>
        <span class="row-text"><span class="row-title">Works offline</span>
          <span class="row-sub">${offlineReady ? '<span class="ok">Ready</span> — saved on this phone' : 'Open the app once while online'}</span></span>
      </div></li>
      <li><div class="row">
        <span class="row-icon">${icon('shield')}</span>
        <span class="row-text"><span class="row-title">Data protected</span>
          <span class="row-sub">${storagePersisted ? '<span class="ok">On</span> — Android won’t clear it' : 'Installing the app usually turns this on'}</span></span>
      </div></li>
    </ul>

    <h2 class="group-label">Backup</h2>
    <ul class="group">
      <li><button type="button" class="row ripple" data-action="export">
        <span class="row-icon">${icon('download')}</span>
        <span class="row-text"><span class="row-title">Save backup file</span><span class="row-sub">Goes to your Downloads folder</span></span>
      </button></li>
      <li><button type="button" class="row ripple" data-action="import">
        <span class="row-icon">${icon('upload')}</span>
        <span class="row-text"><span class="row-title">Restore from backup</span><span class="row-sub">Replaces what's in the app now</span></span>
      </button></li>
      <li><button type="button" class="row danger ripple" data-action="reset">
        <span class="row-icon">${icon('restart_alt')}</span>
        <span class="row-text"><span class="row-title">Erase everything</span><span class="row-sub">Start over with a clean slate</span></span>
      </button></li>
    </ul>
    <input type="file" id="import-file" accept=".json,application/json" hidden>

    <p class="footnote">${icon('shield', 'sm')}${signedIn
      ? 'Your plans are stored on this phone and in your account.'
      : 'Your plans are stored only on this phone.'}</p>
    <p class="footnote">Maps, address and place search: © OpenStreetMap contributors. City guides: Wikivoyage and Wikipedia, CC BY-SA.</p>`;
}

/* ---------- Plan form (add / edit) ---------- */

const itemDialog = $('#item-dialog');
const itemForm = $('#item-form');
let editingItemId = null;

$('#item-category').insertAdjacentHTML('beforeend', Object.entries(CATEGORIES).map(([k, c]) => `
  <label style="--h:${c.hue}"><input type="radio" name="category" value="${k}">
    <span class="ripple">${icon(c.icon + '-fill')}${esc(c.label)}</span></label>`).join(''));

function openItemForm(item, defaults = {}) {
  editingItemId = item ? item.id : null;
  const v = item || { title: '', category: 'sight', date: '', time: '', place: '', link: '', notes: '', ...defaults };
  $('#item-dialog-title').textContent = item ? 'Edit plan' : (v.date ? 'New plan' : 'New idea');
  for (const f of ['title', 'category', 'date', 'time', 'place', 'link', 'notes']) {
    itemForm.elements[f].value = v[f] || '';
  }
  $('#item-delete').hidden = !item;
  itemDialog.showModal();
  itemDialog.scrollTop = 0;
  if (!item) itemForm.elements.title.focus();
}

itemForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = itemForm.elements;
  const data = {
    title: f.title.value.trim(),
    category: f.category.value || 'other',
    date: f.date.value,
    time: f.time.value,
    place: f.place.value.trim(),
    link: f.link.value.trim(),
    notes: f.notes.value.trim(),
  };
  if (!data.title) return;
  const trip = activeTrip();
  if (editingItemId) {
    const found = findItem(editingItemId);
    if (found) {
      // A new address means the saved map position no longer applies.
      if (found.item.place !== data.place) {
        delete found.item.lat;
        delete found.item.lng;
        delete found.item.guideId;
        delete found.item.geoMiss;
      }
      // A new day or a set time replaces the position chosen by Optimize route.
      if (found.item.date !== data.date || data.time) delete found.item.slot;
      Object.assign(found.item, data);
    }
  } else {
    trip.items.push({ id: uid(), done: false, ...data });
  }
  save();
  itemDialog.close();
  render();
  snackbar(data.date ? `Saved to ${fmtDay(data.date, { weekday: 'long', month: 'short', day: 'numeric' })}` : 'Saved to Ideas');
});

$('#item-delete').addEventListener('click', () => {
  const found = findItem(editingItemId);
  if (!found) return;
  const { trip, item } = found;
  const index = trip.items.indexOf(item);
  trip.items.splice(index, 1);
  save();
  itemDialog.close();
  render();
  snackbar('Plan deleted', 'Undo', () => {
    trip.items.splice(index, 0, item);
    save();
    render();
  });
});

/* ---------- Trip form (add / edit) ---------- */

const tripDialog = $('#trip-dialog');
const tripForm = $('#trip-form');
let editingTripId = null;

$('#trip-colors').insertAdjacentHTML('beforeend', COLORS.map(c => `
  <label><input type="radio" name="color" value="${c}" aria-label="Color ${c}">
    <span class="ripple" style="--c:${c}">${icon('check')}</span></label>`).join(''));

/* Place search: as you type the trip's name, matching cities and countries
   appear below it. Picking one ties the trip to that real place. */
const placeSearch = { chosen: null, results: [], timer: 0, ctl: null };

function showChosenPlace() {
  const p = placeSearch.chosen;
  $('#place-chosen').hidden = !p;
  if (p) $('#place-chosen').innerHTML = `${icon('location_on')}<span>${esc(p.label)}</span><span class="kind">${KIND_LABEL[p.kind]}</span>`;
}

function showPlaceResults(results, note = '') {
  placeSearch.results = results;
  const box = $('#place-list');
  box.hidden = !results.length && !note;
  box.innerHTML = note ? `<li class="place-note">${esc(note)}</li>` : results.map((p, i) => `
    <li><button type="button" class="place-opt ripple" data-place-index="${i}">
      ${icon(p.kind === 'city' ? 'location_on' : 'public')}
      <span class="row-text"><span class="row-title">${esc(p.name)}</span><span class="row-sub">${esc([p.label.split(', ').slice(1).join(', '), KIND_LABEL[p.kind]].filter(Boolean).join(' · '))}</span></span>
    </button></li>`).join('');
}

function onTripNameInput() {
  const q = tripForm.elements.name.value.trim();
  // Typed something else than the chosen place: it will be looked up again.
  if (placeSearch.chosen && !norm(q).includes(norm(placeSearch.chosen.name))) {
    placeSearch.chosen = null;
    showChosenPlace();
  }
  clearTimeout(placeSearch.timer);
  if (placeSearch.ctl) placeSearch.ctl.abort();
  if (q.length < 2 || !navigator.onLine) return showPlaceResults([]);
  placeSearch.timer = setTimeout(async () => {
    const ctl = placeSearch.ctl = new AbortController();
    try {
      const results = await searchPlaces(q, ctl.signal);
      showPlaceResults(results, results.length ? '' : 'No matching city or country found');
    } catch (err) {
      if (err.name !== 'AbortError') showPlaceResults([]);
    }
  }, 300);
}
tripForm.elements.name.addEventListener('input', onTripNameInput);

$('#place-list').addEventListener('click', (e) => {
  const opt = e.target.closest('[data-place-index]');
  if (!opt) return;
  const place = placeSearch.results[Number(opt.dataset.placeIndex)];
  placeSearch.chosen = place;
  tripForm.elements.name.value = place.name.slice(0, 40);
  showChosenPlace();
  showPlaceResults([]);
});

function openTripForm(trip) {
  editingTripId = trip ? trip.id : null;
  $('#trip-dialog-title').textContent = trip ? 'Edit trip' : 'New trip';
  const f = tripForm.elements;
  f.name.value = trip ? trip.name : '';
  f.start.value = trip ? trip.start : '';
  f.end.value = trip ? trip.end : '';
  f.color.value = trip ? trip.color : COLORS[state.trips.length % COLORS.length];
  placeSearch.chosen = (trip && trip.place) || null;
  showChosenPlace();
  showPlaceResults([]);
  $('#trip-delete').hidden = !trip || state.trips.length < 2;
  tripDialog.showModal();
  if (!trip) f.name.focus();
}

tripForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = tripForm.elements;
  let start = f.start.value, end = f.end.value;
  if (start && !end) end = start;
  if (end && !start) start = end;
  if (start && end && end < start) [start, end] = [end, start];
  const data = {
    name: f.name.value.trim(),
    start, end,
    color: f.color.value || COLORS[0],
  };
  if (!data.name) return;

  // No place picked from the list: use the best match for the name.
  let place = placeSearch.chosen;
  const builtIn = GUIDES.some(g => g.match.test(data.name));
  if (!place && !builtIn && navigator.onLine) {
    const btn = tripForm.querySelector('[type="submit"]');
    btn.disabled = true;
    showPlaceResults([], `Finding ${data.name}…`);
    place = await findPlace(data.name);
    btn.disabled = false;
    showPlaceResults([]);
  }
  if (!tripDialog.open) return;

  let trip;
  if (editingTripId) {
    trip = state.trips.find(t => t.id === editingTripId);
    if (!trip) return;
    Object.assign(trip, data);
  } else {
    trip = { id: uid(), items: [], ...data };
    state.trips.push(trip);
    state.activeTripId = trip.id;
    ui.view = 'plan';
  }
  if (place) trip.place = place;
  else if (!builtIn) delete trip.place;
  save();
  tripDialog.close();
  render();
  if (place && !guideFor(trip) && guideState(trip) === 'loading') snackbar(`Found ${place.label} — getting ideas…`);
  else if (!place && !builtIn && navigator.onLine) snackbar(`Couldn’t find ${data.name} on the map — no suggestions for it`);
});

$('#trip-delete').addEventListener('click', async () => {
  const trip = state.trips.find(t => t.id === editingTripId);
  if (!trip || state.trips.length < 2) return;
  const ok = await askConfirm({
    icon: 'delete',
    title: `Delete ${trip.name}?`,
    text: `This removes the trip and its ${plural(trip.items.length, 'plan')} from this phone.`,
    ok: 'Delete',
  });
  if (!ok) return;
  state.trips = state.trips.filter(t => t.id !== trip.id);
  if (state.activeTripId === trip.id) state.activeTripId = state.trips[0].id;
  save();
  tripDialog.close();
  render();
  snackbar(`${trip.name} deleted`);
});

/* ---------- Sign in (for sync between phones) ---------- */

const authDialog = $('#auth-dialog');
const authForm = $('#auth-form');

function openAuthForm() {
  authForm.reset();
  $('#auth-error').hidden = true;
  authDialog.showModal();
  authForm.elements.email.focus();
}

function authError(text) {
  $('#auth-error').textContent = text;
  $('#auth-error').hidden = !text;
}

async function runAuth(create) {
  const f = authForm.elements;
  const email = f.email.value.trim();
  const password = f.password.value;
  if (!email || !password) return authError('Enter the email and password.');
  if (create && password.length < 6) return authError('Use at least 6 characters for the password.');
  authError('');
  authForm.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    await signIn(email, password, create);
    authDialog.close();
    snackbar(create ? 'Account created — connecting…' : 'Signed in — connecting…');
  } catch (err) {
    authError(syncErrorText(err));
  } finally {
    authForm.querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
}

authForm.addEventListener('submit', (e) => { e.preventDefault(); runAuth(false); });
$('#auth-create').addEventListener('click', () => runAuth(true));
$('#auth-forgot').addEventListener('click', async () => {
  const email = authForm.elements.email.value.trim();
  if (!email) return authError('Enter your email first, then tap “Forgot password?” again.');
  try {
    await resetPassword(email);
    authError('');
    snackbar(`If ${email} has an account, a reset link is on its way`);
  } catch (err) {
    authError(syncErrorText(err));
  }
});
$('#auth-show').addEventListener('click', (e) => {
  const input = authForm.elements.password;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  e.currentTarget.setAttribute('aria-pressed', String(show));
  e.currentTarget.querySelector('use').setAttribute('href', `${SPRITE}#${show ? 'visibility_off' : 'visibility'}`);
});

// Close buttons and tapping the dark area outside a sheet close it.
for (const dlg of [itemDialog, tripDialog, authDialog, $('#confirm-dialog'), $('#map-dialog')]) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
}

/* ---------- Ticking things off (animated in place, then re-sorted) ---------- */

let rerenderTimer;
function tick(el, done) {
  el.classList.toggle('done', done);
  el.querySelector('.check').setAttribute('aria-checked', done);
  if (done && navigator.vibrate) navigator.vibrate(12);
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(render, 550);
}

/* ---------- Taps anywhere in the app ---------- */

document.addEventListener('click', async (e) => {
  const tripChip = e.target.closest('[data-trip]');
  if (tripChip) {
    if (tripChip.dataset.trip === state.activeTripId) return;
    state.activeTripId = tripChip.dataset.trip;
    save();
    window.scrollTo(0, 0);
    render();
    return;
  }

  const go = e.target.closest('[data-go]');
  if (go) {
    if (ui.view === go.dataset.go) return;
    ui.view = go.dataset.go;
    window.scrollTo(0, 0);
    render();
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const itemEl = el.closest('[data-id]');
  const checkEl = el.closest('[data-check]');

  switch (action) {
    case 'toggle': {
      const found = findItem(itemEl.dataset.id);
      if (found) {
        found.item.done = !found.item.done;
        save();
        tick(itemEl, found.item.done);
      }
      break;
    }
    case 'edit': {
      const found = findItem(itemEl.dataset.id);
      if (found) openItemForm(found.item);
      break;
    }
    case 'add-on-day':
      openItemForm(null, { date: el.dataset.date });
      break;
    case 'edit-trip':
      openTripForm(state.trips.find(t => t.id === el.dataset.tripId) || activeTrip());
      break;
    case 'new-trip':
      openTripForm(null);
      break;
    case 'toggle-check': {
      const c = state.checklist.find(x => x.id === checkEl.dataset.check);
      if (c) {
        c.done = !c.done;
        save();
        tick(checkEl, c.done);
      }
      break;
    }
    case 'del-check': {
      const index = state.checklist.findIndex(x => x.id === checkEl.dataset.check);
      if (index < 0) break;
      const [removed] = state.checklist.splice(index, 1);
      save();
      render();
      snackbar('Item removed', 'Undo', () => {
        state.checklist.splice(index, 0, removed);
        save();
        render();
      });
      break;
    }
    case 'clear-checked': {
      const before = state.checklist;
      state.checklist = before.filter(x => !x.done);
      save();
      render();
      snackbar(`Cleared ${plural(before.length - state.checklist.length, 'item')}`, 'Undo', () => {
        state.checklist = before;
        save();
        render();
      });
      break;
    }
    case 'add-suggestion': {
      const trip = activeTrip();
      const guide = guideFor(trip);
      const p = guide && guide.places.find(x => x.id === el.dataset.place);
      if (!p) break;
      const item = {
        id: uid(), title: p.name, category: p.cat, date: el.dataset.date || '', time: '',
        place: p.place || p.name, link: '', notes: '', done: false,
        lat: p.lat, lng: p.lng, guideId: p.id,
      };
      trip.items.push(item);
      save();
      render();
      if (navigator.vibrate) navigator.vibrate(12);
      snackbar(item.date ? `Added to ${fmtDay(item.date, { weekday: 'long' })}` : 'Saved to your ideas', 'Undo', () => {
        trip.items = trip.items.filter(i => i !== item);
        save();
        render();
      });
      break;
    }
    case 'shuffle':
      ui.shuffle[el.dataset.date] = (ui.shuffle[el.dataset.date] || 0) + 1;
      render();
      break;
    case 'ideas-tab':
      ui.ideasTab = el.dataset.tab;
      render();
      break;
    case 'open-ideas':
      ui.view = 'ideas';
      ui.ideasTab = el.dataset.tab;
      window.scrollTo(0, 0);
      render();
      break;
    case 'filter':
      ui.filter = el.dataset.filter;
      render();
      break;
    case 'theme':
      state.settings.theme = el.dataset.value;
      save();
      render();
      break;
    case 'toggle-suggestions':
      state.settings.suggestions = !state.settings.suggestions;
      save();
      render();
      break;
    case 'toggle-lookup':
      state.settings.lookup = !state.settings.lookup;
      if (state.settings.lookup) activeTrip().items.forEach(i => delete i.geoMiss);
      save();
      render();
      break;
    case 'day-map':
      openMap(el.dataset.date);
      break;
    case 'trip-map':
      openMap('all');
      break;
    case 'optimize':
      runOptimize(el.dataset.date);
      break;
    case 'undo-optimize':
      if (mapView.note && mapView.note.undo) mapView.note.undo();
      break;
    case 'focus-stop':
      focusStop(el.dataset.id);
      break;
    case 'share-trip':
      shareTrip();
      break;
    case 'retry-guide': {
      const trip = activeTrip();
      if (trip.place) loadGuide(trip.place, { retry: true });
      break;
    }
    case 'sign-in':
      openAuthForm();
      break;
    case 'sign-out': {
      const ok = await askConfirm({
        icon: 'logout',
        title: 'Sign out?',
        text: 'Your plans stay on this phone, but changes will no longer sync with other phones until you sign in again.',
        ok: 'Sign out',
      });
      if (ok) {
        await signOut();
        render();
        snackbar('Signed out');
      }
      break;
    }
    case 'export':
      exportBackup();
      break;
    case 'import':
      $('#import-file').click();
      break;
    case 'install':
      if (installPrompt) {
        installPrompt.prompt();
        installPrompt.userChoice.finally(() => { installPrompt = null; render(); });
      }
      break;
    case 'reset': {
      const ok = await askConfirm({
        icon: 'restart_alt',
        title: 'Erase everything?',
        text: sync.saved
          ? 'All trips, plans and checklist items will be deleted — on this phone and on every phone signed in to your account. Save a backup first if you might want them back.'
          : 'All trips, plans and checklist items on this phone will be deleted. Save a backup first if you might want them back.',
        ok: 'Erase',
      });
      if (ok) {
        state = defaultState();
        save();
        ui.view = 'plan';
        window.scrollTo(0, 0);
        render();
        snackbar('Started fresh');
      }
      break;
    }
  }
});

// Adding to the checklist.
document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form="check"]');
  if (!form) return;
  e.preventDefault();
  const text = form.elements.text.value.trim();
  if (!text) return;
  state.checklist.push({ id: uid(), text, done: false });
  save();
  render();
  $('[data-form="check"] input').focus();
});

// The big + button.
$('#fab').addEventListener('click', () => {
  if (ui.view === 'ideas') return openItemForm(null, { date: '' });
  const trip = activeTrip();
  const today = todayISO();
  const inTrip = trip.start && today >= trip.start && today <= trip.end;
  openItemForm(null, { date: inTrip ? today : (trip.start || '') });
});

/* ---------- Touch ripple ---------- */

document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.ripple');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const size = Math.hypot(r.width, r.height) * 2;
  const wave = document.createElement('span');
  wave.className = 'wave';
  wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  el.append(wave);
  wave.addEventListener('animationend', () => wave.remove());
});

/* ---------- Scrolling: tint the top bar, shrink the + button ---------- */

let lastY = 0;
function onScroll() {
  const y = window.scrollY;
  $('#appbar').classList.toggle('scrolled', y > 4);
  $('#appbar').classList.toggle('show-title', y > 56);
  if (Math.abs(y - lastY) > 6 || y < 10) {
    $('#fab').classList.toggle('collapsed', y > lastY && y > 120);
    lastY = y;
  }
}
window.addEventListener('scroll', onScroll, { passive: true });

/* ---------- Backup & restore ---------- */

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `trip-planner-backup-${todayISO()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  snackbar('Backup saved to Downloads');
}

// Checks a backup file and keeps only the fields the app understands.
function cleanBackup(data) {
  const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
  const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const time = v => (/^\d{2}:\d{2}$/.test(v) ? v : '');
  const coord = (v, max) => (typeof v === 'number' && Math.abs(v) <= max ? v : undefined);
  const cleanPlace = (p) => {
    if (!p || typeof p !== 'object' || coord(p.lat, 90) === undefined || coord(p.lng, 180) === undefined || !str(p.name)) return undefined;
    const bbox = Array.isArray(p.bbox) && p.bbox.length === 4 && p.bbox.every(v => typeof v === 'number') ? p.bbox : null;
    return {
      name: str(p.name, 100), label: str(p.label, 200) || str(p.name, 100),
      kind: KIND_LABEL[p.kind] ? p.kind : 'city',
      lat: p.lat, lng: p.lng, bbox, osm: /^[NWR]\d+$/.test(p.osm) ? p.osm : '',
    };
  };
  if (!data || !Array.isArray(data.trips) || !data.trips.length) throw new Error('not a backup');
  const trips = data.trips.map(t => ({
    id: str(t.id, 100) || uid(),
    name: str(t.name, 40) || 'Trip',
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : COLORS[0],
    start: date(t.start),
    end: date(t.end),
    place: cleanPlace(t.place),
    items: (Array.isArray(t.items) ? t.items : []).map(i => ({
      id: str(i.id, 100) || uid(),
      title: str(i.title, 120) || 'Untitled',
      category: CATEGORIES[i.category] ? i.category : 'other',
      date: date(i.date),
      time: time(i.time),
      place: str(i.place, 200),
      link: str(i.link, 500),
      notes: str(i.notes),
      done: i.done === true,
      lat: coord(i.lat, 90),
      lng: coord(i.lng, 180),
      guideId: str(i.guideId, 60) || undefined,
      slot: /^\d{2}:\d{2}~\d{2}$/.test(i.slot) ? i.slot : undefined,
      geoMiss: i.geoMiss === true || undefined,
    })),
  }));
  const checklist = (Array.isArray(data.checklist) ? data.checklist : [])
    .map(c => ({ id: str(c.id, 100) || uid(), text: str(c.text, 200), done: c.done === true }))
    .filter(c => c.text);
  const activeTripId = trips.some(t => t.id === data.activeTripId) ? data.activeTripId : trips[0].id;
  const s = data.settings || {};
  const settings = {
    theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto',
    suggestions: s.suggestions !== false,
    lookup: s.lookup !== false,
  };
  return { version: 1, activeTripId, trips, checklist, settings };
}

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'import-file') return;
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let restored;
  try {
    restored = cleanBackup(JSON.parse(await file.text()));
  } catch {
    snackbar("That file isn't a Trip Planner backup");
    return;
  }
  const n = restored.trips.reduce((sum, t) => sum + t.items.length, 0);
  const ok = await askConfirm({
    icon: 'upload',
    title: 'Restore this backup?',
    text: `It has ${plural(restored.trips.length, 'trip')} and ${plural(n, 'plan')}. It will replace everything currently in the app` +
      (sync.saved ? ' — also on the other phones signed in to your account.' : '.'),
    ok: 'Restore',
  });
  if (!ok) return;
  state = restored;
  save();
  ui.view = 'plan';
  render();
  snackbar('Backup restored');
});

/* ---------- Offline & install support ---------- */

let installPrompt = null;      // Chrome hands us this when the app can be installed
let storagePersisted = false;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (ui.view === 'more') render();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  snackbar('Installed! Find Trip Planner on your home screen.');
});

function updateOnlineBadge() { $('#offline-badge').hidden = navigator.onLine; }
function onConnectionChange() {
  updateOnlineBadge();
  // Back online: look up places and guides that couldn't be fetched offline.
  if (navigator.onLine) placeTried.clear();
  render();
}
window.addEventListener('online', onConnectionChange);
window.addEventListener('offline', onConnectionChange);
updateOnlineBadge();

if ('serviceWorker' in navigator) {
  const hadOldVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // Android often resumes the app instead of restarting it, so also
      // check for a new version every time the app comes back on screen.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(err => console.warn('Offline mode unavailable', err));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadOldVersion) snackbar('A new version is ready', 'Reload', () => location.reload(), 15000);
  });
}

// Ask Android not to clear our saved data when the phone is low on space.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted()
    .then(p => p || navigator.storage.persist())
    .then(p => { storagePersisted = p; if (ui.view === 'more') render(); })
    .catch(() => {});
}

/* ---------- Start ---------- */

render();
startSync();

// If the trip is happening now, jump to today's card.
const todayCard = document.getElementById('day-' + todayISO());
if (todayCard) todayCard.scrollIntoView({ block: 'start' });
