'use strict';

/* archive.js — trips put away. An archived trip leaves the top bar and waits in the "Archived trips" sheet,
   just as it was: open it from there to look back, or unarchive it. The mark is the account's
   (state.archived: trip id → the day it was archived; synced as "arch_…" documents), not the trip's,
   so archiving a trip planned with other people only tidies your own top bar. */

const archiveDialog = $('#archive-dialog');

// Where to go once the trip on screen is archived: a trip under way, else the next one, else the latest.
function soonestTrip() {
  const today = todayISO();
  const rank = t => (!t.start ? 2 : t.end < today ? 3 : t.start <= today ? 0 : 1);
  const order = (a, b) => rank(a) - rank(b)
    || (rank(a) === 1 ? a.start.localeCompare(b.start) : rank(a) === 3 ? b.end.localeCompare(a.end) : 0);
  return tripsShown().sort(order)[0] || null;
}

function archiveTrip(trip) {
  const onScreen = state.activeTripId === trip.id;
  state.archived = { ...state.archived, [trip.id]: todayISO() };
  if (onScreen) leaveTrip((soonestTrip() || {}).id || null);
  save();
  render();
  // The archive's button on the top bar shows where the trip went: the bar slides to it, it nods, and the
  // bar slides back to the trip now on screen.
  const chip = $('#trip-tabs .archive-chip');
  if (chip && !$('#trip-tabs').hidden) {
    chip.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    chip.classList.add('pulse');
    chip.addEventListener('animationend', () => {
      const on = $('#trip-tabs .trip-chip.active');
      if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }, { once: true });
  }
  const text = trip.shared && sync.saved ? T('{trip} archived, only for you', { trip: trip.name }) : T('{trip} archived', { trip: trip.name });
  snackbar(text, T('Undo'), () => {
    if (!state.trips.includes(trip)) return;
    delete state.archived[trip.id];
    if (onScreen) leaveTrip(trip.id);
    save();
    render();
  });
}

// Back on the top bar. From the trip's own card it stays on screen; from the sheet, the sheet stays open.
function unarchiveTrip(trip) {
  if (!isArchived(trip)) return;
  delete state.archived[trip.id];
  save();
  render();
  if (archiveDialog.open) renderArchive();
  snackbar(T('{trip} is back on the top bar', { trip: trip.name }));
}

/* ---------- Looking back at an archived trip ----------
   Opened from the archive, it stays archived and is a step of its own: Back, the ✕ on its tab or Back on its
   card return to the trip and section it was opened from (ui.peek). It ends too when another trip is picked
   (render), and the app never starts on one (store.js). */

function openArchived(trip) {
  archiveDialog.close();
  if (ui.peek) ui.peek.id = trip.id;      // one archived trip after another: Back still returns to the start
  else {
    // Its step is marked with a number of its own: a step left over from an earlier look (another trip was
    // picked meanwhile) must not be taken for this one.
    ui.peek = { id: trip.id, trip: state.activeTripId, view: ui.view, step: Date.now() };
    pushView('plan', { peek: ui.peek.step });
  }
  leaveTrip(trip.id);
  saveLocal();
  render();
  showFabs();
}

// The ✕ and Back: through the history when the step is there, so the device's Back isn't left one step behind.
function closeArchived() {
  if (ui.peek && history.state && history.state.peek === ui.peek.step) history.back();
  else endPeek(ui.peek ? ui.peek.view : ui.view);
}

// Back to where the archived trip was opened from, or to the trips on the top bar.
function endPeek(view) {
  const from = ui.peek;
  ui.peek = null;
  const back = from && tripsShown().some(t => t.id === from.trip) ? from.trip : (soonestTrip() || {}).id || null;
  if (isArchived(activeTrip())) state.activeTripId = back;
  ui.view = VIEWS.includes(view) ? view : 'plan';
  scrollAt = {};
  saveLocal();
  render();
  window.scrollTo(0, 0);
  showFabs();
}

// Shows another trip, from its top.
function leaveTrip(id) {
  state.activeTripId = id;
  scrollAt = {};
  window.scrollTo(0, 0);
}

/* ---------- The "Archived trips" sheet ---------- */

// "Oct 3 – Oct 10, 2025": an archived trip is often from another year.
function tripSpan(t) {
  if (!t.start || !t.end) return T('No dates');
  const sameYear = t.start.slice(0, 4) === t.end.slice(0, 4);
  return `${fmtDay(t.start, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmtDay(t.end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function renderArchive() {
  // The latest trips first; those without dates by when they were archived.
  const when = t => t.end || state.archived[t.id];
  const trips = state.trips.filter(isArchived).sort((a, b) => when(b).localeCompare(when(a)));
  // The last one brought back: nothing left to show.
  if (!trips.length) { if (archiveDialog.open) archiveDialog.close(); return; }
  const signedIn = !!sync.saved;
  $('#archive-list').innerHTML = trips.map(t => `
    <li class="archive-row">
      <button type="button" class="row ripple" data-action="open-archived" data-trip-id="${esc(t.id)}">
        <span class="trip-avatar" style="--c:${esc(t.color)}">${esc(t.name.charAt(0).toUpperCase())}</span>
        <span class="row-text">
          <span class="row-title">${esc(t.name)}</span>
          <span class="row-sub">${esc(tripSpan(t))} · ${Tn(t.items.length, '{n} plan', '{n} plans')}${t.shared && signedIn ? ` · ${T('shared')}` : ''}</span>
        </span>
      </button>
      <button type="button" class="icon-btn ripple" data-action="unarchive" data-trip-id="${esc(t.id)}"
        aria-label="${T('Unarchive {trip}', { trip: esc(t.name) })}" title="${T('Unarchive')}">${icon('unarchive')}</button>
    </li>`).join('');
}

function openArchive() {
  if (!state.trips.some(isArchived)) return;
  renderArchive();
  archiveDialog.showModal();
}

/* ---------- Taps ---------- */

onAction('archive-list', () => openArchive());
// The trip card's Archive (a trip that is over), and its Unarchive; a row's Unarchive in the sheet.
onAction('archive-trip', () => { const trip = activeTrip(); if (trip) archiveTrip(trip); });
onAction('unarchive', (el) => {
  const trip = state.trips.find(t => t.id === el.dataset.tripId) || activeTrip();
  if (trip) unarchiveTrip(trip);
});
// Opens an archived trip to look at, without bringing it back to the top bar.
onAction('open-archived', (el) => {
  const trip = state.trips.find(t => t.id === el.dataset.tripId);
  if (trip) openArchived(trip);
});
onAction('close-archived', () => closeArchived());
