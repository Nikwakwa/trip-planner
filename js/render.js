'use strict';

/* render.js — drawing the screen: the sections and the device's Back button, render(), the trip tabs, the
   day strip (phones) and the sidebar (computers), and what scrolling does to the top bar and the buttons. */

// peek: an archived trip being looked at (archive.js): { id, trip, view, step }: the trip and section it was opened
// from, and the number of its step in the history.
const ui = { view: 'plan', ideasTab: 'mine', filter: 'all', shuffle: {}, suggest: {}, pickDay: null, peek: null };

/* ---------- The sections (Plan, Ideas, Checklist, Settings) ---------- */

// 'more' is the Settings section.
const VIEWS = ['plan', 'ideas', 'pack', 'more'];
let scrollAt = {};     // section → how far down it was left, to come back to the same spot
const pageView = () => (history.state && VIEWS.includes(history.state.view) ? history.state.view : 'plan');

// Switches section without drawing it (the caller renders). Leaving the Plan adds one step to the
// browser's history, so the device's Back button returns to the Plan instead of closing the app.
function setView(view) {
  const from = ui.view;
  if (view === from) return;
  scrollAt[from] = window.scrollY;
  try {
    if (from === 'plan') history.pushState({ view }, '');
    else if (view !== 'plan') history.replaceState({ view }, '');
    else if (pageView() !== 'plan') history.back();     // the popstate that follows finds the Plan already shown
  } catch { /* history unavailable: Back just leaves the app, as before */ }
  ui.view = view;
}

// Shows a section where it was left, or from its top.
function showView(view, { top = false } = {}) {
  setView(view);
  render();
  window.scrollTo(0, top ? 0 : scrollAt[view] || 0);
  showFabs();
}

// A step of its own in the history, that Back closes (an archived trip being looked at: mark { peek: <its number> }).
function pushView(view, mark) {
  scrollAt[ui.view] = window.scrollY;
  try { history.pushState({ view, ...mark }, ''); } catch { /* history unavailable: the ✕ still closes it */ }
  ui.view = view;
}

// The Back (or Forward) button.
window.addEventListener('popstate', () => {
  const view = pageView();
  // Back from an archived trip: where it was opened from (archive.js).
  if (ui.peek && !(history.state && history.state.peek === ui.peek.step)) { endPeek(view); return; }
  if (view === ui.view) return;
  scrollAt[ui.view] = window.scrollY;
  ui.view = view;
  render();
  window.scrollTo(0, scrollAt[view] || 0);
  showFabs();
});

/* ---------- Drawing the screen ---------- */

const TITLES = { plan: '', ideas: '', pack: T('Checklist'), more: T('Settings') };

// Trips made before place search (or saved while offline) get their place looked up once.
const placeTried = new Set();
function ensurePlace(trip) {
  if (trip.place || placeTried.has(trip.id) || !navigator.onLine) return;
  placeTried.add(trip.id);
  findPlace(trip.name).then((place) => {
    if (!place || trip.place || !state.trips.includes(trip)) return;
    trip.place = place;
    save();
    renderSoon();
  });
}

// A guide has just been fetched for a place (places.js).
// quiet: an older saved guide was refreshed in the background, so no message.
function onGuideReady(place, guide, quiet) {
  readyGuides.delete(placeKey(place));
  renderSoon();
  const trip = activeTrip();
  if (!quiet && trip && trip.place && placeKey(trip.place) === placeKey(place) && ui.view !== 'ideas') {
    snackbar(Tn(guide.places.length, '{n} idea for {place} ready', '{n} ideas for {place} ready', { place: place.name }), T('Explore'), () => {
      ui.ideasTab = 'explore';
      showView('ideas', { top: true });
    });
  }
}

function render() {
  const trip = activeTrip();
  state.activeTripId = trip ? trip.id : null;
  // No longer looking at that archived trip (another trip picked, it was unarchived or deleted).
  if (ui.peek && (!trip || trip.id !== ui.peek.id || !isArchived(trip))) ui.peek = null;
  if (trip) ensurePlace(trip);
  applyTheme(trip ? trip.color : COLORS[0]);

  for (const v of VIEWS) {
    $('#view-' + v).hidden = v !== ui.view;
  }
  document.querySelectorAll('.navbar button').forEach(b => {
    const on = b.dataset.go === ui.view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });

  const tripViews = ui.view === 'plan' || ui.view === 'ideas';
  $('#trip-tabs').hidden = !tripViews || !trip;
  $('#appbar-title').hidden = tripViews;
  $('#appbar-title').textContent = TITLES[ui.view];
  $('#fab').hidden = $('#ai-fab').hidden = !tripViews || !trip;
  $('#fab-label').textContent = ui.view === 'ideas' ? T('New idea') : T('New plan');
  $('#fab').setAttribute('aria-label', $('#fab-label').textContent);
  try {
    if (tripViews && !trip) renderWelcome();
    else if (tripViews) renderTripTabs(trip);

    if (trip && ui.view === 'plan') renderPlan(trip);
    if (trip && ui.view === 'ideas') renderIdeas(trip);
    if (ui.view === 'pack') renderChecklist();
    if (ui.view === 'more') renderMore();
  } catch (e) {
    renderFailed(e);
  }
  try {
    renderSidebar(trip);
    renderDayStrip(trip);
    syncMapDock();      // maps.js: on a wide window the map stays beside the plan
  } catch (e) {
    console.error(e);
    noteError(`Drawing around "${ui.view}": ${(e && e.message) || e}`);
  }
  onScroll();
}

