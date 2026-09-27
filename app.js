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
  const q = place.toLowerCase().includes(trip.name.toLowerCase()) ? place : `${place}, ${trip.name}`;
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

/* ---------- Snackbar (message bar at the bottom, with optional Undo) ---------- */

let snackTimer;
function snackbar(msg, actionLabel, onAction) {
  const bar = $('#snackbar');
  const btn = $('#snackbar-action');
  $('#snackbar-msg').textContent = msg;
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  btn.onclick = () => { hideSnackbar(); onAction && onAction(); };
  bar.classList.add('show');
  document.body.classList.add('snack-open');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnackbar, actionLabel ? 5000 : 2800);
}
function hideSnackbar() {
  $('#snackbar').classList.remove('show');
  document.body.classList.remove('snack-open');
}

/* ---------- Confirmation dialog for big decisions ---------- */

function askConfirm({ icon: ic, title, text, ok }) {
  const dlg = $('#confirm-dialog');
  $('#confirm-icon').setAttribute('href', `${SPRITE}#${ic}`);
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = ok;
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
  };
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

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    snackbar('Could not save — phone storage may be full');
  }
}

let state = load();
save();

const ui = { view: 'plan' };

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

function applyTheme(seed) {
  document.documentElement.style.setProperty('--seed', seed);
  // Paint Android's status bar to match the app background.
  const bg = getComputedStyle($('#theme-probe')).backgroundColor;
  $('meta[name="theme-color"]').setAttribute('content', toHex(bg));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(activeTrip().color));

/* ---------- Drawing the screen ---------- */

const TITLES = { plan: '', ideas: '', pack: 'Checklist', more: 'More' };

function render() {
  const trip = activeTrip();
  state.activeTripId = trip.id;
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

function byTime(a, b) {
  if (a.time && b.time) return a.time.localeCompare(b.time);
  if (a.time) return -1;
  if (b.time) return 1;
  return 0;
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
      <button type="button" class="icon-btn hero-edit ripple" data-action="edit-trip" aria-label="Edit trip">${icon('edit')}</button>
    </section>`;

  if (!days.length) {
    html += emptyState('event_available', 'Your days will appear here',
      `Add the dates for ${esc(trip.name)} and you'll see the trip day by day.`,
      ideas ? `<button type="button" class="btn tonal ripple" data-go="ideas">${icon('lightbulb')}See ${plural(ideas, 'idea')}</button>` : '');
  }

  for (const day of days) {
    const items = trip.items.filter(it => it.date === day).sort(byTime);
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
          ? `<ul class="group">${items.map(it => itemHTML(it, trip)).join('')}</ul>`
          : `<button type="button" class="empty-day ripple" data-action="add-on-day" data-date="${day}">${icon('add')}Free day — tap to add a plan</button>`}
      </section>`;
  }

  $('#view-plan').innerHTML = html;
}

function renderIdeas(trip) {
  const ideas = trip.items.filter(i => !i.date);
  $('#view-ideas').innerHTML = `
    <h1 class="headline">Ideas</h1>
    <p class="supporting">Things you might do in ${esc(trip.name)}. Tap one and pick a day to add it to your plan.</p>
    ${ideas.length
      ? `<ul class="group">${ideas.map(it => itemHTML(it, trip)).join('')}</ul>`
      : emptyState('travel_explore', 'No ideas yet', 'Save places you hear about here, then schedule them later.')}`;
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
  $('#view-more').innerHTML = `
    <h1 class="headline">More</h1>

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

    <p class="footnote">${icon('shield', 'sm')}Your plans are stored only on this phone.</p>`;
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
    if (found) Object.assign(found.item, data);
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

function openTripForm(trip) {
  editingTripId = trip ? trip.id : null;
  $('#trip-dialog-title').textContent = trip ? 'Edit trip' : 'New trip';
  const f = tripForm.elements;
  f.name.value = trip ? trip.name : '';
  f.start.value = trip ? trip.start : '';
  f.end.value = trip ? trip.end : '';
  f.color.value = trip ? trip.color : COLORS[state.trips.length % COLORS.length];
  $('#trip-delete').hidden = !trip || state.trips.length < 2;
  tripDialog.showModal();
  if (!trip) f.name.focus();
}

tripForm.addEventListener('submit', (e) => {
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
  if (editingTripId) {
    Object.assign(state.trips.find(t => t.id === editingTripId), data);
  } else {
    const trip = { id: uid(), items: [], ...data };
    state.trips.push(trip);
    state.activeTripId = trip.id;
    ui.view = 'plan';
  }
  save();
  tripDialog.close();
  render();
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

// Close buttons and tapping the dark area outside a sheet close it.
for (const dlg of [itemDialog, tripDialog, $('#confirm-dialog')]) {
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
        text: 'All trips, plans and checklist items on this phone will be deleted. Save a backup first if you might want them back.',
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
  if (!data || !Array.isArray(data.trips) || !data.trips.length) throw new Error('not a backup');
  const trips = data.trips.map(t => ({
    id: str(t.id, 100) || uid(),
    name: str(t.name, 40) || 'Trip',
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : COLORS[0],
    start: date(t.start),
    end: date(t.end),
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
    })),
  }));
  const checklist = (Array.isArray(data.checklist) ? data.checklist : [])
    .map(c => ({ id: str(c.id, 100) || uid(), text: str(c.text, 200), done: c.done === true }))
    .filter(c => c.text);
  const activeTripId = trips.some(t => t.id === data.activeTripId) ? data.activeTripId : trips[0].id;
  return { version: 1, activeTripId, trips, checklist };
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
    text: `It has ${plural(restored.trips.length, 'trip')} and ${plural(n, 'plan')}. It will replace everything currently in the app.`,
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
window.addEventListener('online', updateOnlineBadge);
window.addEventListener('offline', updateOnlineBadge);
updateOnlineBadge();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Offline mode unavailable', err));
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

// If the trip is happening now, jump to today's card.
const todayCard = document.getElementById('day-' + todayISO());
if (todayCard) todayCard.scrollIntoView({ block: 'start' });
