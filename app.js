'use strict';

/* =========================================================
   Dotted Line — all app behavior lives in this file.
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
// A real calendar day ("2026-02-31" isn't one) and a real clock time.
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && toISO(parseDate(v)) === v;
const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
// Ids end up in the page and in the names of synced documents: only letters, digits, "-", "_" and ".".
const isId = v => typeof v === 'string' && /^[\w.-]{1,100}$/.test(v);
// The app is in English only for now, so dates and times are always written in English, whatever the
// device's language. The day/month order and the clock are a choice (Settings → Appearance), and start
// from the device's own habits.
function deviceFormats() {
  const loc = /^en\b/i.test(navigator.language || '') ? navigator.language : 'en-GB';
  try {
    const parts = new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric' }).formatToParts(new Date()).map(p => p.type);
    const cycle = new Intl.DateTimeFormat(loc, { hour: 'numeric' }).resolvedOptions().hourCycle || '';
    return { dateOrder: parts.indexOf('month') < parts.indexOf('day') ? 'mdy' : 'dmy', clock: /^h1/.test(cycle) ? '12' : '24' };
  } catch { return { dateOrder: 'dmy', clock: '24' }; }
}
const dateLocale = () => (state.settings.dateOrder === 'mdy' ? 'en-US' : 'en-GB');   // "Oct 31" or "31 Oct"
function fmtDay(s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  // Without a month, the American style gives "3 Sat": "Sat 3" is used for both.
  const locale = opts.weekday && opts.day && !opts.month ? 'en-GB' : dateLocale();
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

// The guide for the trip's place: sights, food and more from the travel guide (see places.js).
function guideFor(trip) {
  return withNearby(trip, placeGuide(trip));
}

const placeLabel = trip => (trip.place ? trip.place.label : trip.name);

// Which guide places does a plan refer to? (a plan named after a sight → that sight's entry)
const matchMemo = new WeakMap();     // plan → its last answer (this is asked many times per redraw)
function matchPlaces(item, guide) {
  if (!guide) return [];
  if (item.guideId) {
    const byId = guide.places.filter(p => p.id === item.guideId);
    if (byId.length) return byId;
  }
  // Of an address, only what comes before the first comma counts: "117 MacDougal St, New York, NY"
  // is not the city of New York. The longest name wins ("Boston Common" before "Boston").
  const where = String(item.place || '').split(',')[0];
  const text = norm(`${where} | ${item.title}`);
  const key = `${guide.id}|${guide.places.length}|${text}`;
  const had = matchMemo.get(item);
  if (had && had.key === key) return had.found;
  const found = guide.places.filter(p => p.re.test(text)).sort((a, b) => b.name.length - a.name.length);
  matchMemo.set(item, { key, found });
  return found;
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

/* How the trip gets around: "transit" (public transit + walk) or "drive" (drive + walk).
   Each trip has its own, and a day can use the other one. */
const TRAVEL_MODES = {
  transit: { label: 'Public transit + walk', short: 'Transit', icon: 'directions_subway' },
  drive: { label: 'Drive + walk', short: 'Driving', icon: 'directions_car' },
};
const modeFor = (trip, day) => (day && trip.dayTravel && trip.dayTravel[day]) || trip.travel || 'transit';

// Rough estimate: real streets are ~30% longer than a straight line. Short hops are walked.
function travel(d, mode = 'transit') {
  const street = d * 1.3;
  if (d <= (mode === 'drive' ? 0.8 : 1.2)) {
    const mins = Math.max(1, Math.round(street / 3 * 60));
    return { icon: 'directions_walk', mode: 'walking', mins, text: `${mins} min walk` };
  }
  if (mode === 'drive') {
    // City streets are slow (plus parking); open roads are quicker.
    const mins = Math.round((5 + street / (d > 25 ? 50 : 18) * 60) / 5) * 5;
    return { icon: 'directions_car', mode: 'driving', mins, text: `${fmtDuration(mins)} drive` };
  }
  const mins = Math.round((10 + street / (d > 25 ? 35 : 12) * 60) / 5) * 5;
  return { icon: 'directions_subway', mode: 'transit', mins, text: `${mins < 60 ? '~' : ''}${fmtDuration(mins)} by transit` };
}

