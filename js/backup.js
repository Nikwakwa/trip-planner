'use strict';

/* backup.js — saving a backup file, restoring one, and erasing everything. */

// "Erase everything" also clears what is kept on this device only: tickets, assistant chats,
// hidden packing suggestions, and the saved guides, forecasts, opening hours and essentials.
function eraseDeviceData() {
  for (const key of [AI_KEY, PACKING_KEY, GUIDES_KEY, WEATHER_KEY, HOURS_KEY, ESSENTIALS_KEY, INFO_KEY, ROUTES_KEY]) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  }
  ai.saved = { chats: {}, booking: {} };
  for (const kept of [packingHidden, savedGuides]) for (const k of Object.keys(kept)) delete kept[k];
  readyGuides.clear();
  guideStatus.clear();
  weather.saved = {};
  weather.asked.clear();
  hours.saved = {};
  roadRoutes.saved = {};
  essentials.saved = {};
  planInfo.saved = {};
  joinedGuides.clear();
  eraseFiles();     // files.js
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dotted-line-backup-${todayISO()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  snackbar(T('Backup saved to Downloads'));
}

// Checks a backup file and keeps only the fields the app understands.
function cleanBackup(data) {
  const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
  const date = v => (isDate(v) ? v : '');
  const time = v => (isTime(v) ? v : '');
  const coord = (v, max) => (typeof v === 'number' && Math.abs(v) <= max ? v : undefined);
  // Each id is used once, and can't carry anything but an id (it goes into the page as is).
  const seen = new Set();
  const id = (v) => {
    const ok = isId(v) && !seen.has(v) ? v : uid();
    seen.add(ok);
    return ok;
  };
  const cleanPlace = (p) => {
    if (!p || typeof p !== 'object' || coord(p.lat, 90) === undefined || coord(p.lng, 180) === undefined || !str(p.name)) return undefined;
    const bbox = Array.isArray(p.bbox) && p.bbox.length === 4 && p.bbox.every(v => typeof v === 'number') ? p.bbox : null;
    return {
      name: str(p.name, 100), label: str(p.label, 200) || str(p.name, 100),
      kind: KIND_LABEL[p.kind] ? p.kind : 'city',
      lat: p.lat, lng: p.lng, bbox, osm: /^[NWR]\d+$/.test(p.osm) ? p.osm : '',
    };
  };
  if (!data || !Array.isArray(data.trips)) throw new Error('not a backup');
  // The lines of a checklist, or of a trip's own list.
  const checks = list => (Array.isArray(list) ? list : [])
    .filter(c => c && typeof c === 'object' && str(c.text, 200))
    .map(c => ({ id: id(c.id), text: str(c.text, 200), done: c.done === true }));
  const tripIds = new Map();      // the file's trip id → the id it has here
  // A trip's days: both or none, the first one first.
  const span = (t) => {
    const a = date(t.start) || date(t.end), b = date(t.end) || date(t.start);
    return a <= b ? [a, b] : [b, a];
  };
  const trips = data.trips.filter(t => t && typeof t === 'object').map(t => ({
    id: tripIds.set(t.id, id(t.id)).get(t.id),
    name: str(t.name, 40) || T('Trip'),
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : COLORS[0],
    start: span(t)[0],
    end: span(t)[1],
    place: cleanPlace(t.place),
    travel: TRAVEL_MODES[t.travel] ? t.travel : 'transit',
    ...(t.dayTravel && typeof t.dayTravel === 'object' ? { dayTravel: Object.fromEntries(Object.entries(t.dayTravel).filter(([d, m]) => date(d) && TRAVEL_MODES[m])) } : {}),
    items: (Array.isArray(t.items) ? t.items : []).filter(i => i && typeof i === 'object').map(i => ({
      id: id(i.id),
      title: str(i.title, 120) || T('Untitled'),
      category: CATEGORIES[i.category] ? i.category : 'other',
      date: date(i.date),
      time: time(i.time),
      place: str(i.place, 200),
      link: str(i.link, 500),
      notes: str(i.notes),
      done: i.done === true,
      lat: coord(i.lat, 90),
      lng: coord(i.lng, 180),
      guideId: isId(i.guideId) ? i.guideId : undefined,
      slot: /^\d{2}:\d{2}~\d{2}$/.test(i.slot) ? i.slot : undefined,
      geoMiss: i.geoMiss === true || undefined,
      booked: i.booked === true || undefined,
      until: date(i.until) || undefined,
    })),
    // The list a trip planned with other people had: kept, as this trip's own list.
    todos: Array.isArray(t.todos) && t.todos.length ? checks(t.todos) : undefined,
  }));
  const checklist = checks(data.checklist);
  // The archived trips, under the ids their trips have here.
  const archived = Object.fromEntries(Object.entries(tidyArchived(data.archived))
    .filter(([was]) => tripIds.has(was)).map(([was, day]) => [tripIds.get(was), day]));
  const activeTripId = tripIds.get(data.activeTripId) || (trips.find(t => !archived[t.id]) || {}).id || null;
  const s = data.settings || {};
  const settings = {
    theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto',
    suggestions: s.suggestions !== false,
    lookup: s.lookup !== false,
    booking: s.booking !== false,
    units: ['metric', 'imperial'].includes(s.units) ? s.units : defaultSettings().units,
    dateOrder: ['dmy', 'mdy'].includes(s.dateOrder) ? s.dateOrder : defaultSettings().dateOrder,
    clock: ['24', '12'].includes(s.clock) ? s.clock : defaultSettings().clock,
    ...(LANGS[s.lang] ? { lang: s.lang } : {}),
  };
  return { version: 1, activeTripId, trips, ...(Object.keys(archived).length ? { archived } : {}), checklist, settings };
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
    snackbar(T('That file isn’t a Dotted Line backup'));
    return;
  }
  const n = restored.trips.reduce((sum, t) => sum + t.items.length, 0);
  const sharedNow = () => (sync.saved ? state.trips.filter(t => t.shared) : []);
  const ok = await askConfirm({
    icon: 'upload',
    title: T('Restore this backup?'),
    text: T('It has {trips} and {plans}.', { trips: Tn(restored.trips.length, '{n} trip', '{n} trips'), plans: Tn(n, '{n} plan', '{n} plans') }) + ' ' +
      (sync.saved ? T('It will replace everything currently in the app — also on the other devices signed in to your account.') : T('It will replace everything currently in the app.')) +
      (sharedNow().length ? ' ' + T('The trips you plan with other people stay as they are.') : ''),
    ok: T('Restore'),
  });
  if (!ok) return;
  Object.assign(restored.settings, deviceMarks());
  // A backup never replaces a trip planned with other people (share.js): those stay, and the file's own
  // copy of one is left out.
  const kept = sharedNow();
  restored.trips = restored.trips.filter(t => !kept.some(k => k.id === t.id)).concat(kept);
  // They stay archived, or not, as they are now.
  restored.archived = { ...restored.archived };
  for (const t of kept) {
    if (isArchived(t)) restored.archived[t.id] = state.archived[t.id];
    else delete restored.archived[t.id];
  }
  // The name shown on shared trips is the account's, not part of the plans.
  if (state.profile) restored.profile = state.profile;
  state = restored;
  save();
  scrollAt = {};
  showView('plan', { top: true });
  snackbar(T('Backup restored'));
});

