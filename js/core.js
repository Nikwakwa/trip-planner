'use strict';

/* core.js — what every other file uses: constants, small helpers, dates and times, distances, links,
   the errors of this visit, and the table of what a tap does (onAction). Loaded right after the languages,
   before every feature file, so its names can be used anywhere (also at load time). */

/* ---------- Constants ---------- */

const SPRITE = 'icons/sprite.svg';

const COLORS = ['#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f', '#455a64'];

// Each type of plan gets its own icon and color hue.
const CATEGORIES = {
  sight:     { label: T('Sightseeing'),  icon: 'museum',         hue: 255 },
  food:      { label: T('Food & drink'), icon: 'restaurant',     hue: 45 },
  event:     { label: T('Show / event'), icon: 'local_activity', hue: 345 },
  shopping:  { label: T('Shopping'),     icon: 'shopping_bag',   hue: 300 },
  transport: { label: T('Transport'),    icon: 'train',          hue: 205 },
  stay:      { label: T('Stay'),         icon: 'hotel',          hue: 150 },
  other:     { label: T('Other'),        icon: 'push_pin',       hue: 85 },
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
// A real calendar day ("2026-02-31" isn't one) and a real clock time.
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && toISO(parseDate(v)) === v;
const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
// Ids end up in the page and in the names of synced documents: only letters, digits, "-", "_" and ".".
const isId = v => typeof v === 'string' && /^[\w.-]{1,100}$/.test(v);
// Dates and times are written in the app's language (i18n.js), whatever the device's own. In English the
// day/month order and the clock are a choice (Settings → Appearance), and start from the device's own habits.
function deviceFormats() {
  const loc = /^en\b/i.test(navigator.language || '') ? navigator.language : 'en-GB';
  try {
    const parts = new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric' }).formatToParts(new Date()).map(p => p.type);
    const cycle = new Intl.DateTimeFormat(loc, { hour: 'numeric' }).resolvedOptions().hourCycle || '';
    return { dateOrder: parts.indexOf('month') < parts.indexOf('day') ? 'mdy' : 'dmy', clock: /^h1/.test(cycle) ? '12' : '24' };
  } catch { return { dateOrder: 'dmy', clock: '24' }; }
}
const dateLocale = () => LOCALES[LANG] || (state.settings.dateOrder === 'mdy' ? 'en-US' : 'en-GB');   // "Oct 31", "31 Oct" or "31 oct."
function fmtDay(s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  // Without a month, the American style gives "3 Sat": "Sat 3" is used for both.
  const locale = opts.weekday && opts.day && !opts.month ? LOCALES[LANG] || 'en-GB' : dateLocale();
  return parseDate(s).toLocaleDateString(locale, opts);
}
// A clock time, "14:30" or "2:30 PM". `tz` shows it in another time zone.
function fmtClock(date, tz) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: state.settings.clock === '12' ? 'h12' : 'h23', ...(tz && { timeZone: tz }) });
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  return fmtClock(new Date(2000, 0, 1, h, m));
}
// English only: for what stays in English (the details of "Report a problem", the self-check). Texts on screen use Tn().
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ---------- Text and links ---------- */

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

const norm = s => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ---------- Distances, getting around, units ---------- */

