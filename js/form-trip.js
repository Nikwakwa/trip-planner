'use strict';

/* form-trip.js — the sheet to add or edit a trip, with the search for its place. */

const tripDialog = $('#trip-dialog');
const tripForm = $('#trip-form');
let editingTripId = null;
let copyingTripId = null;      // the form makes a copy of this trip (Copy, in the trip's sheet)

$('#trip-colors').insertAdjacentHTML('beforeend', COLORS.map(c => `
  <label><input type="radio" name="color" value="${c}" aria-label="${T('Color {c}', { c })}">
    <span class="ripple" style="--c:${c}">${icon('check')}</span></label>`).join(''));

$('#trip-travel').insertAdjacentHTML('beforeend', Object.entries(TRAVEL_MODES).map(([k, m]) => `
  <label style="--h:${k === 'drive' ? 25 : 205}"><input type="radio" name="travel" value="${k}">
    <span class="ripple">${icon(m.icon)}${esc(m.label)}</span></label>`).join(''));

/* Place search: as you type the trip's name, matching cities and countries
   appear below it. Picking one ties the trip to that real place. */
const placeSearch = { chosen: null, results: [], timer: 0, ctl: null };

function showChosenPlace() {
  const p = placeSearch.chosen;
  $('#place-chosen').hidden = !p;
  if (!p) return;
  // A trip keeps its place under another name ("USA with Sam"): the form says so.
  const kept = !placeNames(p).some(n => norm(tripForm.elements.name.value).includes(norm(n)));
  const how = navigator.onLine ? T('To change it, pick another from the list.') : T('Go online to pick another.');
  $('#place-chosen').innerHTML = `${icon('location_on')}<span>${esc(localLabel(p))}${kept ? `<small>${T('Still the trip’s place.')} ${how}</small>` : ''}</span><span class="kind">${KIND_LABEL[p.kind]}</span>`;
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
  // Typed something else than the chosen place: a new trip's place is then looked up from its name.
  // A trip being edited keeps its place: a new name alone never moves the trip, nor loses its guide
  // while offline. Only picking a place from the list changes it.
  if (!editingTripId && !copyingTripId && placeSearch.chosen &&!placeNames(placeSearch.chosen).some(n => norm(q).includes(norm(n)))) placeSearch.chosen = null;
  showChosenPlace();
  clearTimeout(placeSearch.timer);
  if (placeSearch.ctl) placeSearch.ctl.abort();
  if (q.length < 2 || !navigator.onLine) return showPlaceResults([]);
  placeSearch.timer = setTimeout(async () => {
    const ctl = placeSearch.ctl = new AbortController();
    try {
      const results = await searchPlaces(q, ctl.signal);
      showPlaceResults(results, results.length ? '' : T('No matching city or country found'));
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

// The trip's sheet. With `copy`, it makes a new trip from that one: the same name, place and colors, its
// dates to change.
function openTripForm(trip, copy = false) {
  editingTripId = trip && !copy ? trip.id : null;
  copyingTripId = trip && copy ? trip.id : null;
  $('#trip-dialog-title').textContent = copy ? T('Copy {trip}', { trip: tripName(trip) })
    : trip ? T('Edit trip') : state.trips.length ? T('New trip') : T('Where to?');
  $('#trip-save').textContent = copy ? T('Make a copy') : T('Save');
  const note = $('#trip-copy-note');
  note.hidden = !copy;
  if (copy) {
    note.textContent = [
      T('The plans, ideas and checklist come along, nothing ticked off. Change the first day: the plans move with it.'),
      trip.shared ? T('The copy is yours alone.') : '',
    ].filter(Boolean).join(' ');
  }
  $('#trip-copy').hidden = !editingTripId;
  const f = tripForm.elements;
  f.name.value = trip ? tripName(trip) : '';
  f.start.value = trip ? trip.start : '';
  f.end.value = trip ? trip.end : '';
  f.color.value = trip ? trip.color : COLORS[state.trips.length % COLORS.length];
  f.travel.value = (trip && trip.travel) || 'transit';
  placeSearch.chosen = (trip && trip.place) || null;
  showChosenPlace();
  showPlaceResults([]);
  $('#trip-delete').hidden = !editingTripId;
  $('#trip-delete-label').textContent = tripEndLabel(trip);     // share.js: "Leave trip" when it is someone else's
  $('#trip-delete').setAttribute('aria-label', tripEndLabel(trip));
  $('#trip-delete').title = tripEndLabel(trip);
  // Archive or bring back (archive.js). On a phone this row shows icons only: the names are there for
  // screen readers, and on a long press.
  const archive = $('#trip-archive');
  archive.hidden = !editingTripId;
  const label = isArchived(trip) ? T('Unarchive') : T('Archive');
  archive.innerHTML = `${icon(isArchived(trip) ? 'unarchive' : 'archive')}<span>${label}</span>`;
  archive.setAttribute('aria-label', label);
  archive.title = label;
  if (!tripDialog.open) tripDialog.showModal();     // Copy switches the open sheet over
  draftStart(tripDialog);
  if (!trip) f.name.focus();
  if (copy) $('#trip-dialog-title').focus();
}

/* ---------- Copy a trip ---------- */

// A day moved by n days.
function shiftDay(day, n) {
  if (!isDate(day) || !n) return day;
  const d = parseDate(day);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// Where the trip's plans start: its first day, else its earliest plan.
const tripFirstDay = trip => trip.start || trip.items.map(i => i.date).filter(isDate).sort()[0] || '';

// A new trip of your own from another one, its plans moved by `days`. Nothing is done or booked yet. The
// people, hearts and the trip's shared list stay with the old trip (the list comes along as checklist lines),
// and so do the files: tickets are for the old dates.
function copyOfTrip(trip, days, data = {}) {
  const { shared, todos, hearts, names, items, dayTravel, ...rest } = JSON.parse(JSON.stringify(trip));
  const copy = { ...rest, ...data, id: uid() };
  copy.items = items.map(({ booked, ...it }) => {
    const out = { ...it, id: uid(), done: false, date: shiftDay(it.date, days) };
    if (it.until) out.until = shiftDay(it.until, days);
    return out;
  });
  if (dayTravel) copy.dayTravel = Object.fromEntries(Object.entries(dayTravel).map(([d, m]) => [shiftDay(d, days), m]));
  return copy;
}

// The old trip's own checklist lines (and its shared list), on the copy, not ticked.
function copyTripChecks(from, to) {
  const lines = [
    ...state.checklist.filter(c => c.trip === from.id).map(({ doneOn, ...c }) => c),
    ...(from.todos || []).map(c => ({ id: c.id, text: c.text })),
  ];
  state.checklist.push(...lines.map(c => ({ ...c, id: uid(), trip: to.id, done: false })));
}

// Copy, in the trip's sheet: the same sheet becomes the copy's, with the trip as it is saved.
$('#trip-copy').addEventListener('click', async () => {
  const trip = state.trips.find(t => t.id === editingTripId);
  if (!trip) return;
  if (draftChanged(tripDialog) && !await askConfirm({ icon: 'edit', ...DRAFTS.get(tripDialog).ask(), ok: T('Discard'), cancel: T('Keep editing') })) return;
  openTripForm(trip, true);
});

// Copying a trip with dates: the last day follows the first, so the copy is as long as the trip.
tripForm.elements.start.addEventListener('change', () => {
  const from = copyingTripId && state.trips.find(t => t.id === copyingTripId);
  const f = tripForm.elements;
  if (from && from.start && from.end && f.start.value) f.end.value = shiftDay(f.start.value, daysBetween(from.start, from.end));
});

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
    travel: TRAVEL_MODES[f.travel.value] ? f.travel.value : 'transit',
  };
  if (!data.name) return;

  // No place picked from the list: use the best match for the name.
  let place = placeSearch.chosen;
  if (!place && navigator.onLine) {
    const btn = tripForm.querySelector('[type="submit"]');
    btn.disabled = true;
    showPlaceResults([], T('Finding {place}…', { place: data.name }));
    place = await findPlace(data.name);
    btn.disabled = false;
    showPlaceResults([]);
  }
  if (!tripDialog.open) return;

  let trip;
  const copied = copyingTripId && state.trips.find(t => t.id === copyingTripId);
  if (editingTripId) {
    trip = state.trips.find(t => t.id === editingTripId);
    if (!trip) return;
    // The name shown in this language, left as it was: the trip keeps the name it has.
    if (data.name === tripName(trip)) data.name = trip.name;
    Object.assign(trip, data);
  } else if (copied) {
    if (data.name === tripName(copied)) data.name = copied.name;
    const first = tripFirstDay(copied);
    trip = copyOfTrip(copied, start && first ? daysBetween(first, start) : 0, data);
    state.trips.push(trip);
    copyTripChecks(copied, trip);
    state.activeTripId = trip.id;
    setView('plan');
    scrollAt = {};
  } else {
    trip = { id: uid(), items: [], ...data };
    state.trips.push(trip);
    state.activeTripId = trip.id;
    setView('plan');
    scrollAt = {};
  }
  if (place) trip.place = place;
  else delete trip.place;
  // Days set to what is now the trip's own way of getting around don't need their own setting.
  if (trip.dayTravel) {
    for (const d of Object.keys(trip.dayTravel)) if (trip.dayTravel[d] === trip.travel) delete trip.dayTravel[d];
    if (!Object.keys(trip.dayTravel).length) delete trip.dayTravel;
  }
  save();
  tripDialog.close();
  render();
  if (copied) snackbar(T('Copy made'));
  else if (place && !guideFor(trip) && guideState(trip) === 'loading') snackbar(T('Found {place} — getting ideas…', { place: localLabel(place) }));
  else if (!place && navigator.onLine) snackbar(T('Couldn’t find {place} on the map — no suggestions for it', { place: data.name }));
});

$('#trip-delete').addEventListener('click', async () => {
  const trip = state.trips.find(t => t.id === editingTripId);
  if (!trip) return;
  // Planned with other people: leaving it, or deleting it for everyone, goes through the account (share.js).
  if (trip.shared && sync.saved) {
    if (await endSharedTrip(trip)) tripDialog.close();
    return;
  }
  const ok = await askConfirm({
    icon: 'delete',
    title: T('Delete {trip}?', { trip: tripName(trip) }),
    text: Tn(trip.items.length, 'This removes the trip and its {n} plan from this device.', 'This removes the trip and its {n} plans from this device.'),
    ok: T('Delete'),
  });
  if (!ok) return;
  state.trips = state.trips.filter(t => t.id !== trip.id);
  if (state.archived) delete state.archived[trip.id];
  dropTripChecks(trip.id);      // view-checklist.js
  if (state.activeTripId === trip.id) state.activeTripId = firstTripId();
  scrollAt = {};
  save();
  tripDialog.close();
  render();
  snackbar(T('{trip} deleted', { trip: tripName(trip) }));
});

// Archive or bring back the trip being edited (archive.js). It leaves the sheet without saving, like Delete.
$('#trip-archive').addEventListener('click', async () => {
  const trip = state.trips.find(t => t.id === editingTripId);
  if (!trip) return;
  // Something changed in the form: it isn't lost without asking (sheets.js).
  if (draftChanged(tripDialog) && !await askConfirm({ icon: 'edit', ...DRAFTS.get(tripDialog).ask(), ok: T('Discard'), cancel: T('Keep editing') })) return;
  tripDialog.close();
  if (isArchived(trip)) unarchiveTrip(trip); else archiveTrip(trip);
});

onAction('new-trip', () => openTripForm(null));
// The trip card's ✎, or a trip in Settings (data-trip-id).
onAction('edit-trip', el => openTripForm(state.trips.find(t => t.id === el.dataset.tripId) || activeTrip()));
