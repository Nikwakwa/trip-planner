'use strict';

/* store.js — the plans: the starting data, the checks on data from outside the app (saved copy, account,
   backup files), loading and saving, and the one-time repairs at startup. */

const STORAGE_KEY = 'tripPlanner.v1';

/* ---------- Starting data (only used the very first time) ---------- */

// No trips at first: the app asks where the user wants to go.
function defaultState() {
  const check = (text) => ({ id: uid(), text, done: false });
  return {
    version: 1,
    activeTripId: null,
    trips: [],
    archived: {},
    checklist: [
      check(T('Phone charger + power bank')),
      check(T('Comfortable walking shoes')),
      check(T('ID / wallet')),
      check(T('Tap-to-pay set up on phone')),
      check(T('Light jacket / layers')),
    ],
    settings: defaultSettings(),
  };
}

function defaultSettings() {
  return { theme: 'auto', suggestions: true, lookup: true, booking: true, units: usesImperial() ? 'imperial' : 'metric', ...deviceFormats() };
}
// What this device has already done: the one-time repairs at startup (geoRetry) and the last "Updated to
// version" message. Kept when the plans are erased or replaced by a backup, or the repairs would run again
// on the next start and throw away the map positions of every plan with a street address.
// The language stays too: the texts on screen were picked in it (i18n.js).
const deviceMarks = () => ({ geoRetry: state.settings.geoRetry, seenVersion: state.settings.seenVersion, lang: state.settings.lang });

/* ---------- Checking data that comes from outside the app ----------
   The saved copy, the account (sync.js) and backup files all go through these. The fields the app
   relies on get the right type; anything else is left alone (a newer version may have added it).
   Something without a usable id gets a new one (newId), or is left out (returns null). */

function tidyTrip(t, newId = false) {
  if (!t || typeof t !== 'object' || (!isId(t.id) && !newId)) return null;
  // Both days or none, the first one first.
  const dated = isDate(t.start) && isDate(t.end);
  const out = {
    ...t,
    id: isId(t.id) ? t.id : uid(),
    name: (typeof t.name === 'string' && t.name) || T('Trip'),
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : COLORS[0],
    start: !dated ? '' : t.start <= t.end ? t.start : t.end,
    end: !dated ? '' : t.start <= t.end ? t.end : t.start,
  };
  const p = t.place;
  const num = (v, max) => typeof v === 'number' && Math.abs(v) <= max;
  if (p && typeof p === 'object' && num(p.lat, 90) && num(p.lng, 180) && typeof p.name === 'string' && p.name) {
    out.place = {
      ...p,
      label: (typeof p.label === 'string' && p.label) || p.name,
      kind: KIND_LABEL[p.kind] ? p.kind : 'city',
      bbox: Array.isArray(p.bbox) && p.bbox.length === 4 && p.bbox.every(v => typeof v === 'number') ? p.bbox : null,
      osm: /^[NWR]\d+$/.test(p.osm) ? p.osm : '',
    };
  } else {
    delete out.place;
  }
  if ('travel' in out && !TRAVEL_MODES[out.travel]) delete out.travel;
  if ('shared' in out && !isId(out.shared)) delete out.shared;      // share.js: planned with other people
  if ('dayTravel' in out) {
    const own = out.dayTravel && typeof out.dayTravel === 'object'
      ? Object.entries(out.dayTravel).filter(([d, m]) => isDate(d) && typeof m === 'string' && TRAVEL_MODES[m]) : [];
    if (own.length) out.dayTravel = Object.fromEntries(own); else delete out.dayTravel;
  }
  return out;
}

function tidyItem(i, newId = false) {
  if (!i || typeof i !== 'object' || (!isId(i.id) && !newId)) return null;
  const text = v => (typeof v === 'string' ? v : '');
  const out = {
    ...i,
    id: isId(i.id) ? i.id : uid(),
    title: text(i.title) || T('Untitled'),
    category: text(i.category) || 'other',
    date: isDate(i.date) ? i.date : '',
    time: isTime(i.time) ? i.time : '',
    place: text(i.place), link: text(i.link), notes: text(i.notes),
    done: i.done === true,
  };
  if (typeof out.lat !== 'number' || typeof out.lng !== 'number' || Math.abs(out.lat) > 90 || Math.abs(out.lng) > 180) { delete out.lat; delete out.lng; }
  if ('guideId' in out && !isId(out.guideId)) delete out.guideId;
  if ('slot' in out && !/^\d{2}:\d{2}~\d{2}$/.test(out.slot)) delete out.slot;
  if ('geoMiss' in out && out.geoMiss !== true) delete out.geoMiss;
  if ('booked' in out && typeof out.booked !== 'boolean') delete out.booked;
  if ('until' in out && !isDate(out.until)) delete out.until;
  return out;
}

function tidyCheck(c, newId = false) {
  if (!c || typeof c !== 'object' || typeof c.text !== 'string' || !c.text || (!isId(c.id) && !newId)) return null;
  return { ...c, id: isId(c.id) ? c.id : uid(), done: c.done === true };
}

// The archived trips (archive.js): trip id → the day it was archived.
function tidyArchived(a) {
  return Object.fromEntries(Object.entries(a && typeof a === 'object' ? a : {}).filter(([id, day]) => isId(id) && isDate(day)));
}