// Metric or imperial (Settings → Appearance → Units). Distances are worked out in miles.
const usesImperial = () => /-(US|LR|MM)$/i.test(navigator.language || '');
const imperial = () => (state.settings.units || (usesImperial() ? 'imperial' : 'metric')) === 'imperial';
function fmtDist(d) {
  const n = (v, dec) => (v < 10 ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US'));
  if (imperial()) return d < 0.1 ? '<0.1 mi' : `${n(d, 1)} mi`;
  const km = d * 1.609;
  if (km < 1) return `${Math.max(50, Math.round(km * 20) * 50)} m`;
  return `${n(km, 1)} km`;
}
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
  // With a hotel (today.js), neighborhoods close to it come first.
  const base = baseFor(trip, days[0], guide);
  const areaCenter = (a) => {
    const inArea = guide.places.filter(p => p.area === a);
    return inArea.length ? { lat: avg(inArea.map(p => p.lat)), lng: avg(inArea.map(p => p.lng)) } : null;
  };
  const byBase = list => (base ? list.map(a => [a, areaCenter(a)]).sort((x, y) => (x[1] && y[1] ? miles(base.c, x[1]) - miles(base.c, y[1]) : 0)).map(x => x[0]) : list);
  const freeAreas = byBase(guide.dayAreas.filter(a => !usedAreas.has(a)));
  const areaList = freeAreas.length ? freeAreas : guide.dayAreas;
  let areaIndex = 0;

  for (const day of days) {
    if (day < today) continue;
    const anchors = anchorsByDay.get(day);
    const pool = guide.places.filter(p => !taken.has(p.id) && !shown.has(p.id));
    let ranked, title;
    // A free day on a trip with guides near its plans (places.js): ideas around that day's stay.
    const stay = !anchors.length && guide.joined ? baseFor(trip, day, guide) : null;
    const from = anchors.length ? anchors : stay ? [stay] : [];
    if (from.length) {
      title = anchors.length ? 'Nearby ideas' : 'Ideas near your stay';
      // With guides near the plans, only their places count: not the city itself as a "destination".
      ranked = pool.filter(p => !guide.joined || p.local).map(p => {
        let best = null;
        for (const a of from) {
          const d = miles(a.c, p);
          if (!best || d < best.d) best = { d, from: a.item };
        }
        return { p, ...best };
      }).sort((x, y) => x.d - y.d);
      // "Nearby" has to be near: a country's destinations can be a flight away.
      if (guide.kind === 'destinations' || guide.joined) ranked = ranked.filter(r => r.d < 25);
    } else if (areaList.length) {
      const area = areaList[areaIndex++ % areaList.length];
      const inArea = guide.places.filter(p => p.area === area);
      const center = { lat: avg(inArea.map(p => p.lat)), lng: avg(inArea.map(p => p.lng)) };
      title = (guide.dayTitles && guide.dayTitles[area]) || `Ideas for a day in ${area}`;
      ranked = pool.map(p => ({ p, d: miles(center, p) })).sort((x, y) => x.d - y.d);
    } else {
      // A small town, or a country / region's destinations: best known first.
      title = guide.kind === 'destinations' ? `Places to go in ${guide.city}` : `Ideas for a day in ${guide.city}`;
      ranked = pool.filter(p => !p.local).map(p => ({ p }));
    }

    // Rain likely (weather.js): indoor places nearby come first.
    if (isWetDay(trip, day)) {
      const indoor = ranked.slice(0, 30).filter(r => r.p.tags.includes('rainy'));
      if (indoor.length) {
        ranked = [...indoor, ...ranked.filter(r => !indoor.includes(r))];
        title = 'Rain likely — indoor ideas';
      }
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

/* ---------- Auto-fill day ---------- */

const DAY_MINUTES = 8 * 60;      // a full day: the visits and the travel between them
const HOP_MINUTES = 20;          // getting from one stop to the next
const FILL_MAX = { sight: 9, shopping: 1, other: 1 };   // per day, counting the plans already there (meals are left to you)

// How interesting a guide place is, from 0 (a minor sight) to about 8 (world famous): mostly how well
// known it is ("fame", places.js), with a little for a photo and a long description.
function placeInterest(p) {
  return Math.log2(1 + (p.fame || 0)) + (p.photo ? 0.5 : 0) + ((p.about || '').length > 250 ? 0.5 : 0);
}

// Not with a guide made from Wikipedia articles near the center (places.js): too many of them aren't places to visit.
const canAutoFill = (day, guide) => !!guide && day >= todayISO() && guide.source !== 'Wikipedia' && (guide.joined || guide.kind !== 'destinations');

// Fills a day's free time with guide places around its plans (or, for an empty day, around the
// neighborhood suggested for it), then puts the day in the shortest order. Nothing gets a time.
function autoFillDay(trip, day) {
  const guide = guideFor(trip);
  if (!canAutoFill(day, guide)) return { error: 'There’s no guide for this day yet.' };
  const items = dayItems(trip, day);
  const visits = items.filter(i => i.category !== 'stay');
  const count = {};
  let minutes = 0;
  for (const i of visits) {
    count[i.category] = (count[i.category] || 0) + 1;
    minutes += planLength(i, guide) + HOP_MINUTES;
  }
  if (!count.food) minutes += 60;      // room for lunch
  const taken = new Set(trip.items.flatMap(i => matchPlaces(i, guide).map(p => p.id)));
  const openThatDay = (p) => {
    const rules = p.hours && guideHours(p.hours);
    return !rules || hoursOn(rules, day).length > 0;
  };
  // Only the most interesting quarter of the guide is worth a stop: better a shorter day than one padded
  // with minor sights. Evening places are left out: the app can't tell where the day ends.
  const fits = p => FILL_MAX[p.cat] && p.when !== 'evening' && (!guide.joined || p.local);
  const scores = guide.places.filter(fits).map(placeInterest).sort((a, b) => a - b);
  const floor = scores.length ? Math.min(scores[Math.floor(scores.length * 3 / 4)], 4.5) : 0;
  const pool = guide.places
    .filter(p => fits(p) && !taken.has(p.id) && placeInterest(p) >= floor && openThatDay(p))
    .map(p => ({ p, interest: placeInterest(p) }));

  // Where the day happens: around its plans on the map. An empty day goes to the most interesting
  // place not in the trip yet, and what's around it.
  let points = visits.map(i => coordsOf(i, guide)).filter(Boolean);
  if (!points.length) {
    const top = pool.slice().sort((a, b) => b.interest - a.interest)[0];
    const base = baseFor(trip, day, guide);
    points = top ? [top.p] : base ? [base.c] : [];
  }
  const driving = modeFor(trip, day) === 'drive';
  const reach = driving ? 12 : 2.5;           // miles from the day's plans
  const perMile = driving ? 0.3 : 1.2;        // what a mile further costs, in points of interest
  const wet = isWetDay(trip, day);
  const length = p => (p.mins < 360 ? p.mins : 90);
  const around = points.slice();      // the day stays around these: it doesn't wander off stop by stop
  const picked = [];
  while (picked.length < 6) {
    let best = null;
    for (const c of pool) {
      if (picked.includes(c) || (count[c.p.cat] || 0) >= FILL_MAX[c.p.cat]) continue;
      if (minutes + length(c.p) + HOP_MINUTES > DAY_MINUTES + 30) continue;
      if (Math.min(...around.map(pt => miles(pt, c.p))) > reach) continue;
      const d = Math.min(...points.map(pt => miles(pt, c.p)));
      // The most interesting place that isn't far: a famous sight a mile away beats a minor one next door.
      // Indoors counts for more when rain is likely.
      const score = c.interest - d * perMile + (wet && c.p.tags.includes('rainy') ? 1.5 : 0);
      if (!best || score > best.score) best = { c, score };
    }
    if (!best) break;
    picked.push(best.c);
    points.push(best.c.p);
    count[best.c.p.cat] = (count[best.c.p.cat] || 0) + 1;
    minutes += length(best.c.p) + HOP_MINUTES;
  }
  if (!picked.length) {
    return { error: minutes > DAY_MINUTES - 60 ?'This day already looks full.' : 'No more ideas from the guide near this day’s plans.' };
  }
  const added = picked.map(({ p }) => ({
    id: uid(), title: p.name, category: p.cat, date: day, time: '',
    place: p.place || p.name, link: '', notes: '', done: false,
    lat: p.lat, lng: p.lng, guideId: p.id,
  }));
  trip.items.push(...added);
  const route = optimizeDay(trip, day);
  return {
    added,
    undo: () => {
      if (route.undo) route.undo();
      trip.items = trip.items.filter(i => !added.includes(i));
    },
  };
}

function runAutoFill(day) {
  const trip = activeTrip();
  const result = autoFillDay(trip, day);
  if (result.error) { snackbar(result.error); return; }
  const redraw = () => { save(); render(); if (mapShown()) refreshMap(); };
  redraw();
  snackbar(`Added ${plural(result.added.length, 'plan')} to ${fmtDay(day, { weekday: 'long' })}`, 'Undo', () => { result.undo(); redraw(); }, 8000);
}

/* ---------- Consider booking ahead ---------- */

// What a guide says about places that sell out ("sold out weeks in advance", "by reservation only"…).
const BOOK_TEXT = new RegExp([
  'sells? out', 'sold out', 'booked (?:up|out|solid)', '(?:days|weeks|months) (?:in advance|ahead)',
  'book(?:ed|ing|ings)? (?:well|far|long) (?:in advance|ahead)',
  'reserv(?:e|ation|ations) (?:\w+ ){0,2}(?:required|essential|a must)',
  'by (?:reservation|appointment|prior arrangement) only', 'waiting list',
].join('|'), 'i');

// A line for a plan's card, "Book ahead", only for what is known to sell out: the answer kept from
// Gemini (assistant.js) or, until there is one, the guide saying so. A fee or timed entry isn't enough.
function bookingNote(item, trip, guide) {
  if (item.booked || item.done || (item.date && item.date < todayISO())) return null;
  // A ticket is attached, or it's the hotel or the flight itself (there because it was booked).
  if (filesOf(item.id).length || ['stay', 'transport'].includes(item.category)) return null;
  const known = sellsOut(item, trip);
  if (known) return known.ahead ? { text: known.why ? `Book ahead: ${known.why}` : 'Sells out: book ahead' } : null;
  const p = matchPlaces(item, guide)[0];
  return p && BOOK_TEXT.test([p.about, p.blurb, p.price, p.tip, p.hours].filter(Boolean).join(' ')) ? { text: 'Sells out: book ahead' } : null;
}

/* ---------- Photos of guide places (from Wikimedia, when the guide has one) ---------- */

const photoImg = (p, cls) => (p.photo
  ? `<img class="${cls}" data-photo src="${esc(p.photo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '');
// A photo that can't load (offline, or the file is gone) is taken out, with its caption.
document.addEventListener('error', (e) => {
  if (e.target.matches && e.target.matches('img[data-photo]')) (e.target.closest('figure') || e.target).remove();
}, true);

// A small square photo in lists, with the category icon underneath in case it doesn't load.
function placeThumb(p, cat) {
  return `<span class="avatar thumb" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}${photoImg(p, '')}</span>`;
}

/* ---------- Details sheet for a guide place (full description, add or save) ---------- */

function openPlaceInfo(id, day) {
  const trip = activeTrip();
  const guide = trip && guideFor(trip);
  const p = guide && guide.places.find(x => x.id === id);
  if (!p) return;
  const cat = CATEGORIES[p.cat] || CATEGORIES.other;
  const added = trip.items.some(i => matchPlaces(i, guide).some(m => m.id === p.id));
  const over = [cat.label, p.area, p.mins < 360 && fmtDuration(p.mins), p.tags.includes('free') && 'Free'].filter(Boolean).join(' · ');
  const tags = [whenTag(p), p.tags.includes('rainy') && (p.when === 'morning' || p.when === 'evening') ? `<span class="tag">${icon('umbrella')}Indoors</span>` : ''].join('');
  const dayName = day && fmtDay(day, { weekday: 'long' });
  $('#place-body').innerHTML = `
    ${p.photo ? `<figure class="pi-figure">${photoImg(p, 'pi-photo')}<figcaption>Photo: Wikimedia Commons</figcaption></figure>` : ''}
    <div class="pi-head">
      <span class="avatar" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}</span>
      <div class="pi-heading">
        <p class="overline">${esc(over)}</p>
        <h2 tabindex="-1" autofocus>${esc(p.name)}</h2>
      </div>
      <button type="button" class="icon-btn ripple" data-close aria-label="Close">${icon('close')}</button>
    </div>
    ${tags.trim() ? `<div class="pi-tags">${tags}</div>` : ''}
    <p class="pi-text">${esc(p.about || p.blurb)}</p>
    ${p.hours ? `<p class="pi-hours">${icon('schedule')}<span>${esc(p.hours)}</span></p>` : ''}
    ${factsHTML([['Price', p.price], ['Getting there', p.tip]])}
    <div class="pi-links">
      <a class="assist-chip ripple" href="${esc(mapsUrl(p.place || p.name, trip))}" target="_blank" rel="noopener">${icon('map')}Map</a>
      ${safeUrl(p.url) ? `<a class="assist-chip ripple" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${icon('link')}${esc(hostLabel(safeUrl(p.url)))}</a>` : ''}
      ${guide.sourceUrl && !p.local ? `<a class="assist-chip ripple" href="${esc(guide.sourceUrl)}" target="_blank" rel="noopener">${icon('open_in_new')}${esc(guide.source)}</a>` : ''}
    </div>
    <div class="sheet-actions">
      ${added
        ? `<span class="pi-added">${icon('check')}Already in your trip</span>`
        : `${day ? `<button type="button" class="btn text ripple" data-action="add-suggestion" data-place="${esc(p.id)}" data-date="">Save to ideas</button>` : ''}
           <span class="spacer"></span>
           <button type="button" class="btn filled lg ripple" data-action="add-suggestion" data-place="${esc(p.id)}" data-date="${day || ''}">
             ${icon('add')}${day ? `Add to ${esc(dayName)}` : 'Save to ideas'}</button>`}
    </div>`;
  $('#place-dialog').showModal();
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
    ? `${icon('near_me')}<span>${esc(travel(r.d, modeFor(activeTrip(), day)).text)} from ${esc(r.from.title)}</span>`
    : p.area ? `${icon('location_on')}<span>${esc(p.area)}</span>` : '';
  return `
    <article class="s-card" aria-label="${esc(p.name)}">
      <button type="button" class="s-body ripple" data-action="place-info" data-place="${esc(p.id)}" data-date="${day}" aria-label="More about ${esc(p.name)}">
        ${photoImg(p, 's-photo')}
        <span class="s-top"><span class="avatar" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}</span>${whenTag(p)}</span>
        <span class="s-name">${esc(p.name)}</span>
        ${why ? `<span class="s-why">${why}</span>` : ''}
        <span class="s-blurb">${esc(p.blurb)}</span>
        <span class="more-link">More${icon('arrow_forward')}</span>
      </button>
      <div class="s-foot">
        ${p.mins < 360 ? `<span class="tag">${icon('schedule')}${fmtDuration(p.mins)}</span>` : ''}
        ${p.tags.includes('free') ? '<span class="tag">Free</span>' : ''}
        <button type="button" class="btn tonal sm ripple" data-action="add-suggestion" data-place="${esc(p.id)}" data-date="${day}"
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

// No trips at first: the app asks where the user wants to go.
function defaultState() {
  const check = (text) => ({ id: uid(), text, done: false });
  return {
    version: 1,
    activeTripId: null,
    trips: [],
    checklist: [
      check('Phone charger + power bank'),
      check('Comfortable walking shoes'),
      check('ID / wallet'),
      check('Tap-to-pay set up on phone'),
      check('Light jacket / layers'),
    ],
    settings: defaultSettings(),
  };
}

function defaultSettings() {
  return { theme: 'auto', suggestions: true, lookup: true, booking: true, units: usesImperial() ? 'imperial' : 'metric', ...deviceFormats() };
}

/* ---------- Checking data that comes from outside the app ----------
   The saved copy, the account (sync.js) and backup files all go through these. The fields the app
   relies on get the right type; anything else is left alone (a newer version may have added it).
   Something without a usable id gets a new one (newId), or is left out (returns null). */

function tidyTrip(t, newId = false) {
  if (!t || typeof t !== 'object' || (!isId(t.id) && !newId)) return null;
  const out = {
    ...t,
    id: isId(t.id) ? t.id : uid(),
    name: (typeof t.name === 'string' && t.name) || 'Trip',
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : COLORS[0],
    start: isDate(t.start) && isDate(t.end) ? t.start : '',
    end: isDate(t.start) && isDate(t.end) ? t.end : '',
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
    title: text(i.title) || 'Untitled',
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
  return out;
}

function tidyCheck(c, newId = false) {
  if (!c || typeof c !== 'object' || typeof c.text !== 'string' || !c.text || (!isId(c.id) && !newId)) return null;
  return { ...c, id: isId(c.id) ? c.id : uid(), done: c.done === true };
}

// The copy saved on this device: nothing is thrown away, whatever state it is in.
function tidyState(data) {
  const trips = data.trips.map((t) => {
    const trip = tidyTrip(t, true);
    if (trip) trip.items = (Array.isArray(t.items) ? t.items : []).map(i => tidyItem(i, true)).filter(Boolean);
    return trip;
  }).filter(Boolean);
  return {
    ...data,
    trips,
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
    }
  } catch (e) {
    console.warn('Could not read saved data', e);
    // Starting fresh would overwrite it: keep what was there, in case it can be rescued.
    try { localStorage.setItem(STORAGE_KEY + '.unreadable', localStorage.getItem(STORAGE_KEY)); } catch { /* storage full */ }
  }
  return defaultState();
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    snackbar('Could not save — device storage may be full');
  }
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
saveLocal();

const ui = { view: 'plan', ideasTab: 'mine', filter: 'all', shuffle: {}, suggest: {}, pickDay: null };

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
}