// A section that can't be drawn (a fault in the app, or in what a guide sent): it says so instead of
// staying empty, and the other sections keep working. Settings has the backup and "Report a problem",
// which carries what went wrong.
function renderFailed(e) {
  console.error(e);
  noteError(`Drawing "${ui.view}": ${(e && e.message) || e}`);
  $('#view-' + ui.view).innerHTML = emptyState('error', T('This screen can’t be shown'),
    T('Your plans are safe on this device. Close the app and open it again. If this stays, save a backup file in Settings, and tell us there with “Report a problem”.'),
    ui.view === 'more' ? '' : `<div class="empty-actions"><button type="button" class="btn tonal ripple" data-go="more">${icon('settings')}${T('Settings')}</button></div>`);
}

// On a phone, the Plan tab has the trip's days under the top bar, to jump to one.
// The day on screen is highlighted while scrolling (markCurrentDay).
function renderDayStrip(trip) {
  const strip = $('#day-strip');
  const days = trip && ui.view === 'plan' ? tripDays(trip) : [];
  strip.hidden = days.length < 2;
  if (strip.hidden) return;
  const today = todayISO();
  strip.innerHTML = days.map((d, i) => {
    const date = parseDate(d);
    return `<button type="button" class="ripple ${d === today ? 'today' : ''}" data-action="jump-day" data-date="${d}"
      aria-label="${esc(fmtDay(d, { weekday: 'long', month: 'long', day: 'numeric' }))}">
      <i class="day-dot" style="background:${dayTint(i)}"></i><small>${esc(fmtDay(d, { weekday: 'short' }))}</small> <b>${date.getDate()}</b></button>`;
  }).join('');
  markCurrentDay();
}

function markCurrentDay() {
  if (ui.view !== 'plan') return;
  // The last day whose card has reached the top part of the screen.
  let current = null;
  for (const el of document.querySelectorAll('#view-plan .day')) {
    // At the very bottom of the page the last days can't reach the top: the last one counts.
    if (el.getBoundingClientRect().top < 200 || (scrollY > 0 && innerHeight + scrollY >= document.documentElement.scrollHeight - 4)) current = el.id.slice(4);
  }
  // Highlighted in the phone's day strip and in the computer's sidebar.
  for (const b of document.querySelectorAll('#day-strip button, .side-days button')) {
    const on = b.dataset.date === current;
    if (on && !b.classList.contains('on') && b.parentNode.id === 'day-strip') b.scrollIntoView({ block: 'nearest', inline: 'center' });
    b.classList.toggle('on', on);
  }
}

// On a computer, the sidebar also has the AI Assistant and the trip's days (to jump to one).
function renderSidebar(trip) {
  const days = trip ? tripDays(trip) : [];
  const today = todayISO();
  $('#side-extra').innerHTML = !trip ? '' : `
    <button type="button" class="side-ai ripple" data-action="assistant">${icon('auto_awesome')}${T('AI Assistant')}</button>
    ${days.length ? `
      <p class="side-label">${esc(trip.name)}</p>
      <ul class="side-days">
        ${days.map((d, k) => {
          const n = trip.items.filter(i => i.date === d).length;
          return `<li><button type="button" class="ripple ${d === today ? 'today' : ''}" data-action="jump-day" data-date="${d}">
            <i class="day-dot" style="background:${dayTint(k)}"></i><span>${esc(fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>${n ? `<small>${n}</small>` : ''}</button></li>`;
        }).join('')}
      </ul>` : ''}`;
}