/* ---------- Taps in Settings → Backup ---------- */

onAction('export', () => exportBackup());
onAction('import', () => $('#import-file').click());
onAction('reset', async () => {
  // Trips planned with other people (share.js): erasing leaves them, or deletes them for everyone.
  const shared = !!sync.saved && (state.trips.some(t => t.shared) || Object.keys(sharing.roots).length > 0);
  const ok = await askConfirm({
    icon: 'restart_alt',
    title: T('Erase everything?'),
    text: (sync.saved
      ? T('All trips, plans and checklist items will be deleted — on this device and on every device signed in to your account.')
      : T('All trips, plans and checklist items on this device will be deleted.'))
      + (shared ? ' ' + T('Trips you invited people to are deleted for them too, and you leave the trips you were invited to.') : '')
      + ' ' + T('Save a backup first if you might want them back.'),
    ok: T('Erase'),
  });
  if (!ok) return;
  if (shared) {
    try {
      if (!navigator.onLine) throw { code: 'auth/network-request-failed' };
      await quitSharing(sync.saved.uid);
    } catch (err) {
      console.warn('Erase', err);
      snackbar(`${T('Nothing was erased.')} ${syncErrorText(err)}`);
      return;
    }
  }
  const marks = deviceMarks();
  const profile = state.profile;      // the account's name (share.js) is not one of the plans
  state = defaultState();
  Object.assign(state.settings, marks);
  if (profile) state.profile = profile;
  eraseDeviceData();
  save();
  scrollAt = {};
  showView('plan', { top: true });
  snackbar(T('Started fresh'));
});
