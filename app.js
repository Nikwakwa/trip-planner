'use strict';

/* =========================================================
   Trip Planner — all app behavior lives in this file.
   Data is kept in the browser's localStorage on the phone.
   ========================================================= */

const STORAGE_KEY = 'tripPlanner.v1';

const COLORS = ['#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f', '#455a64'];

const CATEGORIES = {
  sight:     { label: 'Sightseeing', icon: '🏛️' },
  food:      { label: 'Food & drink', icon: '🍽️' },
  event:     { label: 'Show / event', icon: '🎟️' },
  shopping:  { label: 'Shopping', icon: '🛍️' },
  transport: { label: 'Getting around', icon: '🚆' },
  stay:      { label: 'Hotel / stay', icon: '🛏️' },
  other:     { label: 'Other', icon: '📌' },
};

/* ---------- Small helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);

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
function fmtDay(s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return parseDate(s).toLocaleDateString(undefined, opts);
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

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

function mapsUrl(place, trip) {
  const q = place.toLowerCase().includes(trip.name.toLowerCase()) ? place : `${place}, ${trip.name}`;
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

let toastTimer;
function toast(msg) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
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
    toast('⚠️ Could not save — phone storage may be full');
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

/* ---------- Drawing the screen ---------- */

function render() {
  const trip = activeTrip();
  state.activeTripId = trip.id;

  // Trip color becomes the app's accent color.
  document.documentElement.style.setProperty('--accent', trip.color);
  $('meta[name="theme-color"]').setAttribute('content', trip.color);

  renderTripTabs(trip);

  for (const v of ['plan', 'ideas', 'pack', 'more']) {
    $('#view-' + v).hidden = v !== ui.view;
  }
  document.querySelectorAll('.tabbar button').forEach(b =>
    b.classList.toggle('active', b.dataset.go === ui.view));
  $('#fab').hidden = !(ui.view === 'plan' || ui.view === 'ideas');
  $('#trip-tabs').hidden = ui.view === 'pack' || ui.view === 'more';

  if (ui.view === 'plan') renderPlan(trip);
  if (ui.view === 'ideas') renderIdeas(trip);
  if (ui.view === 'pack') renderChecklist();
  if (ui.view === 'more') renderMore();
}

function renderTripTabs(trip) {
  $('#trip-tabs').innerHTML =
    state.trips.map(t =>
      `<button type="button" class="chip ${t.id === trip.id ? 'active' : ''}" data-trip="${t.id}">${esc(t.name)}</button>`
    ).join('') +
    `<button type="button" class="chip add" data-action="new-trip">+ Trip</button>`;
}