// The Back (or Forward) button.
window.addEventListener('popstate', () => {
  const view = pageView();
  if (view === ui.view) return;
  scrollAt[ui.view] = window.scrollY;
  ui.view = view;
  render();
  window.scrollTo(0, scrollAt[view] || 0);
});

// The trip on screen, or null before the first trip is added.
function activeTrip() {
  return state.trips.find(t => t.id === state.activeTripId) || state.trips[0] || null;
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

// Light or dark: your choice in Settings → Appearance, or the phone's setting when "Automatic".
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyAppearance() {
  const t = state.settings.theme;
  document.documentElement.dataset.theme =
    (t === 'light' || t === 'dark') ? t : (darkQuery.matches ? 'dark' : 'light');
  setMapTheme();      // maps.js: the map is light or dark too
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

const TITLES = { plan: '', ideas: '', pack: 'Checklist', more: 'Settings' };

// Trips made before place search (or saved while offline) get their place looked up once.
const placeTried = new Set();
function ensurePlace(trip) {
  if (trip.place || placeTried.has(trip.id) || !navigator.onLine) return;
  placeTried.add(trip.id);
  findPlace(trip.name).then((place) => {
    if (!place || trip.place || !state.trips.includes(trip)) return;
    trip.place = place;
    save();
    render();
  });
}

// A guide has just been fetched for a place (places.js).
// quiet: an older saved guide was refreshed in the background, so no message.
function onGuideReady(place, guide, quiet) {
  readyGuides.delete(placeKey(place));
  renderSoon();
  const trip = activeTrip();
  if (!quiet && trip && trip.place && placeKey(trip.place) === placeKey(place) && ui.view !== 'ideas') {
    snackbar(`${plural(guide.places.length, 'idea')} for ${place.name} ready`, 'Explore', () => {
      ui.ideasTab = 'explore';
      showView('ideas', { top: true });
    });
  }
}

function render() {
  const trip = activeTrip();
  state.activeTripId = trip ? trip.id : null;
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
  $('#fab').hidden = !tripViews || !trip;
  $('#fab-label').textContent = ui.view === 'ideas' ? 'New idea' : 'New plan';
  $('#fab').setAttribute('aria-label', $('#fab-label').textContent);
  if (tripViews && !trip) renderWelcome();
  else if (tripViews) renderTripTabs(trip);

  if (trip && ui.view === 'plan') renderPlan(trip);
  if (trip && ui.view === 'ideas') renderIdeas(trip);
  if (ui.view === 'pack') renderChecklist();
  if (ui.view === 'more') renderMore();
  renderSidebar(trip);
  renderDayStrip(trip);
  syncMapDock();      // maps.js: on a wide window the map stays beside the plan
  onScroll();
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
    <button type="button" class="side-ai ripple" data-action="assistant">${icon('auto_awesome')}AI Assistant</button>
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
  $('#view-' + ui.view).innerHTML = `
    <section class="hero welcome">
      ${shape(HERO_SHAPE, 'hero-shape')}
      ${icon('flight_takeoff', 'hero-shape-icon')}
      <p class="hero-overline">${ideas ? 'Ideas for your trip' : 'Plan a trip'}</p>
      <h1 class="hero-title">Where do you want to go?</h1>
      <button type="button" class="where-btn ripple" data-action="new-trip">
        ${icon('search')}<span>Search a city or country</span>
      </button>
    </section>
    <p class="welcome-note">${ideas
      ? 'Pick a place first. Its sights, food and things to do show up here, to save for later or add to a day.'
      : `Pick a place and you’ll get ideas for things to do there, day by day.
      Already planning on another device? Sign in under <b>Settings</b> to bring your trips here.`}</p>`;
}

function renderTripTabs(trip) {
  $('#trip-tabs').innerHTML =
    state.trips.map(t => `
      <button type="button" class="trip-chip ripple ${t.id === trip.id ? 'active' : ''}" data-trip="${esc(t.id)}"
        style="--c:${esc(t.color)}" aria-pressed="${t.id === trip.id}">
        <span class="dot"></span>${esc(t.name)}
      </button>`).join('') +
    `<button type="button" class="trip-chip add ripple" data-action="new-trip" aria-label="Add a trip">${icon('add', 'sm')}</button>`;
}

// drag: can be held and dragged to another day (Plan view). note: opening hours line (hours.js).
// schedule: an idea in the Ideas tab, with "Add to a day" instead of the done checkbox.
// num: the stop's number on the day's map (shown in place of the category icon). photo: a picture of the place.
function itemHTML(item, trip, { showDate = false, drag = false, note = null, schedule = false, num = 0, photo = '' } = {}) {
  const cat = CATEGORIES[item.category] || CATEGORIES.other;
  const link = safeUrl(item.link);
  const over = [
    item.time && fmtTime(item.time),
    showDate && item.date && fmtDay(item.date),
    cat.label,
  ].filter(Boolean).join(' · ');
  const days = schedule ? tripDays(trip) : [];
  let chips;
  if (schedule && ui.pickDay === item.id) {
    // Picking a day for this idea: one button per trip day.
    chips = days.map(d => `<button type="button" class="assist-chip ripple" data-action="set-day" data-date="${d}">${esc(fmtDay(d, { weekday: 'short', day: 'numeric' }))}</button>`).join('')
      + `<button type="button" class="assist-chip icon-only ripple" data-action="pick-day" aria-label="Cancel">${icon('close')}</button>`;
  } else {
    chips = [
      schedule && days.length && `<button type="button" class="assist-chip primary ripple" data-action="pick-day">${icon('calendar_add_on')}Add to a day</button>`,
      item.place && `<a class="assist-chip ripple" href="${esc(mapsUrl(item.place, trip))}" target="_blank" rel="noopener">${icon('location_on')}Directions</a>`,
      link && `<a class="assist-chip ripple" href="${esc(link)}" target="_blank" rel="noopener">${icon('link')}${esc(hostLabel(link))}</a>`,
      filesOf(item.id).length && `<button type="button" class="assist-chip ripple" data-action="files">${icon('confirmation_number')}${filesOf(item.id).length === 1 ? 'Ticket' : `${filesOf(item.id).length} files`}</button>`,
      hasPlanInfo(item, guideFor(trip)) && `<button type="button" class="assist-chip icon-only ripple" data-action="plan-info" aria-label="About ${esc(item.title)}" title="About this place">${icon('info')}</button>`,
      item.date && !item.done && `<a class="assist-chip icon-only ripple" href="${esc(calendarUrl(item, trip))}" target="_blank" rel="noopener" aria-label="Add ${esc(item.title)} to Google Calendar" title="Add to Google Calendar">${icon('calendar_add_on')}</a>`,
    ].filter(Boolean).join('');
  }
  const check = schedule ? '' : `<button type="button" class="check ripple" data-action="toggle" role="checkbox"
        aria-checked="${item.done}" aria-label="Done: ${esc(item.title)}" title="Done"><span class="box">${icon('check')}</span></button>`;
  // The address line is skipped when it only repeats the title.
  const showPlace = item.place && norm(item.place) !== norm(item.title);
  const book = bookingNote(item, trip, guideFor(trip));
  return `
    <li class="item ${item.done ? 'done' : ''}" data-id="${esc(item.id)}" ${drag ? 'data-drag' : ''}>
      <button type="button" class="item-main ripple" data-action="edit">
        ${num ? `<span class="stop-badge" aria-label="Stop ${num}">${num}</span>` : `<span class="avatar" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}</span>`}
        <span class="item-text">
          <span class="overline">${esc(over)}</span>
          <span class="item-title">${esc(item.title)}</span>
          ${showPlace ? `<span class="item-sub">${esc(item.place)}</span>` : ''}
          ${note && !item.done ? `<span class="item-hours ${note.warn ? 'warn' : ''}">${icon(note.warn ? 'event_busy' : 'schedule')}${esc(note.text)}</span>` : ''}
          ${book ? `<span class="item-hours book">${icon('confirmation_number')}${esc(book.text)}</span>` : ''}
          ${item.notes ? `<span class="item-notes">${esc(item.notes)}</span>` : ''}
        </span>
        ${photo ? `<span class="item-photo">${icon(cat.icon + '-fill')}${photoImg({ photo }, '')}</span>` : ''}
      </button>
      ${chips || check ? `<div class="item-chips">${chips}${check}</div>` : ''}
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
      <p class="hero-overline">${hasDates
        ? esc(`${fmtDay(trip.start, { month: 'short', day: 'numeric' })} – ${fmtDay(trip.end, { month: 'short', day: 'numeric' })} · ${plural(n, 'day')}`)
        : 'No dates yet'}</p>
      <h1 class="hero-title">${esc(trip.name)}</h1>
      <div class="hero-row">
        ${status
          ? `<span class="status-chip">${icon(status.icon, 'sm')}${esc(status.text)}</span>`
          : `<button type="button" class="btn filled ripple" data-action="edit-trip">${icon('calendar_add_on')}Add dates</button>`}
        ${planned.length ? `
          <div class="hero-progress">
            <span>${done} of ${plural(planned.length, 'plan')} done</span>
            ${progressBar(done / planned.length, 'Plans done')}
          </div>` : ''}
      </div>
      <div class="hero-actions">
        ${planned.length ? `<button type="button" class="hero-btn ripple" data-action="trip-map">${icon('map')}Trip map</button>` : ''}
        <button type="button" class="hero-btn ripple" data-action="assistant">${icon('auto_awesome')}AI Assistant</button>
        ${trip.place ? `<button type="button" class="hero-btn ripple" data-action="essentials">${icon('info')}Essentials</button>` : ''}
        <button type="button" class="hero-btn ripple" data-action="share-trip">${icon('share')}Share</button>
      </div>
      <button type="button" class="icon-btn hero-edit ripple" data-action="edit-trip" aria-label="Edit trip">${icon('edit')}</button>
    </section>`;

  html += nowCardHTML(trip);   // today.js: on a trip day, what's on now and what's next

  const guide = guideFor(trip);
  const suggestions = planSuggestions(trip, guide, days);
  // Suggestions are open for the first day from today that has some; the rest open with a tap.
  const focusDay = days.find(d => d >= today && suggestions.get(d) && suggestions.get(d).cards.length);
  if (!guide && guideState(trip) === 'loading' && state.settings.suggestions) {
    html += `<p class="guide-note" role="status">${icon('auto_awesome')}Finding things to do in ${esc(trip.place.name)}…</p>`;
  }

  let noDays = '';
  if (!days.length) {
    noDays = emptyState('event_available', 'Your days will appear here',
      `Add the dates for ${esc(trip.name)} and you'll see the trip day by day.`,
      `<div class="empty-actions">
        ${ideas ? `<button type="button" class="btn tonal ripple" data-action="open-ideas" data-tab="mine">${icon('lightbulb')}See ${plural(ideas, 'idea')}</button>` : ''}
        ${guide ? `<button type="button" class="btn tonal ripple" data-action="open-ideas" data-tab="explore">${icon('explore')}Explore ${esc(guide.city)}</button>` : ''}
      </div>`);
  }

  // Ideas not on a day yet, ready to be dragged onto one.
  const unplanned = trip.items.filter(i => !i.date);
  if (days.length && unplanned.length) {
    html += `
      <section class="idea-tray" aria-label="Ideas to schedule">
        <p class="tray-head">${icon('lightbulb')}<span><b>Ideas</b> · <span class="touch-only">hold one and drag it onto a day</span><span class="mouse-only">drag one onto a day</span></span></p>
        <ul class="tray-row">
          ${unplanned.map((it) => {
            const cat = CATEGORIES[it.category] || CATEGORIES.other;
            return `
              <li class="idea-chip" data-id="${esc(it.id)}" data-drag>
                <button type="button" class="ripple" data-action="edit">
                  <span class="avatar" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}</span>${esc(it.title)}
                </button>
              </li>`;
          }).join('')}
        </ul>
      </section>`;
  }

  // On a computer the trip card and ideas sit beside the days (two columns); on a phone they stack.
  html = `<div class="plan-side">${html}</div><div class="plan-days">${noDays}`;

  for (const day of days) {
    const items = dayItems(trip, day);
    const inRange = hasDates && day >= trip.start && day <= trip.end;
    const isToday = day === today;
    const sub = [
      isToday && '<b>Today</b>',
      inRange ? `Day ${daysBetween(trip.start, day) + 1}` : 'Outside trip dates',
      items.length && plural(items.length, 'plan'),
    ].filter(Boolean).join(' · ');
    html += `
      <section class="day ${isToday ? 'is-today' : ''}" id="day-${day}" style="--day:${dayTint(days.indexOf(day))}">
        <div class="day-head">
          <div class="day-text">
            <h2 class="day-title">${esc(fmtDay(day, { weekday: 'long', month: 'short', day: 'numeric' }))}</h2>
            <div class="day-sub">${sub}</div>
          </div>
          ${weatherHTML(trip, day)}
          <button type="button" class="icon-btn tonal ripple" data-action="add-on-day" data-date="${day}"
            aria-label="Add a plan on ${esc(fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric' }))}">${icon('add')}</button>
        </div>
        ${dayToolsHTML(trip, day, items, guide)}
        ${items.length
          ? `<ul class="group plans">${dayListHTML(items, trip, guide)}</ul>`
          : `<button type="button" class="empty-day ripple" data-action="add-on-day" data-date="${day}">${icon('add')}Free day — tap to add a plan</button>`}
        ${suggestionsHTML(suggestions.get(day), day, ui.suggest[day] ?? day === focusDay)}
      </section>`;
  }

  $('#view-plan').innerHTML = html + '</div>';
  // Plans with an address that isn't in the guide get looked up on the map, then their opening hours.
  lookupMissing(trip, planned);
  lookupHours(trip, planned);
  lookupBooking(trip);         // assistant.js: which plans are known to sell out
  // Save the trip's essentials while online, so they're there on arrival.
  essentialsFor(trip);
}

