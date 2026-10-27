'use strict';

/* form-trip.js — the sheet to add or edit a trip, with the search for its place. */

const tripDialog = $('#trip-dialog');
const tripForm = $('#trip-form');
let editingTripId = null;

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
  const kept = !norm(tripForm.elements.name.value).includes(norm(p.name));
  const how = navigator.onLine ? T('To change it, pick another from the list.') : T('Go online to pick another.');
  $('#place-chosen').innerHTML = `${icon('location_on')}<span>${esc(p.label)}${kept ? `<small>${T('Still the trip’s place.')} ${how}</small>` : ''}</span><span class="kind">${KIND_LABEL[p.kind]}</span>`;
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
  if (!editingTripId && placeSearch.chosen && !norm(q).includes(norm(placeSearch.chosen.name))) placeSearch.chosen = null;
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

function openTripForm(trip) {
  editingTripId = trip ? trip.id : null;
  $('#trip-dialog-title').textContent = trip ? T('Edit trip') : state.trips.length ? T('New trip') : T('Where to?');
  const f = tripForm.elements;
  f.name.value = trip ? trip.name : '';
  f.start.value = trip ? trip.start : '';
  f.end.value = trip ? trip.end : '';
  f.color.value = trip ? trip.color : COLORS[state.trips.length % COLORS.length];
  f.travel.value = (trip && trip.travel) || 'transit';
  placeSearch.chosen = (trip && trip.place) || null;
  showChosenPlace();
  showPlaceResults([]);
  $('#trip-delete').hidden = !trip;
  $('#trip-delete-label').textContent = tripEndLabel(trip);     // share.js: "Leave trip" when it is someone else's
  tripDialog.showModal();
  draftStart(tripDialog);
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
  if (editingTripId) {
    trip = state.trips.find(t => t.id === editingTripId);
    if (!trip) return;
    Object.assign(trip, data);
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
  if (place && !guideFor(trip) && guideState(trip) === 'loading') snackbar(T('Found {place} — getting ideas…', { place: place.label }));
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
    title: T('Delete {trip}?', { trip: trip.name }),
    text: Tn(trip.items.length, 'This removes the trip and its {n} plan from this device.', 'This removes the trip and its {n} plans from this device.'),
    ok: T('Delete'),
  });
  if (!ok) return;
  state.trips = state.trips.filter(t => t.id !== trip.id);
  if (state.activeTripId === trip.id) state.activeTripId = state.trips.length ? state.trips[0].id : null;
  scrollAt = {};
  save();
  tripDialog.close();
  render();
  snackbar(T('{trip} deleted', { trip: trip.name }));
});

onAction('new-trip', () => openTripForm(null));
// The trip card's ✎, or a trip in Settings (data-trip-id).
onAction('edit-trip', el => openTripForm(state.trips.find(t => t.id === el.dataset.tripId) || activeTrip()));