// No trip yet: ask where the user wants to go. The Ideas tab says what will show up there.
function renderWelcome() {
  const ideas = ui.view === 'ideas';
  const archived = state.trips.filter(isArchived).length;     // all of them archived: they're one tap away
  $('#view-' + ui.view).innerHTML = `
    <section class="hero welcome">
      ${shape(HERO_SHAPE, 'hero-shape')}
      <p class="hero-overline">${ideas ? T('Ideas for your trip') : T('Plan a trip')}</p>
      <h1 class="hero-title">${T('Where do you want to go?').replace(/\S+-\S+/g, w => `<span class="nobr">${w}</span>`) /* "voulez-vous" stays together */}</h1>
      <button type="button" class="where-btn ripple" data-action="new-trip">
        ${icon('search')}<span>${T('Search a city or country')}</span>
      </button>
    </section>
    <p class="welcome-note">${ideas
      ? T('Pick a place first. Its sights, food and things to do show up here, to save for later or add to a day.')
      : T('Pick a place and you’ll get ideas for things to do there, day by day. Already planning on another device? Sign in under <b>Settings</b> to bring your trips here.')}</p>
    ${!ideas && sync.configured ? `<button type="button" class="btn text ripple welcome-join" data-action="join-trip">${icon('group')}${T('Invited to a trip? Join it')}</button>` : ''}
    ${archived ? `<button type="button" class="btn text ripple welcome-join" data-action="archive-list">${icon('archive')}${Tn(archived, '{n} archived trip', '{n} archived trips')}</button>` : ''}`;
}

// The trips on the top bar, then + and the archive (archive.js). An archived trip shows only while it's
// on screen, with the archive's icon and a ✕ that closes it (as Back does).
const barTrips = trip => state.trips.filter(t => !isArchived(t) || t.id === trip.id);
function renderTripTabs(trip) {
  const archived = state.trips.filter(isArchived).length;
  const label = Tn(archived, '{n} archived trip', '{n} archived trips');
  $('#trip-tabs').innerHTML =
    barTrips(trip).map(t => (isArchived(t) ? `
      <span class="trip-chip active archived" style="--c:${esc(t.color)}">
        ${icon('archive', 'sm')}${esc(t.name)}${sharedMark(t)}
        <button type="button" class="chip-close ripple" data-action="close-archived" aria-label="${T('Close {trip}', { trip: esc(t.name) })}"
          title="${T('Close {trip}', { trip: esc(t.name) })}">${icon('close', 'sm')}</button>
      </span>` : `
      <button type="button" class="trip-chip ripple ${t.id === trip.id ? 'active' : ''}" data-trip="${esc(t.id)}"
        style="--c:${esc(t.color)}" aria-pressed="${t.id === trip.id}">
        <span class="dot"></span>${esc(t.name)}${sharedMark(t)}
      </button>`)).join('') +
    `<button type="button" class="trip-chip add ripple" data-action="new-trip" aria-label="${T('Add a trip')}">${icon('add', 'sm')}</button>` +
    (archived ? `<button type="button" class="trip-chip archive-chip ripple" data-action="archive-list" aria-label="${label}" title="${label}">
      ${icon('archive', 'sm')}${archived}</button>` : '');
}

/* ---------- Scrolling: tint the top bar, shrink the + button ---------- */

let lastY = 0;
// Arriving in a section: the buttons are there, wherever the page is scrolled to.
function showFabs() {
  document.body.classList.remove('fabs-away');
  lastY = Infinity;
}
function onScroll() {
  const y = window.scrollY;
  $('#appbar').classList.toggle('scrolled', y > 4);
  $('#appbar').classList.toggle('show-title', y > 56);
  if (Math.abs(y - lastY) > 6 || y < 10) {
    // On a phone, scrolling down moves the + and AI buttons out of the way of the plans (and their done
    // circles); scrolling up, or reaching the end of the page, brings them back.
    const atEnd = innerHeight + y >= document.documentElement.scrollHeight - 8;
    document.body.classList.toggle('fabs-away', y > lastY && y > 120 && !atEnd);
    $('#fab').classList.toggle('collapsed', y > 120);
    lastY = y;
  }
  markCurrentDay();
}
window.addEventListener('scroll', onScroll, { passive: true });

/* ---------- Taps: trip tabs, the navigation bar, the days ---------- */

document.addEventListener('click', (e) => {
  const tripChip = e.target.closest('[data-trip]');
  if (tripChip) {
    if (tripChip.dataset.trip === state.activeTripId) return;
    state.activeTripId = tripChip.dataset.trip;
    save();
    scrollAt = {};
    window.scrollTo(0, 0);
    render();
    return;
  }
  // The navigation bar. Tapping the section already open goes back to its top.
  const go = e.target.closest('[data-go]');
  if (go) {
    if (ui.view === go.dataset.go) window.scrollTo({ top: 0, behavior: 'smooth' });
    else showView(go.dataset.go);
  }
});

// From the day strip or the sidebar: go to that day in the plan, and show it on the map beside it.
onAction('jump-day', (el) => {
  if (ui.view !== 'plan') { setView('plan'); render(); }
  const card = document.getElementById('day-' + el.dataset.date);
  if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (mapDocked()) openMap(el.dataset.date);
});