// The travel time between two stops, as a link to directions. label: e.g. "From Hotel Avenida".
function legHTML(a, b, mode, label = '') {
  const d = miles(a, b);
  if (d < 0.05) return '';
  const t = travel(d, mode);
  return `
    <li class="leg"><a class="leg-link ripple" href="${esc(directionsUrl(a, b, t.mode))}" target="_blank" rel="noopener"
      aria-label="Directions ${label ? esc(label.toLowerCase()) : ''} ${esc(t.text)}, ${fmtDist(d)}">${label ? `${icon('hotel')}<span class="leg-base">${esc(label)}:</span>` : ''}${icon(t.icon)}<span>${esc(t.text)} · ${fmtDist(d)}</span><span class="leg-go">Directions</span></a></li>`;
}

// A day's plans, with the travel time between each pair of stops, and to and from the home base (today.js).
function dayListHTML(items, trip, guide) {
  const day = items[0].date;
  const mode = modeFor(trip, day);
  const base = baseFor(trip, day, guide);
  const located = items.filter(it => coordsOf(it, guide));
  const useBase = base && located.length && !items.includes(base.item);
  // The day starts at the hotel: its name, then the way to the first stop.
  let html = useBase ? `
    <li class="stay-pill"><button type="button" class="ripple" data-action="edit" data-id="${esc(base.item.id)}"
      aria-label="Your stay: ${esc(base.item.title)}">${icon('hotel')}<span>${esc(base.item.title)}</span></button></li>` : '';
  let prev = useBase ? base.c : null;
  let num = 0;
  for (const item of items) {
    const c = coordsOf(item, guide);
    if (prev && c) html += legHTML(prev, c, mode);
    html += itemHTML(item, trip, { drag: true, note: hoursNote(item, guide), num: c ? ++num : 0, photo: planPhoto(item, guide) });
    if (c) prev = c;
  }
  if (useBase) html += legHTML(prev, base.c, mode, 'Back to your stay');
  return html;
}