function itemHTML(item, trip, { showDate = false } = {}) {
  const cat = CATEGORIES[item.category] || CATEGORIES.other;
  const link = safeUrl(item.link);
  const sub = [
    showDate && item.date ? fmtDay(item.date) : '',
    item.place,
  ].filter(Boolean).join(' · ');
  return `
    <li class="item ${item.done ? 'done' : ''}" data-id="${item.id}">
      <button type="button" class="check" data-action="toggle" aria-label="${item.done ? 'Mark not done' : 'Mark done'}" aria-pressed="${item.done}"></button>
      <button type="button" class="item-body" data-action="edit">
        <div class="item-title">${item.time ? `<span class="item-time">${esc(fmtTime(item.time))}</span>` : ''}${cat.icon} ${esc(item.title)}</div>
        ${sub ? `<div class="item-sub">${esc(sub)}</div>` : ''}
        ${item.notes ? `<div class="item-notes">${esc(item.notes)}</div>` : ''}
      </button>
      ${link ? `<a class="icon-link" href="${esc(link)}" target="_blank" rel="noopener" aria-label="Open link">🔗</a>` : ''}
      ${item.place ? `<a class="icon-link" href="${esc(mapsUrl(item.place, trip))}" target="_blank" rel="noopener" aria-label="Open in Maps">📍</a>` : ''}
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

function renderPlan(trip) {
  const days = tripDays(trip);
  const today = todayISO();
  let dateText = 'No dates set yet';
  if (trip.start && trip.end) {
    const n = Math.round((parseDate(trip.end) - parseDate(trip.start)) / 864e5) + 1;
    dateText = `${fmtDay(trip.start, { month: 'short', day: 'numeric' })} – ${fmtDay(trip.end, { month: 'short', day: 'numeric' })} · ${n} day${n === 1 ? '' : 's'}`;
  }

  let html = `
    <div class="summary">
      <span class="grow">📆 ${esc(dateText)}</span>
      <button type="button" class="btn small" data-action="edit-trip">Edit trip</button>
    </div>`;

  if (!days.length) {
    const ideas = trip.items.filter(i => !i.date).length;
    html += `
      <div class="card empty">
        <p>Set the dates for your ${esc(trip.name)} trip to see it day by day.</p>
        <button type="button" class="btn primary" data-action="edit-trip">Set dates</button>
        ${ideas ? `<p>You have ${ideas} idea${ideas === 1 ? '' : 's'} waiting in 💡 Ideas.</p>` : ''}
      </div>`;
  }

  days.forEach((day, i) => {
    const items = trip.items.filter(it => it.date === day).sort(byTime);
    const inRange = trip.start && trip.end && day >= trip.start && day <= trip.end;
    const dayNum = inRange ? Math.round((parseDate(day) - parseDate(trip.start)) / 864e5) + 1 : null;
    html += `
      <div class="card day ${day === today ? 'today' : ''}" id="day-${day}">
        <div class="day-head">
          <h3>${esc(fmtDay(day))}</h3>
          ${day === today ? '<span class="today-tag">Today</span>' : ''}
          <small>${dayNum ? 'Day ' + dayNum : 'Outside trip dates'}</small>
        </div>
        ${items.length
          ? `<ul class="items">${items.map(it => itemHTML(it, trip)).join('')}</ul>`
          : '<p class="empty">Nothing planned yet.</p>'}
        <button type="button" class="add-row" data-action="add-on-day" data-date="${day}">+ Add to this day</button>
      </div>`;
  });

  $('#view-plan').innerHTML = html;
}

function renderIdeas(trip) {
  const ideas = trip.items.filter(i => !i.date);
  $('#view-ideas').innerHTML = `
    <p class="note">Places and things you might do in ${esc(trip.name)}. Tap one and pick a day to move it into your plan.</p>
    ${ideas.length
      ? `<div class="card"><ul class="items">${ideas.map(it => itemHTML(it, trip)).join('')}</ul></div>`
      : '<div class="card empty">No ideas yet. Tap + to add one.</div>'}`;
}

function renderChecklist() {
  const list = state.checklist;
  const left = list.filter(c => !c.done).length;
  $('#view-pack').innerHTML = `
    <h2 class="section-title">Checklist <small class="note">${left} left</small></h2>
    <form class="add-form" data-form="check">
      <input name="text" placeholder="Add something to pack or do…" maxlength="200" autocomplete="off" aria-label="New checklist item">
      <button type="submit" class="btn primary">Add</button>
    </form>
    ${list.length ? `
      <div class="card"><ul class="items">
        ${list.map(c => `
          <li class="item ${c.done ? 'done' : ''}" data-check="${c.id}">
            <button type="button" class="check" data-action="toggle-check" aria-label="${c.done ? 'Mark not done' : 'Mark done'}" aria-pressed="${c.done}"></button>
            <div class="item-body"><div class="item-title">${esc(c.text)}</div></div>
            <button type="button" class="del" data-action="del-check" aria-label="Remove">×</button>
          </li>`).join('')}
      </ul></div>
      ${list.length > left ? '<button type="button" class="btn block" data-action="clear-checked">Remove checked items</button>' : ''}
    ` : '<div class="card empty">Your checklist is empty.</div>'}`;
}

function renderMore() {
  $('#view-more').innerHTML = `
    <h2 class="section-title">Trips</h2>
    <div class="card">
      ${state.trips.map(t => `
        <div class="row">
          <span class="dot" style="background:${esc(t.color)}"></span>
          <div class="grow">
            <strong>${esc(t.name)}</strong>
            <small>${t.start && t.end ? esc(fmtDay(t.start) + ' – ' + fmtDay(t.end)) : 'No dates'} · ${t.items.length} plan${t.items.length === 1 ? '' : 's'}</small>
          </div>
          <button type="button" class="btn small" data-action="edit-trip" data-trip-id="${t.id}">Edit</button>
        </div>`).join('')}
      <div class="btn-stack"><button type="button" class="btn" data-action="new-trip">+ Add a trip</button></div>
    </div>

    <h2 class="section-title">Your data</h2>
    <p class="note">Everything is saved only on this phone, inside this app. Nothing is uploaded.</p>
    <div class="card">
      <div class="btn-stack">
        <button type="button" class="btn danger" data-action="reset">Erase everything and start over</button>
      </div>
    </div>`;
}

/* ---------- Plan form (add / edit) ---------- */

const itemDialog = $('#item-dialog');
const itemForm = $('#item-form');
let editingItemId = null;

$('#item-category').innerHTML = Object.entries(CATEGORIES)
  .map(([k, c]) => `<option value="${k}">${c.icon} ${esc(c.label)}</option>`).join('');

function openItemForm(item, defaults = {}) {
  editingItemId = item ? item.id : null;
  const v = item || { title: '', category: 'sight', date: '', time: '', place: '', link: '', notes: '', ...defaults };
  $('#item-dialog-title').textContent = item ? 'Edit plan' : 'Add plan';
  for (const f of ['title', 'category', 'date', 'time', 'place', 'link', 'notes']) {
    itemForm.elements[f].value = v[f] || '';
  }
  $('#item-delete').hidden = !item;
  itemDialog.showModal();
  if (!item) itemForm.elements.title.focus();
}

itemForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = itemForm.elements;
  const data = {
    title: f.title.value.trim(),
    category: f.category.value,
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
  toast(data.date ? `Saved to ${fmtDay(data.date)}` : 'Saved to Ideas');
});

$('#item-delete').addEventListener('click', () => {
  const found = findItem(editingItemId);
  if (!found) return;
  if (!confirm(`Delete "${found.item.title}"?`)) return;
  found.trip.items = found.trip.items.filter(i => i.id !== editingItemId);
  save();
  itemDialog.close();
  render();
  toast('Deleted');
});

/* ---------- Trip form (add / edit) ---------- */

const tripDialog = $('#trip-dialog');
const tripForm = $('#trip-form');
let editingTripId = null;

$('#trip-colors').insertAdjacentHTML('beforeend', COLORS.map(c =>
  `<label><input type="radio" name="color" value="${c}"><span style="background:${c}"></span></label>`).join(''));

function openTripForm(trip) {
  editingTripId = trip ? trip.id : null;
  $('#trip-dialog-title').textContent = trip ? 'Edit trip' : 'New trip';
  const f = tripForm.elements;
  f.name.value = trip ? trip.name : '';
  f.start.value = trip ? trip.start : '';
  f.end.value = trip ? trip.end : '';
  const color = trip ? trip.color : COLORS[state.trips.length % COLORS.length];
  for (const r of f.color) r.checked = r.value === color;
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
  }
  save();
  tripDialog.close();
  render();
});

$('#trip-delete').addEventListener('click', () => {
  const trip = state.trips.find(t => t.id === editingTripId);
  if (!trip || state.trips.length < 2) return;
  if (!confirm(`Delete the whole "${trip.name}" trip and its ${trip.items.length} plans?`)) return;
  state.trips = state.trips.filter(t => t.id !== trip.id);
  if (state.activeTripId === trip.id) state.activeTripId = state.trips[0].id;
  save();
  tripDialog.close();
  render();
  toast('Trip deleted');
});

// Cancel buttons and tapping the dark area outside a form close it.
for (const dlg of [itemDialog, tripDialog]) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
}

/* ---------- Taps anywhere in the app ---------- */

document.addEventListener('click', (e) => {
  const tripChip = e.target.closest('[data-trip]');
  if (tripChip) {
    state.activeTripId = tripChip.dataset.trip;
    save();
    render();
    window.scrollTo(0, 0);
    return;
  }

  const go = e.target.closest('[data-go]');
  if (go) {
    ui.view = go.dataset.go;
    render();
    window.scrollTo(0, 0);
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const itemId = el.closest('[data-id]')?.dataset.id;
  const checkId = el.closest('[data-check]')?.dataset.check;

  switch (action) {
    case 'toggle': {
      const found = findItem(itemId);
      if (found) { found.item.done = !found.item.done; save(); render(); }
      break;
    }
    case 'edit': {
      const found = findItem(itemId);
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
      const c = state.checklist.find(x => x.id === checkId);
      if (c) { c.done = !c.done; save(); render(); }
      break;
    }
    case 'del-check':
      state.checklist = state.checklist.filter(x => x.id !== checkId);
      save(); render();
      break;
    case 'clear-checked':
      state.checklist = state.checklist.filter(x => !x.done);
      save(); render();
      break;
    case 'reset':
      if (confirm('Erase ALL trips, plans and checklist items on this phone? This cannot be undone.')) {
        state = defaultState();
        save();
        ui.view = 'plan';
        render();
        toast('Started fresh');
      }
      break;
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

/* ---------- Start ---------- */

render();

// If the trip is happening now, jump to today's card.
const todayCard = document.getElementById('day-' + todayISO());
if (todayCard) todayCard.scrollIntoView({ block: 'start' });