// The copy saved on this device: nothing is thrown away, whatever state it is in.
function tidyState(data) {
  const trips = data.trips.map((t) => {
    const trip = tidyTrip(t, true);
    if (trip) trip.items = (Array.isArray(t.items) ? t.items : []).map(i => tidyItem(i, true)).filter(Boolean);
    // The trip's own list, for everyone on the trip (only a trip planned with other people has one).
    if (trip && Array.isArray(t.todos)) trip.todos = t.todos.map(c => tidyCheck(c, true)).filter(Boolean);
    else if (trip) delete trip.todos;
    return trip;
  }).filter(Boolean);
  return {
    ...data,
    trips,
    archived: tidyArchived(data.archived),
    checklist: (Array.isArray(data.checklist) ? data.checklist : []).map(c => tidyCheck(c, true)).filter(Boolean),
    settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
  };
}

/* ---------- Loading & saving ---------- */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.trips)) return tidyState(data);
      throw new Error('saved data has no trips');
    }
  } catch (e) {
    console.warn('Could not read saved data', e);
    // Starting fresh would overwrite it: keep what was there, in case it can be rescued.
    try { localStorage.setItem(STORAGE_KEY + '.unreadable', localStorage.getItem(STORAGE_KEY)); } catch { /* storage full */ }
  }
  return defaultState();
}

function saveLocal() {
  const text = JSON.stringify(state);
  // When the storage is full, what can be fetched again makes room for the plans: what was read about
  // places, road routes, opening hours, forecasts, then the saved guides (they stay in use until the app is closed).
  for (const makeRoom of [null, INFO_KEY, ROUTES_KEY, HOURS_KEY, WEATHER_KEY, GUIDES_KEY]) {
    try {
      if (makeRoom) localStorage.removeItem(makeRoom);
      localStorage.setItem(STORAGE_KEY, text);
      return;
    } catch (e) { /* full: free the next one */ }
  }
  snackbar(T('Could not save — device storage may be full'));
}

// Saves on the phone, and sends the change to the account when signed in (sync.js).
function save() {
  saveLocal();
  pushChanges();
}

let state = load();
state.settings = { ...defaultSettings(), ...state.settings };
// Once after the address lookup got better at finding places: plans marked "not found on the map"
// are looked up again.
if (!(state.settings.geoRetry >= 2)) {
  for (const t of state.trips) t.items.forEach((i) => { delete i.geoMiss; });
}
// Once after it stopped settling for the street when a house number isn't known ("1000 Fifth Avenue"
// was pinned somewhere along Fifth Avenue): addresses with a house number are looked up again.
if (!(state.settings.geoRetry >= 3)) {
  state.settings.geoRetry = 3;
  for (const t of state.trips) t.items.forEach((i) => {
    if (/^\s*\d/.test(i.place || '')) { delete i.lat; delete i.lng; delete i.geoMiss; }
  });
}
// Once after a street address stopped counting as the city named in it ("117 MacDougal St, New York, NY"
// was pinned at the center of New York): those plans are looked up again.
if (!(state.settings.geoRetry >= 4)) {
  state.settings.geoRetry = 4;
  for (const t of state.trips) t.items.forEach((i) => {
    if (i.guideId && /^\s*\d/.test(i.place || '')) { delete i.lat; delete i.lng; delete i.guideId; delete i.geoMiss; }
  });
}
// Once after a plan with an address stopped being pinned on the guide place with its name ("Würzburg
// Residenz, Residenzplatz 2" was pinned on Munich's "Residenz", 140 miles away): the plans the AI Assistant
// pinned that way are looked up again. (A place picked from a list has that place's own name as its address.)
if (!(state.settings.geoRetry >= 5)) {
  state.settings.geoRetry = 5;
  const known = new Map(Object.values(savedGuides).flatMap(g => g.places || []).map(p => [p.id, p]));
  for (const t of state.trips) t.items.forEach((i) => {
    const p = i.guideId && known.get(i.guideId);
    if (p && i.place && norm(i.place) !== norm(p.place || p.name)) { delete i.lat; delete i.lng; delete i.guideId; delete i.geoMiss; }
  });
}
// (geoRetry 6 is repinNumbered in maps.js: it needs the internet, and runs once the app has started.)
saveLocal();

/* ---------- Finding a trip or a plan ---------- */

// An archived trip is off the top bar (archive.js). The mark is the account's, not the trip's: on a trip
// planned with other people, archiving it tidies only your own top bar.
const isArchived = t => !!(t && state.archived && state.archived[t.id]);
const tripsShown = () => state.trips.filter(t => !isArchived(t));
const firstTripId = () => (tripsShown()[0] || {}).id || null;

// The trip on screen (an archived one too, while it's looked at), else the first on the top bar, else null.
function activeTrip() {
  return state.trips.find(t => t.id === state.activeTripId) || tripsShown()[0] || null;
}
// An archived trip is only looked at for a while (archive.js): the app starts on the trips of the top bar.
if (isArchived(activeTrip())) state.activeTripId = firstTripId();
function findItem(id) {
  for (const t of state.trips) {
    const it = t.items.find(i => i.id === id);
    if (it) return { trip: t, item: it };
  }
  return null;
}