// Suggestions for a day. Open by default only for the day being planned next (the others
// show one line to tap), so a long trip isn't a wall of cards.
function suggestionsHTML(s, day, open) {
  if (!s || !s.cards.length) return '';
  if (!open) {
    return `
      <button type="button" class="suggest-toggle ripple" data-action="toggle-suggest" data-date="${day}" aria-expanded="false">
        ${icon('auto_awesome')}<span>${esc(s.title)}</span><small>${plural(s.cards.length, 'idea')}</small>${icon('arrow_forward', 'sm turn')}
      </button>`;
  }
  return `
    <div class="suggest">
      <div class="suggest-head">
        <button type="button" class="suggest-title ripple" data-action="toggle-suggest" data-date="${day}" aria-expanded="true">${icon('auto_awesome')}${esc(s.title)}</button>
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
      <button type="button" class="item-main ripple" data-action="place-info" data-place="${esc(p.id)}" data-date="">
        ${placeThumb(p, cat)}
        <span class="item-text">
          <span class="overline">${esc(over)}</span>
          <span class="item-title">${esc(p.name)}</span>
          <span class="item-notes">${esc(p.blurb)}</span>
          <span class="more-link">More${icon('arrow_forward')}</span>
        </span>
      </button>
      <button type="button" class="icon-btn tonal add-btn ripple ${added ? 'added' : ''}"
        data-action="${added ? 'noop' : 'add-suggestion'}" data-place="${esc(p.id)}" data-date=""
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
      <button type="button" class="ripple" data-action="ideas-tab" data-tab="explore" aria-pressed="${tab === 'explore'}">${icon('explore')}Explore</button>
    </div>`;

  if (tab === 'mine') {
    html += `
      <p class="supporting">Things you might do in ${esc(trip.name)}. Add one to a day when you're ready, or tap it to edit.</p>
      ${ideas.length
        ? `<ul class="group plans">${ideas.map(it => itemHTML(it, trip, { schedule: true })).join('')}</ul>`
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
        'Connect to the internet once, and the guide is saved on your device for later.');
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
        'Connect to the internet once, and the guide is saved on your device for later.');
    }
  } else {
    const taken = new Set(trip.items.flatMap(i => matchPlaces(i, guide).map(p => p.id)));
    const destinations = guide.kind === 'destinations' && !guide.joined;
    const filter = destinations ? FILTERS[0] : FILTERS.find(f => f[0] === ui.filter) || FILTERS[0];
    const list = guide.places.filter(filter[2]);
    const intro = guide.joined ? `${guide.places.length} places near your plans and in ${esc(guide.city)}, from ${guide.source}.`
      : !guide.source ? `${guide.places.length} hand-picked places in ${esc(guide.city)}.`
      : destinations ? `${guide.places.length} cities and destinations in ${esc(guide.city)}, from the ${guide.source} travel guide.`
      : `${guide.places.length} places in ${esc(guide.city)}, from ${guide.source}.`;
    html += `
      <p class="supporting">${intro} Tap + to save one to your ideas.</p>
      ${trip.place && guide.source ? `
        <div class="place-row">
          <span class="place-pin">${icon('location_on')}${esc(trip.place.label)}</span>
          <button type="button" class="btn text ripple" data-action="near-me">${icon('my_location')}Near me</button>
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
    <li class="task ${c.done ? 'done' : ''}" data-check="${esc(c.id)}">
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
    ${packingHTML(activeTrip())}
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
        <span class="row-text"><span class="row-title">Sync between devices</span>
          <span class="row-sub">Not set up yet — see “Sync between devices” in the README</span></span>
      </div></li>`;
  } else if (!signedIn) {
    account = `
      <li><button type="button" class="row accent ripple" data-action="sign-in">
        <span class="row-icon">${icon('login')}</span>
        <span class="row-text"><span class="row-title">Sign in to sync</span>
          <span class="row-sub">Share trips and plans with another device using the same login</span></span>
      </button></li>`;
  } else {
    account = `
      <li><div class="row">
        <span class="row-icon">${icon(sync.status === 'error' ? 'error' : navigator.onLine ? 'cloud_done' : 'cloud_off')}</span>
        <span class="row-text"><span class="row-title">${esc(sync.saved.email)}</span>
          <span class="row-sub">${syncStatusText()}</span></span>
      </div></li>
      <li><button type="button" class="row ripple" data-action="change-password">
        <span class="row-icon">${icon('shield')}</span>
        <span class="row-text"><span class="row-title">Change password</span></span>
      </button></li>
      <li><button type="button" class="row ripple" data-action="sign-out">
        <span class="row-icon">${icon('logout')}</span>
        <span class="row-text"><span class="row-title">Sign out</span><span class="row-sub">Plans stay on this device but stop syncing</span></span>
      </button></li>
      <li><button type="button" class="row danger ripple" data-action="delete-account">
        <span class="row-icon">${icon('delete')}</span>
        <span class="row-text"><span class="row-title">Delete account</span><span class="row-sub">Removes the login and the trips stored in it</span></span>
      </button></li>`;
  }

  $('#view-more').innerHTML = `
    <h1 class="headline">Settings</h1>

    <h2 class="group-label">Account</h2>
    <ul class="group">${account}</ul>

    <h2 class="group-label">Trips</h2>
    <ul class="group">
      ${state.trips.map(t => `
        <li><button type="button" class="row ripple" data-action="edit-trip" data-trip-id="${esc(t.id)}">
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
      <li><div class="row">
        <div class="segmented" role="group" aria-label="Units">
          ${[['metric', 'Metric · km, °C'], ['imperial', 'Imperial · mi, °F']].map(([value, label]) => `
            <button type="button" class="ripple" data-action="units" data-value="${value}" aria-pressed="${imperial() === (value === 'imperial')}">${label}</button>`).join('')}
        </div>
      </div></li>
      <li><div class="row">
        <div class="segmented" role="group" aria-label="Date format">
          ${[['dmy', '31 Oct'], ['mdy', 'Oct 31']].map(([value, label]) => `
            <button type="button" class="ripple" data-action="date-order" data-value="${value}" aria-pressed="${state.settings.dateOrder === value}">${label}</button>`).join('')}
        </div>
      </div></li>
      <li><div class="row">
        <div class="segmented" role="group" aria-label="Time format">
          ${[['24', '24-hour · 14:30'], ['12', '12-hour · 2:30 PM']].map(([value, label]) => `
            <button type="button" class="ripple" data-action="clock" data-value="${value}" aria-pressed="${state.settings.clock === value}">${label}</button>`).join('')}
        </div>
      </div></li>
      <li><button type="button" class="row ripple" data-action="toggle-suggestions" role="switch" aria-checked="${state.settings.suggestions}">
        <span class="row-icon">${icon('auto_awesome')}</span>
        <span class="row-text"><span class="row-title">Day suggestions</span><span class="row-sub">Ideas under each day, from the city’s travel guide</span></span>
        <span class="switch ${state.settings.suggestions ? 'on' : ''}" aria-hidden="true"></span>
      </button></li>
      <li><button type="button" class="row ripple" data-action="toggle-lookup" role="switch" aria-checked="${state.settings.lookup}">
        <span class="row-icon">${icon('pin_drop')}</span>
        <span class="row-text"><span class="row-title">Find addresses and opening hours</span><span class="row-sub">Sends the place names you typed (not your plans) to OpenStreetMap</span></span>
        <span class="switch ${state.settings.lookup ? 'on' : ''}" aria-hidden="true"></span>
      </button></li>
      ${aiReady() ? `<li><button type="button" class="row ripple" data-action="toggle-booking" role="switch" aria-checked="${state.settings.booking !== false}">
        <span class="row-icon">${icon('confirmation_number')}</span>
        <span class="row-text"><span class="row-title">Flag plans that sell out</span><span class="row-sub">Sends the names of your plans to Google Gemini (free service)</span></span>
        <span class="switch ${state.settings.booking !== false ? 'on' : ''}" aria-hidden="true"></span>
      </button></li>` : ''}
    </ul>

    <h2 class="group-label">App</h2>
    <ul class="group">
      ${installPrompt ? `
        <li><button type="button" class="row accent ripple" data-action="install">
          <span class="row-icon">${icon('install_mobile')}</span>
          <span class="row-text"><span class="row-title">Install app</span><span class="row-sub">Add Dotted Line to your home screen</span></span>
        </button></li>` : ''}
      <li><div class="row">
        <span class="row-icon">${icon('offline_pin')}</span>
        <span class="row-text"><span class="row-title">Works offline</span>
          <span class="row-sub">${offlineReady ? '<span class="ok">Ready</span> — saved on this device' : 'Open the app once while online'}</span></span>
      </div></li>
      <li><div class="row">
        <span class="row-icon">${icon('shield')}</span>
        <span class="row-text"><span class="row-title">Data protected</span>
          <span class="row-sub">${storagePersisted ? '<span class="ok">On</span> — Android won’t clear it' : 'Installing the app usually turns this on'}</span></span>
      </div></li>
    </ul>

    <h2 class="group-label">Backup &amp; calendar</h2>
    <ul class="group">
      ${activeTrip() ? `<li><button type="button" class="row ripple" data-action="trip-calendar">
        <span class="row-icon">${icon('calendar_add_on')}</span>
        <span class="row-text"><span class="row-title">Calendar file for ${esc(activeTrip().name)}</span><span class="row-sub">Every plan with a day, for any calendar app (in Google Calendar: Settings → Import)</span></span>
      </button></li>` : ''}
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
      ? 'Your plans are stored on this device and in your account.'
      : 'Your plans are stored only on this device.'}</p>
    <p class="footnote">Maps, address and place search: © OpenStreetMap contributors. City guides: Wikivoyage and Wikipedia, CC BY-SA.</p>`;
}

/* ---------- Plan form (add / edit) ---------- */

const itemDialog = $('#item-dialog');
const itemForm = $('#item-form');
let editingItemId = null;

$('#item-category').insertAdjacentHTML('beforeend', Object.entries(CATEGORIES).map(([k, c]) => `
  <label style="--h:${c.hue}"><input type="radio" name="category" value="${k}">
    <span class="ripple">${icon(c.icon + '-fill')}${esc(c.label)}</span></label>`).join(''));

// Example texts for the plan form, from the trip's own guide and the type of plan chosen
// (a sight in Lisbon → "e.g. Visit Praça do Comércio"). Plain wording when there's no guide yet.
function planExamples(trip, category) {
  const city = trip ? (trip.place ? trip.place.name : trip.name) : '';
  const inCity = city ? ` in ${city}` : '';
  if (category === 'transport') return { title: 'e.g. Train to the airport', place: `e.g. the main station${inCity}` };
  if (category === 'stay') return { title: 'e.g. Hotel check-in', place: 'The address of your hotel or apartment' };
  const guide = trip && guideFor(trip);
  const taken = guide ? new Set(trip.items.flatMap(i => matchPlaces(i, guide).map(p => p.id))) : new Set();
  const pool = guide ? guide.places.filter(p => !taken.has(p.id)) : [];
  const p = pool.find(x => x.cat === category) || (category === 'other' ? pool[0] : null);
  if (!p) {
    const generic = { sight: 'Visit the old town', food: 'Dinner out', event: 'Concert or show', shopping: 'Browse the market', other: 'Meet friends' };
    return { title: `e.g. ${generic[category] || generic.sight}`, place: `A place name or an address${inCity}` };
  }
  const verb = guide.kind === 'destinations' ? 'Day trip to ' : { sight: 'Visit ', food: 'Eat at ', shopping: 'Shopping at ' }[category] || '';
  return { title: `e.g. ${verb}${p.name}`, place: `e.g. ${p.place || p.name}` };
}

function setPlanExamples() {
  const ex = planExamples(activeTrip(), itemForm.elements.category.value || 'sight');
  itemForm.elements.title.placeholder = ex.title;
  itemForm.elements.place.placeholder = ex.place;
}

// "Near the trip": within reach of a city, or anywhere inside a region's or country's borders.
function nearTrip(trip, guide) {
  const near = trip.place || (guide && guide.places[0]);
  const reach = { region: 400, country: 1500 }[trip.place && trip.place.kind] || 60;
  const box = trip.place && trip.place.kind !== 'city' && trip.place.bbox;
  return p => !near || miles(near, p) < reach
    || (box && p.lng >= box[0] - 1 && p.lng <= box[2] + 1 && p.lat >= box[1] - 1 && p.lat <= box[3] + 1);
}

/* Matching places: as you type a plan's name or its address, real places near the trip appear
   below (from the guide, then OpenStreetMap). Picking one fills in the address and pins the
   plan on the map at that exact spot. */
const planMatch = { chosen: null, results: [], field: '', timer: 0, ctl: null, typeSet: false };
const NUMBER_FIRST = new Set(['US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'FR']);   // "9 West Street", not "West Street 9"
const OSM_CATEGORY = {
  shop: 'shopping',
  restaurant: 'food', cafe: 'food', bar: 'food', pub: 'food', fast_food: 'food', ice_cream: 'food', food_court: 'food', biergarten: 'food',
  hotel: 'stay', hostel: 'stay', guest_house: 'stay', motel: 'stay', apartment: 'stay',
  station: 'transport', aerodrome: 'transport', bus_station: 'transport', ferry_terminal: 'transport',
  attraction: 'sight', museum: 'sight', viewpoint: 'sight', gallery: 'sight', artwork: 'sight', park: 'sight',
  theatre: 'event', cinema: 'event', stadium: 'event',
};

function matchFromPhoton(f) {
  const p = f.properties;
  const street = p.street && (p.housenumber
    ? (NUMBER_FIRST.has(p.countrycode) ? `${p.housenumber} ${p.street}` : `${p.street} ${p.housenumber}`) : p.street);
  const town = p.city || p.district || p.county || p.state || '';
  const address = [street, town !== p.name && town].filter(Boolean).join(', ');
  return {
    name: p.name,
    // With a street, the address alone; a park or a square keeps its name ("Central Park, New York").
    place: (street ? address : [p.name, address].filter(Boolean).join(', ')).slice(0, 200),
    sub: address || p.country || '',
    cat: OSM_CATEGORY[p.osm_key] || OSM_CATEGORY[p.osm_value] || '',
    lat: Math.round(f.geometry.coordinates[1] * 1e5) / 1e5,
    lng: Math.round(f.geometry.coordinates[0] * 1e5) / 1e5,
  };
}

async function findMatches(trip, q, signal) {
  const guide = guideFor(trip);
  const fromGuide = guide ? guide.places.filter(p => norm(p.name).includes(norm(q))).slice(0, 3).map(p => ({
    name: p.name, place: p.place || p.name, sub: p.area || guide.city || '', cat: p.cat, lat: p.lat, lng: p.lng, guideId: p.id,
  })) : [];
  if (!navigator.onLine) return fromGuide;
  const params = new URLSearchParams({ q, limit: '8', lang: 'en' });
  // Results close to the trip come first: around its plans, else its city.
  const by = trip.items.find(i => typeof i.lat === 'number') || trip.place || (guide && guide.places[0]);
  if (by) { params.set('lat', by.lat); params.set('lon', by.lng); }
  const res = await fetch('https://photon.komoot.io/api/?' + params, { signal });
  if (!res.ok) return fromGuide;
  const fits = nearTrip(trip, guide);
  const seen = new Set(fromGuide.map(m => norm(m.name)));
  const found = (await res.json()).features
    .filter(f => f.properties.name && !['country', 'state', 'county', 'city'].includes(f.properties.type))
    .map(matchFromPhoton)
    .filter(m => fits(m) && !seen.has(norm(m.name) + m.sub) && !seen.has(norm(m.name)) && seen.add(norm(m.name) + m.sub));
  return [...fromGuide, ...found].slice(0, 5);
}

function showMatches(field, results) {
  planMatch.field = field;
  planMatch.results = results;
  for (const box of itemForm.querySelectorAll('[data-match]')) {
    const mine = box.dataset.match === field && results.length > 0;
    box.hidden = !mine;
    box.innerHTML = !mine ? '' : results.map((m, i) => `
      <li><button type="button" class="place-opt ripple" data-match-index="${i}">
        ${icon(CATEGORIES[m.cat] ? CATEGORIES[m.cat].icon + '-fill' : 'location_on')}
        <span class="row-text"><span class="row-title">${esc(m.name)}</span>${m.sub ? `<span class="row-sub">${esc(m.sub)}</span>` : ''}</span>
      </button></li>`).join('');
  }
}

function onMatchInput(e) {
  const field = e.target.name;
  const q = e.target.value.trim();
  const trip = activeTrip();
  clearTimeout(planMatch.timer);
  if (planMatch.ctl) planMatch.ctl.abort();
  if (!trip || q.length < 3) return showMatches(field, []);
  planMatch.timer = setTimeout(async () => {
    const ctl = planMatch.ctl = new AbortController();
    try {
      showMatches(field, await findMatches(trip, q, ctl.signal));
    } catch (err) {
      if (err.name !== 'AbortError') showMatches(field, []);
    }
  }, 300);
}
itemForm.elements.title.addEventListener('input', onMatchInput);
itemForm.elements.place.addEventListener('input', onMatchInput);

itemForm.addEventListener('click', (e) => {
  const opt = e.target.closest('[data-match-index]');
  if (!opt) return;
  const m = planMatch.results[Number(opt.dataset.matchIndex)];
  const f = itemForm.elements;
  // Picked under the name: the place's full name replaces what was typed of it ("brattle" → "Brattle Book Shop").
  if (planMatch.field === 'title' && norm(m.name).includes(norm(f.title.value.trim()))) f.title.value = m.name.slice(0, 120);
  f.place.value = m.place;
  if (m.cat && !editingItemId && !planMatch.typeSet) { f.category.value = m.cat; setPlanExamples(); }
  planMatch.chosen = m;
  showMatches('', []);
});

// Moving on to another field puts the list away.
itemForm.addEventListener('focusin', (e) => {
  if (planMatch.field && e.target.name !== planMatch.field && !e.target.closest('[data-match]')) {
    clearTimeout(planMatch.timer);
    if (planMatch.ctl) planMatch.ctl.abort();
    showMatches('', []);
  }
});

function openItemForm(item, defaults = {}) {
  planMatch.chosen = null;
  planMatch.typeSet = false;
  showMatches('', []);
  editingItemId = item ? item.id : null;
  const v = item || { title: '', category: 'sight', date: '', time: '', place: '', link: '', notes: '', ...defaults };
  $('#item-dialog-title').textContent = item ? 'Edit plan' : (v.date ? 'New plan' : 'New idea');
  for (const f of ['title', 'category', 'date', 'time', 'place', 'link', 'notes']) {
    itemForm.elements[f].value = v[f] || '';
  }
  itemForm.elements.booked.checked = v.booked === true;
  $('#item-delete').hidden = !item;
  showTimeClear();
  setPlanExamples();
  openFilesInForm(item ? item.id : null);   // files.js: tickets & bookings
  itemDialog.showModal();
  itemDialog.scrollTop = 0;
  if (!item) itemForm.elements.title.focus();
}

// The ✕ next to a set time takes it off again (a phone's time picker hides its own "Clear").
function showTimeClear() {
  $('#time-clear').hidden = !itemForm.elements.time.value;
}
itemForm.elements.time.addEventListener('input', showTimeClear);
itemForm.elements.time.addEventListener('change', showTimeClear);
$('#time-clear').addEventListener('click', () => {
  itemForm.elements.time.value = '';
  showTimeClear();
});

// Another type of plan: other examples.
$('#item-category').addEventListener('change', () => { planMatch.typeSet = true; setPlanExamples(); });

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
    booked: f.booked.checked,
  };
  if (!data.title) return;
  const trip = activeTrip();
  if (!trip) { itemDialog.close(); return; }
  const found = editingItemId && findItem(editingItemId);
  // A place picked from the list of matches (and its address left as it was filled in): its exact spot.
  const m = planMatch.chosen && planMatch.chosen.place === data.place ? planMatch.chosen : null;
  const spot = m ? { lat: m.lat, lng: m.lng, ...(m.guideId ? { guideId: m.guideId } : {}) } : {};
  if (editingItemId && !found) {
    // The plan was removed while its form was open (on another device): saving puts it back.
    trip.items.push({ id: editingItemId, done: false, ...data, ...spot });
  } else if (editingItemId) {
    // A new address means the saved map position no longer applies.
    if (found.item.place !== data.place) {
      delete found.item.lat;
      delete found.item.lng;
      delete found.item.guideId;
      delete found.item.geoMiss;
    }
    // A new day or a set time replaces the position chosen by Optimize route.
    if (found.item.date !== data.date || data.time) delete found.item.slot;
    if (m) { delete found.item.guideId; delete found.item.geoMiss; }
    Object.assign(found.item, data, spot);
  } else {
    trip.items.push({ id: uid(), done: false, ...data, ...spot });
  }
  saveFormFiles(editingItemId || trip.items[trip.items.length - 1].id);
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

$('#trip-travel').insertAdjacentHTML('beforeend', Object.entries(TRAVEL_MODES).map(([k, m]) => `
  <label style="--h:${k === 'drive' ? 25 : 205}"><input type="radio" name="travel" value="${k}">
    <span class="ripple">${icon(m.icon)}${esc(m.label)}</span></label>`).join(''));

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
  $('#trip-dialog-title').textContent = trip ? 'Edit trip' : state.trips.length ? 'New trip' : 'Where to?';
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
    travel: TRAVEL_MODES[f.travel.value] ? f.travel.value : 'transit',
  };
  if (!data.name) return;

  // No place picked from the list: use the best match for the name.
  let place = placeSearch.chosen;
  if (!place && navigator.onLine) {
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
  if (place && !guideFor(trip) && guideState(trip) === 'loading') snackbar(`Found ${place.label} — getting ideas…`);
  else if (!place && navigator.onLine) snackbar(`Couldn’t find ${data.name} on the map — no suggestions for it`);
});

$('#trip-delete').addEventListener('click', async () => {
  const trip = state.trips.find(t => t.id === editingTripId);
  if (!trip) return;
  const ok = await askConfirm({
    icon: 'delete',
    title: `Delete ${trip.name}?`,
    text: `This removes the trip and its ${plural(trip.items.length, 'plan')} from this device.`,
    ok: 'Delete',
  });
  if (!ok) return;
  state.trips = state.trips.filter(t => t.id !== trip.id);
  if (state.activeTripId === trip.id) state.activeTripId = state.trips.length ? state.trips[0].id : null;
  scrollAt = {};
  save();
  tripDialog.close();
  render();
  snackbar(`${trip.name} deleted`);
});

/* ---------- Sign in (for sync between phones) ---------- */

const authDialog = $('#auth-dialog');
const authForm = $('#auth-form');

let authCreate = false;   // the sheet is creating an account, not signing in

function openAuthForm() {
  authForm.reset();
  setAuthMode(false);
  authDialog.showModal();
  authForm.elements.email.focus();
}

// The same sheet signs in or creates an account. What was typed stays when switching.
function setAuthMode(create) {
  authCreate = create;
  $('#auth-title').textContent = create ? 'Create account' : 'Sign in to sync';
  $('#auth-text').textContent = create
    ? 'Choose an email and a password. You’ll use them on every device that should share these trips.'
    : 'Use the same email and password on every device that should share these trips.';
  $('#auth-repeat-field').hidden = !create;
  authForm.elements.password.autocomplete = create ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = create ? 'Create account' : 'Sign in';
  $('#auth-switch').textContent = create ? 'I have an account' : 'Create account';
  $('#auth-forgot').hidden = create;
  authError('');
}

function authError(text) {
  $('#auth-error').textContent = text;
  $('#auth-error').hidden = !text;
}

async function runAuth() {
  const create = authCreate;
  const f = authForm.elements;
  const email = f.email.value.trim();
  const password = f.password.value;
  if (!email || !password) return authError('Enter the email and password.');
  if (create && password.length < 6) return authError('Use at least 6 characters for the password.');
  if (create && password !== f.repeat.value) return authError('The two passwords don’t match.');
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

authForm.addEventListener('submit', (e) => { e.preventDefault(); runAuth(); });
$('#auth-switch').addEventListener('click', () => {
  setAuthMode(!authCreate);
  const f = authForm.elements;
  (!f.email.value ? f.email : !f.password.value ? f.password : authCreate ? f.repeat : f.password).focus();
});
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
  const f = authForm.elements;
  const show = f.password.type === 'password';
  f.password.type = f.repeat.type = show ? 'text' : 'password';
  e.currentTarget.setAttribute('aria-pressed', String(show));
  e.currentTarget.querySelector('use').setAttribute('href', `${SPRITE}#${show ? 'visibility_off' : 'visibility'}`);
});

