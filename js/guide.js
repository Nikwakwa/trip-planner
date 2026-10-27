'use strict';

/* guide.js — the trip's guide (places.js) put to use: which guide place a plan is, the ideas under each
   day, Auto-fill day, and the "Book ahead" note. */

/* ---------- Which guide place a plan is ---------- */

// Prepare each guide place once: a pattern that recognises its name in your plans.
function prepGuide(g) {
  for (const p of g.places) {
    // An empty name would fit every plan: it is left out (and a place without any name fits none).
    const names = [p.name, ...(p.aliases || [])].map(a => escRe(norm(a).trim())).filter(Boolean).join('|');
    p.re = names ? new RegExp(`(^|[^a-z0-9])(${names})($|[^a-z0-9])`) : /(?!)/;
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
const matchMemo = new WeakMap();     // plan → the places with its name (this is asked many times per redraw)
const MATCH_REACH = 100;             // miles: wide enough for a plan anywhere in a big region or park
const SIGHT_REACH = 5;               // miles: a sight is in one town, and its namesake ("Rathaus") in another
const AROUND_REACH = 40;             // miles: how far a plan can be from the plans around it

// The plans around a plan that have their own spot on the map: from the day before to the day after
// (for an idea: the whole trip). trip: for a plan that isn't in a trip yet.
function plansAround(item, trip = state.trips.find(t => t.items.includes(item))) {
  if (!trip) return [];
  return trip.items.filter(i => i !== item && typeof i.lat === 'number' && typeof i.lng === 'number'
    && (!item.date || (i.date && Math.abs(daysBetween(i.date, item.date)) <= 1)));
}

// A name alone doesn't say where: a trip across a country has a "Rathaus", a "Residenz" and a "Castle" in
// several towns. So a plan with a spot on the map is only a place of that name right there, and a plan
// without one only a place near the plans around it. A destination (a city, a region) is big, and its
// name is its own: it is given more room.
function matchPlaces(item, guide, trip) {
  if (!guide) return [];
  const named = placesNamed(item, guide);
  if (!named.length || named[0].id === item.guideId) return named;
  const wide = p => guide.kind === 'destinations' && !p.local;
  if (typeof item.lat === 'number' && typeof item.lng === 'number') {
    return named.filter(p => typeof p.lat !== 'number' || miles(item, p) <= (wide(p) ? MATCH_REACH : SIGHT_REACH));
  }
  const around = plansAround(item, trip);
  return around.length ? named.filter(p => wide(p) || around.some(i => miles(i, p) < AROUND_REACH)) : named;
}

// The guide places a plan is named after, wherever they are.
function placesNamed(item, guide) {
  if (item.guideId) {
    const byId = guide.places.filter(p => p.id === item.guideId);
    if (byId.length) return byId;
  }
  // Of an address, only what comes before the first comma counts: "117 MacDougal St, New York, NY"
  // is not the city of New York. The longest name wins ("Boston Common" before "Boston").
  // A street address names a street, not a place: "22-43 Jackson Avenue" is not the town of Jackson.
  const where = String(item.place || '').split(',')[0];
  const text = norm(/^\s*\d/.test(where) ? item.title : `${where} | ${item.title}`);
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
      title = anchors.length ? T('Nearby ideas') : T('Ideas near your stay');
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
      // A district named after a direction ("North") isn't a place name on its own: "the north of Lisbon".
      const side = { north: T('north'), south: T('south'), east: T('east'), west: T('west'), centre: T('centre'), center: T('centre') }[area.toLowerCase()];
      title = (guide.dayTitles && guide.dayTitles[area])
        || (side ? T('Ideas for the {side} of {city}', { side, city: guide.city })
          : /^central$/i.test(area) ? T('Ideas for central {city}', { city: guide.city }) : T('Ideas for a day in {place}', { place: area }));
      ranked = pool.map(p => ({ p, d: miles(center, p) })).sort((x, y) => x.d - y.d);
    } else {
      // A small town, or a country / region's destinations: best known first.
      title = guide.kind === 'destinations' ? T('Places to go in {place}', { place: guide.city }) : T('Ideas for a day in {place}', { place: guide.city });
      ranked = pool.filter(p => !p.local).map(p => ({ p }));
    }

    // Rain likely (weather.js): indoor places nearby come first.
    if (isWetDay(trip, day)) {
      const indoor = ranked.slice(0, 30).filter(r => r.p.tags.includes('rainy'));
      if (indoor.length) {
        ranked = [...indoor, ...ranked.filter(r => !indoor.includes(r))];
        title = T('Rain likely — indoor ideas');
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
  if (!canAutoFill(day, guide)) return { error: T('There’s no guide for this day yet.') };
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
    return { error: minutes > DAY_MINUTES - 60 ?T('This day already looks full.') : T('No more ideas from the guide near this day’s plans.') };
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
  snackbar(Tn(result.added.length, 'Added {n} plan to {day}', 'Added {n} plans to {day}', { day: fmtDay(day, { weekday: 'long' }) }), T('Undo'), () => { result.undo(); redraw(); }, 8000);
}

/* ---------- Consider booking ahead ---------- */

// What a guide says about places that sell out ("sold out weeks in advance", "by reservation only"…).
const BOOK_TEXT = new RegExp([
  'sells? out', 'sold out', 'booked (?:up|out|solid)', '(?:days|weeks|months) (?:in advance|ahead)',
  'book(?:ed|ing|ings)? (?:well|far|long) (?:in advance|ahead)',
  'reserv(?:e|ation|ations) (?:\\w+ ){0,2}(?:required|essential|a must)',
  'by (?:reservation|appointment|prior arrangement) only', 'waiting list',
].join('|'), 'i');

// A line for a plan's card, "Book ahead", only for what is known to sell out: the answer kept from
// Gemini (assistant.js) or, until there is one, the guide saying so. A fee or timed entry isn't enough.
function bookingNote(item, trip, guide) {
  if (item.booked || item.done || (item.date && item.date < todayISO())) return null;
  // A ticket is attached, or it's the hotel or the flight itself (there because it was booked).
  if (filesOf(item.id).length || ['stay', 'transport'].includes(item.category)) return null;
  const known = sellsOut(item, trip);
  if (known) return known.ahead ? { text: known.why ? T('Book ahead: {why}', { why: known.why }) : T('Sells out: book ahead') } : null;
  const p = matchPlaces(item, guide)[0];
  return p && BOOK_TEXT.test([p.about, p.blurb, p.price, p.tip, p.hours].filter(Boolean).join(' ')) ? { text: T('Sells out: book ahead') } : null;
}

onAction('autofill', el => runAutoFill(el.dataset.date));