// Straight-line distance in miles.
function miles(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

/* How the trip gets around: "transit" (public transit + walk) or "drive" (drive + walk).
   Each trip has its own, and a day can use the other one. */
const TRAVEL_MODES = {
  transit: { label: T('Public transit + walk'), short: T('Transit'), icon: 'directions_subway' },
  drive: { label: T('Drive + walk'), short: T('Driving'), icon: 'directions_car' },
};
const modeFor = (trip, day) => (day && trip.dayTravel && trip.dayTravel[day]) || trip.travel || 'transit';

// Rough estimate from the straight-line distance d (miles). Short hops are walked.
// dist: the way by road, ~30% longer than the straight line in town, ~20% on a long journey.
// The speed grows with the distance, with no jump: across town is slow (lights, parking, waiting for
// a tram), and the further it is, the more of the way is open road or a fast train.
function travel(d, mode = 'transit') {
  const dist = d * (1.2 + 0.1 / (1 + d / 20));
  if (d <= (mode === 'drive' ? 0.8 : 1.2)) {
    const mins = Math.max(1, Math.round(dist / 3 * 60));
    return { icon: 'directions_walk', mode: 'walking', mins, dist, text: T('{mins} min walk', { mins }) };
  }
  if (mode === 'drive') {
    const mph = Math.min(65, 12 + 11 * Math.log(1 + d));
    const mins = Math.round((4 + dist / mph * 60) / 5) * 5;
    return { icon: 'directions_car', mode: 'driving', mins, dist, text: T('{time} drive', { time: fmtDuration(mins) }) };
  }
  // Door to door: 20 to 30 minutes of walking to the stop, waiting and changing (more changes on a longer
  // way), then a slow ride in town (13 mph over 2 miles) that gets faster with the distance. Logan Airport
  // to Cambridge, 4 miles, was "25 min" and takes close to an hour; the subway across New York was 10 to
  // 30 minutes short as well.
  const mph = Math.min(55, 11 + 1.3 * d);
  const mins = Math.round((Math.min(30, 18 + 2.5 * d) + dist / mph * 60) / 5) * 5;
  return { icon: 'directions_subway', mode: 'transit', mins, dist, text: T('{time} by transit', { time: (mins < 60 ? '~' : '') + fmtDuration(mins) }) };
}

// Metric or imperial (Settings → Appearance → Units). Distances are worked out in miles.
const usesImperial = () => /-(US|LR|MM)$/i.test(navigator.language || '');
const imperial = () => (state.settings.units || (usesImperial() ? 'imperial' : 'metric')) === 'imperial';
function fmtDist(d) {
  const n = (v, dec) => (v < 9.95 ? fmtNum(v, dec) : Math.round(v).toLocaleString(LOCALES[LANG] || 'en-US'));
  if (imperial()) return d < 0.1 ? '<0.1 mi' : `${n(d, 1)} mi`;
  const km = d * 1.609;
  // Under 975 m: from there it would round to "1000 m".
  if (km < 0.975) return `${Math.max(50, Math.round(km * 20) * 50)} m`;
  return `${n(km, 1)} km`;
}
const fmtDuration = m => (m < 60 ? `${m} min` : `~${fmtNum(String(Math.round(m / 30) / 2))} h`);
const avg = list => list.reduce((s, v) => s + v, 0) / list.length;

/* ---------- Links to Google Maps ---------- */

function directionsUrl(a, b, mode) {
  return `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=${mode}`;
}

// A plan's address in Google Maps. at: where the plan is on the map, when known. title: the plan's name.
function mapsUrl(place, trip, at, title = '') {
  const where = trip.place ? trip.place.label : trip.name;
  const city = trip.place ? trip.place.name : trip.name;
  const search = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  // Only the town as address ("Daun"): the plan's name says which place in it.
  if (title && norm(place).trim() === norm(city).trim()) return search(norm(title).includes(norm(city)) ? title : `${title}, ${where}`);
  if (norm(place).includes(norm(city))) return search(place);
  if (trip.place && trip.place.kind === 'city') {
    // A day trip out of town: adding the trip's town would send "Am Bahnhof" (in Moselkern) to the station
    // of Daun. The address's own town counts, else the town of the guide nearest the plan, else the spot itself.
    const box = trip.place.bbox;
    const away = at && miles(trip.place, at) > (box ? NEAR_REACH : 15)
      && !(box && at.lng >= box[0] && at.lng <= box[2] && at.lat >= box[1] && at.lat <= box[3]);
    if (!away) return search(`${place}, ${where}`);
    const country = where.split(', ').slice(1).join(', ');
    if (place.includes(',')) return search(country && !norm(place).includes(norm(country)) ? `${place}, ${country}` : place);
    const town = townNear(at);
    return search(town ? [place, town, country].filter(Boolean).join(', ') : `${at.lat},${at.lng}`);
  }
  // A country or a region doesn't say which "Museum of Fine Arts": the town of the guide nearest the plan does.
  const town = at && trip.place && !place.includes(',') ? townNear(at) : '';
  return search(town && !norm(place).includes(norm(town)) ? `${place}, ${town}, ${where}` : `${place}, ${where}`);
}

/* ---------- Errors ----------
   The last few errors of this visit, to go with "Report a problem" (about.js). Kept in memory only.
   Listening starts here, before the feature files load, so an error while the app starts is kept too. */

const recentErrors = [];
function noteError(text) {
  recentErrors.push(`${new Date().toTimeString().slice(0, 8)} ${String(text).slice(0, 300)}`);
  if (recentErrors.length > 5) recentErrors.shift();
}
window.addEventListener('error', (e) => {
  if (e.message) noteError(`${e.message} (${String(e.filename || '').split('/').pop()}:${e.lineno || 0})`);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  noteError('Promise: ' + ((r && (r.message || r.code)) || r));
});
// Something the page's security policy stopped: most likely a service missing from its list (index.html).
// Only the site is noted: a search address carries what was typed.
document.addEventListener('securitypolicyviolation', (e) => {
  let where = String(e.blockedURI || '');
  try { where = new URL(where).origin; } catch { /* 'inline', 'eval'… */ }
  if (where === 'https://apis.google.com') return;      // Firebase Auth's pop-up helper, blocked on purpose
  noteError(`Blocked by the security policy (${e.effectiveDirective}): ${where}`);
});

/* ---------- What a tap does ----------
   A button or link with data-action="…" runs the action of that name. Each part of the app adds its own
   actions with onAction(name, run), next to the code that draws the buttons; run gets the element tapped and
   the click. One listener for the whole page, so a section drawn again keeps working. The self-check fails on
   a data-action that has no action. */

const ACTIONS = new Map();
function onAction(name, run) {
  if (ACTIONS.has(name)) throw new Error(`Two actions are named "${name}"`);
  ACTIONS.set(name, run);
}
// The id of the plan a tapped button belongs to (its card, or the button itself, has data-id).
const idOf = el => el.closest('[data-id]').dataset.id;

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  const run = el && ACTIONS.get(el.dataset.action);
  if (run) run(el, e);
});