/* ---------- Account: change the password, delete the account ---------- */

const accountDialog = $('#account-dialog');
const accountForm = $('#account-form');
let accountMode = 'password';   // or 'delete'

function openAccountForm(mode) {
  accountMode = mode;
  const del = mode === 'delete';
  accountForm.reset();
  $('#account-title').textContent = del ? 'Delete account?' : 'Change password';
  $('#account-text').textContent = del
    ? `This deletes the account ${sync.saved.email} and the trips stored in it, for good. Other devices signed in lose their copy. ` +
      'The trips stay on this device. Enter your password to confirm.'
    : 'Other devices signed in to this account will have to sign in again with the new password.';
  accountForm.querySelectorAll('[data-new-password]').forEach((el) => { el.hidden = del; });
  $('#account-submit').textContent = del ? 'Delete account' : 'Change password';
  $('#account-submit').classList.toggle('danger', del);
  accountError('');
  accountDialog.showModal();
  accountForm.elements.current.focus();
}

function accountError(text) {
  $('#account-error').textContent = text;
  $('#account-error').hidden = !text;
}

accountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = accountForm.elements;
  const current = f.current.value;
  const next = f.next.value;
  if (!current) return accountError('Enter your current password.');
  if (accountMode === 'password') {
    if (next.length < 6) return accountError('Use at least 6 characters for the new password.');
    if (next !== f.repeat.value) return accountError('The two new passwords don’t match.');
    if (next === current) return accountError('That’s the password you already have.');
  }
  if (!navigator.onLine) return accountError('No connection. Try again when you’re online.');
  accountError('');
  accountForm.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    if (accountMode === 'password') {
      await changePassword(current, next);
      accountDialog.close();
      snackbar('Password changed');
    } else {
      await deleteAccount(current);
      accountDialog.close();
      render();
      snackbar('Account deleted — your trips are still on this device');
    }
  } catch (err) {
    const wrong = /wrong-password|invalid-credential|invalid-login-credentials/.test((err && err.code) || '');
    accountError(wrong ? 'The current password is wrong.' : syncErrorText(err));
  } finally {
    accountForm.querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
});

// Close buttons and tapping the dark area outside a sheet close it.
for (const dlg of [itemDialog, tripDialog, authDialog, accountDialog, $('#confirm-dialog'), $('#map-dialog'), $('#info-dialog'), $('#place-dialog'), $('#ai-dialog'), $('#files-dialog'), $('#near-dialog')]) {
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
      if ($('#place-dialog').open) $('#place-dialog').close();
      if (navigator.vibrate) navigator.vibrate(12);
      snackbar(item.date ? `Added to ${fmtDay(item.date, { weekday: 'long' })}` : 'Saved to your ideas', 'Undo', () => {
        trip.items = trip.items.filter(i => i !== item);
        save();
        render();
      });
      break;
    }
    case 'toggle-suggest':
      ui.suggest[el.dataset.date] = el.getAttribute('aria-expanded') !== 'true';
      render();
      break;
    case 'pick-day':
      // An idea's "Add to a day": its buttons turn into the trip's days.
      ui.pickDay = ui.pickDay === itemEl.dataset.id ? null : itemEl.dataset.id;
      render();
      break;
    case 'set-day': {
      const found = findItem(itemEl.dataset.id);
      if (!found) break;
      const { item } = found;
      item.date = el.dataset.date;
      ui.pickDay = null;
      save();
      render();
      snackbar(`Added to ${fmtDay(item.date, { weekday: 'long' })}`, 'Undo', () => {
        item.date = '';
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
      ui.ideasTab = el.dataset.tab;
      showView('ideas', { top: true });
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
    case 'units':
      state.settings.units = el.dataset.value;
      save();
      render();
      break;
    case 'date-order':
      state.settings.dateOrder = el.dataset.value;
      save();
      render();
      break;
    case 'clock':
      state.settings.clock = el.dataset.value;
      save();
      render();
      break;
    case 'day-travel': {
      // Switches this day to the other way of getting around (or back to the trip's own).
      const trip = activeTrip();
      const day = el.dataset.date;
      const next = modeFor(trip, day) === 'drive' ? 'transit' : 'drive';
      trip.dayTravel = trip.dayTravel || {};
      if (next === (trip.travel || 'transit')) delete trip.dayTravel[day];
      else trip.dayTravel[day] = next;
      if (!Object.keys(trip.dayTravel).length) delete trip.dayTravel;
      save();
      render();
      snackbar(`${fmtDay(day, { weekday: 'long' })}: ${TRAVEL_MODES[next].label}`);
      break;
    }
    case 'toggle-suggestions':
      state.settings.suggestions = !state.settings.suggestions;
      save();
      render();
      break;
    case 'toggle-lookup':
      state.settings.lookup = !state.settings.lookup;
      if (state.settings.lookup) state.trips.forEach(t => t.items.forEach(i => delete i.geoMiss));
      save();
      render();
      break;
    case 'toggle-booking':
      state.settings.booking = state.settings.booking === false;
      save();
      render();
      break;
    case 'day-map':
      openMap(el.dataset.date);
      break;
    case 'trip-map':
      openMap('all');
      break;
    case 'jump-day': {
      // From the sidebar: go to that day in the plan, and show it on the map beside it.
      if (ui.view !== 'plan') { setView('plan'); render(); }
      const card = document.getElementById('day-' + el.dataset.date);
      if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      if (mapDocked()) openMap(el.dataset.date);
      break;
    }
    case 'optimize':
      runOptimize(el.dataset.date);
      break;
    case 'autofill':
      runAutoFill(el.dataset.date);
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
    case 'essentials':
      openEssentials(activeTrip());
      break;
    case 'assistant':
      openAssistant();
      break;
    case 'near-me':
      openNearMe();
      break;
    case 'files':
      openFiles(itemEl.dataset.id);
      break;
    case 'trip-calendar':
      downloadTripCalendar(activeTrip());
      break;
    case 'place-info':
      openPlaceInfo(el.dataset.place, el.dataset.date);
      break;
    case 'retry-essentials': {
      const trip = state.trips.find(t => t.id === essentials.tripId);
      if (trip && trip.place) {
        essentials.status.delete(placeKey(trip.place));
        loadEssentials(trip.place);
        renderEssentials();
      }
      break;
    }
    case 'retry-guide': {
      const trip = activeTrip();
      if (trip.place) loadGuide(trip.place, { retry: true });
      break;
    }
    case 'sign-in':
      openAuthForm();
      break;
    case 'change-password':
      openAccountForm('password');
      break;
    case 'delete-account':
      openAccountForm('delete');
      break;
    case 'sign-out': {
      const ok = await askConfirm({
        icon: 'logout',
        title: 'Sign out?',
        text: 'Your plans stay on this device, but changes will no longer sync with other devices until you sign in again.',
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
          ? 'All trips, plans and checklist items will be deleted — on this device and on every device signed in to your account. Save a backup first if you might want them back.'
          : 'All trips, plans and checklist items on this device will be deleted. Save a backup first if you might want them back.',
        ok: 'Erase',
      });
      if (ok) {
        state = defaultState();
        eraseDeviceData();
        save();
        scrollAt = {};
        showView('plan', { top: true });
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
  markCurrentDay();
}
window.addEventListener('scroll', onScroll, { passive: true });

/* ---------- Backup & restore ---------- */

// "Erase everything" also clears what is kept on this device only: tickets, assistant chats,
// hidden packing suggestions, and the saved guides, forecasts, opening hours and essentials.
function eraseDeviceData() {
  for (const key of [AI_KEY, PACKING_KEY, GUIDES_KEY, WEATHER_KEY, HOURS_KEY, ESSENTIALS_KEY, INFO_KEY]) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  }
  ai.saved = { chats: {}, booking: {} };
  for (const kept of [packingHidden, savedGuides]) for (const k of Object.keys(kept)) delete kept[k];
  readyGuides.clear();
  guideStatus.clear();
  weather.saved = {};
  hours.saved = {};
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
  snackbar('Backup saved to Downloads');
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
  const tripIds = new Map();      // the file's trip id → the id it has here
  const trips = data.trips.filter(t => t && typeof t === 'object').map(t => ({
    id: tripIds.set(t.id, id(t.id)).get(t.id),
    name: str(t.name, 40) || 'Trip',
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : COLORS[0],
    start: date(t.start),
    end: date(t.end),
    place: cleanPlace(t.place),
    travel: TRAVEL_MODES[t.travel] ? t.travel : 'transit',
    ...(t.dayTravel && typeof t.dayTravel === 'object' ? { dayTravel: Object.fromEntries(Object.entries(t.dayTravel).filter(([d, m]) => date(d) && TRAVEL_MODES[m])) } : {}),
    items: (Array.isArray(t.items) ? t.items : []).filter(i => i && typeof i === 'object').map(i => ({
      id: id(i.id),
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
      guideId: isId(i.guideId) ? i.guideId : undefined,
      slot: /^\d{2}:\d{2}~\d{2}$/.test(i.slot) ? i.slot : undefined,
      geoMiss: i.geoMiss === true || undefined,
      booked: i.booked === true || undefined,
    })),
  }));
  const checklist = (Array.isArray(data.checklist) ? data.checklist : [])
    .filter(c => c && typeof c === 'object' && str(c.text, 200))
    .map(c => ({ id: id(c.id), text: str(c.text, 200), done: c.done === true }));
  const activeTripId = tripIds.get(data.activeTripId) || (trips.length ? trips[0].id : null);
  const s = data.settings || {};
  const settings = {
    theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto',
    suggestions: s.suggestions !== false,
    lookup: s.lookup !== false,
    booking: s.booking !== false,
    units: ['metric', 'imperial'].includes(s.units) ? s.units : defaultSettings().units,
    dateOrder: ['dmy', 'mdy'].includes(s.dateOrder) ? s.dateOrder : defaultSettings().dateOrder,
    clock: ['24', '12'].includes(s.clock) ? s.clock : defaultSettings().clock,
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
    snackbar("That file isn't a Dotted Line backup");
    return;
  }
  const n = restored.trips.reduce((sum, t) => sum + t.items.length, 0);
  const ok = await askConfirm({
    icon: 'upload',
    title: 'Restore this backup?',
    text: `It has ${plural(restored.trips.length, 'trip')} and ${plural(n, 'plan')}. It will replace everything currently in the app` +
      (sync.saved ? ' — also on the other devices signed in to your account.' : '.'),
    ok: 'Restore',
  });
  if (!ok) return;
  state = restored;
  save();
  scrollAt = {};
  showView('plan', { top: true });
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
  snackbar('Installed! Find Dotted Line on your home screen.');
});

function updateOnlineBadge() { $('#offline-badge').hidden = navigator.onLine; }
function onConnectionChange() {
  updateOnlineBadge();
  // Back online: look up places and guides that couldn't be fetched offline,
  // and give the ones that failed (often because the connection dropped) another try.
  if (navigator.onLine) {
    placeTried.clear();
    for (const [key, status] of guideStatus) if (status === 'failed') guideStatus.delete(key);
    for (const [key, status] of essentials.status) if (status === 'failed') essentials.status.delete(key);
  }
  $('#ai-send').disabled = ai.busy || !aiReady() || !navigator.onLine;
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

// Scrolling is handled per section (showView). After a reload, open the section that was showing.
history.scrollRestoration = 'manual';
ui.view = pageView();
render();
startSync();
loadFileIndex();   // files.js: which plans have tickets attached

// If the trip is happening now, jump to today's card.
const todayCard = document.getElementById('day-' + todayISO());
if (todayCard) todayCard.scrollIntoView({ block: 'start' });
