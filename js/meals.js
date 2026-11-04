'use strict';

/* meals.js — Where to eat: places for lunch and dinner near each day's plans.
   - The places: OpenStreetMap's restaurants, cafés and pubs within a short walk of the day's plans (Photon's
     reverse search, no key), plus the travel guide's places to eat there.
   - The choice: Gemini (the free Flash-Lite) picks 3 for lunch and 3 for dinner from that list, by what it knows
     of them, and says the cuisine and why. It can only pick from the list, so it can't make a place up.
     Without it (not set up, no answer), the nearest ones, the guide's first.
   - Each place opens Google Maps, for its reviews and photos. (Google Maps' own data needs a billing account:
     Gemini's free tier can't look things up there, tested live on 2026-11-04.)
   - Asked when a day's "Where to eat" is opened, one day at a time, and kept on this device (in the assistant's
     saved data, never synced). A day is asked again when its plans move more than a mile, or with Refresh.
   Functions here also use the screen's files (ui.js … app.js), which load after this one. */

const MEALS_VERSION = 2;        // raise it when the choice changes: the answers kept on devices are asked again
const MEALS_KEEP = 40;          // days kept on this device
const MEALS_MOVED = 1;          // miles: the day's plans moved that far, so its places are asked again
const MEALS_WALK = 0.5;         // miles (10 minutes on foot): how far a place to eat can be from a plan
const MEALS_SEARCH = 0.7;       // km around each spot, for OpenStreetMap
const MEAL_KINDS = ['restaurant', 'cafe', 'pub'];

ai.saved.meals = ai.saved.meals || {};
const meals = { asking: new Set(), failed: new Map(), noAI: '' };     // failed: day key → time; noAI: a day Gemini is used up

const isFood = item => item.category === 'food';
const mealKey = (trip, day) => `${trip.id}|${day}`;

// Where the day is spent. Lunch: near the plans between 11:00 and 15:00, else the middle of the day. Dinner: near the
// last plan, and the stay. The stay is not a plan here. null when nothing is on the map.
function mealSpots(trip, day) {
  const guide = guideFor(trip);
  const items = dayItems(trip, day);
  const stops = items.filter(i => i.category !== 'stay').map(item => ({ item, c: coordsOf(item, guide) })).filter(s => s.c);
  const base = baseFor(trip, day, guide);
  if (!stops.length && !base) return null;
  let lunch = stops.filter(s => s.item.time >= '11:00' && s.item.time < '15:00').slice(0, 2);
  if (!lunch.length) lunch = stops.length ? [stops[Math.floor((stops.length - 1) / 2)]] : [base];
  const dinner = [stops[stops.length - 1], base].filter(Boolean);
  const from = stops.length ? stops : [base];
  return { items, stops, base, lunch, dinner, center: { lat: avg(from.map(s => s.c.lat)), lng: avg(from.map(s => s.c.lng)) } };
}

// The places kept for the day, while they still fit it (same language, plans in the same area). A choice made
// without Gemini is made again after an hour, when Gemini may answer.
function savedMeals(trip, day, spots) {
  const had = ai.saved.meals[mealKey(trip, day)];
  if (!had || had.v !== MEALS_VERSION || had.lang !== LANG || !spots || miles(had, spots.center) >= MEALS_MOVED) return null;
  if (!had.ai && aiReady() && navigator.onLine && meals.noAI !== todayISO() && Date.now() - had.at > 3600e3) return null;
  return had;
}

function saveMeals() {
  const all = ai.saved.meals;
  for (const k of Object.keys(all)) if (!state.trips.some(t => k.startsWith(`${t.id}|`))) delete all[k];
  const keys = Object.keys(all);
  if (keys.length > MEALS_KEEP) keys.sort((x, y) => all[x].at - all[y].at).slice(0, keys.length - MEALS_KEEP).forEach((k) => { delete all[k]; });
  saveAI();
}

/* ---------- The places near the plans ---------- */

// "Name" without accents, case or punctuation: one place found twice (OpenStreetMap and the guide) is one.
const placeWords = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// OpenStreetMap's places to eat around each spot of the day (a few requests, one after the other).
async function osmMeals(spots) {
  const at = [];
  for (const s of [...spots.lunch, ...spots.dinner]) if (!at.some(a => miles(a.c, s.c) < 0.2)) at.push(s);
  const out = [];
  for (const s of at.slice(0, 4)) {
    const data = await getJSON('https://photon.komoot.io/reverse', [['lat', s.c.lat], ['lon', s.c.lng], ['radius', MEALS_SEARCH],
      ['limit', 40], ['lang', LANG], ...MEAL_KINDS.map(k => ['osm_tag', `amenity:${k}`])]);
    for (const f of (data && data.features) || []) {
      const p = f.properties || {};
      const g = f.geometry && f.geometry.coordinates;
      if (typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(g) || typeof g[0] !== 'number' || typeof g[1] !== 'number') continue;
      out.push({
        name: p.name.trim().slice(0, 80), kind: MEAL_KINDS.includes(p.osm_value) ? p.osm_value : 'restaurant', lat: g[1], lng: g[0],
        address: [[p.housenumber, p.street].filter(Boolean).join(' '), p.city || p.district].filter(Boolean).join(', ').slice(0, 120),
      });
    }
  }
  return out;
}

// One list from OpenStreetMap's places and the guide's, each with how far it is from lunch and from dinner,
// within a short walk, nearest first (40 at most).
function mealCandidates(osm, guide, spots) {
  const all = new Map();
  const guided = guide ? guide.places.filter(p => p.cat === 'food' && typeof p.lat === 'number' && (!guide.joined || p.local)) : [];
  for (const p of guided) all.set(placeWords(p.name), { name: p.name, kind: 'restaurant', lat: p.lat, lng: p.lng, address: p.place && p.place !== p.name ? p.place : '', guideId: p.id, blurb: p.blurb || '' });
  for (const p of osm) {
    const k = placeWords(p.name);
    if (!k) continue;
    const had = all.get(k);
    if (!had) all.set(k, p);
    else if (!had.address) had.address = p.address;
  }
  const nearest = (p, from) => from.reduce((best, s) => { const d = miles(s.c, p); return !best || d < best.d ? { d, s } : best; }, null);
  return [...all.values()].map((p) => {
    const l = nearest(p, spots.lunch), n = nearest(p, spots.dinner);
    return { ...p, lunch: { d: l.d, near: l.s.item.title }, dinner: { d: n.d, near: n.s.item.title } };
  }).filter(p => Math.min(p.lunch.d, p.dinner.d) < MEALS_WALK)
    .sort((a, b) => Math.min(a.lunch.d, a.dinner.d) - Math.min(b.lunch.d, b.dinner.d)).slice(0, 40);
}

// A place picked for a meal, as kept on the device.
const mealPlace = (p, meal, extra = {}) => ({
  meal, name: p.name, kind: p.kind, lat: p.lat, lng: p.lng, address: p.address || '', near: p[meal].near, d: p[meal].d,
  ...(p.guideId && { guideId: p.guideId }), cuisine: '', price: '', why: '', ...extra,
});

// Without Gemini: the nearest ones, the guide's first (it chose them). No café for dinner.
function nearestMeals(cands) {
  const pick = (meal, skip) => cands.filter(p => !skip.has(p) && p[meal].d < MEALS_WALK && (meal === 'lunch' || p.kind !== 'cafe'))
    .sort((a, b) => (a[meal].d - (a.guideId ? 0.15 : 0)) - (b[meal].d - (b.guideId ? 0.15 : 0))).slice(0, 3);
  const lunch = pick('lunch', new Set());
  const dinner = pick('dinner', new Set(lunch));
  return [...lunch.map(p => mealPlace(p, 'lunch')), ...dinner.map(p => mealPlace(p, 'dinner'))];
}

/* ---------- Gemini's choice ---------- */

const MEALS_RULES = `You help a traveller choose where to eat. You get the day's plans and a numbered list of real places to
eat near them. Pick up to 3 for lunch, near the plans around midday, and up to 3 for dinner, near the last plans of the
day or where they stay. Prefer places you know to be good and well reviewed, that locals like, or that are famous for
something; avoid chains, fast food and places you know nothing good about. A café is fine for lunch, not for dinner.
Mix cuisines and prices. Use only numbers from the list, each place at most once.
For each place: "cuisine" in 1 to 3 words, "price" from "$" to "$$$$" ("" when you don't know), and "why" to go, at
most 12 words, about the place itself (a dish, the setting, what it's known for).${LANG !== 'en' ? ` Write "cuisine" and "why" in ${LANGS[LANG]}.` : ''}`;

function mealAsk(trip, day, spots, cands) {
  const line = i => `${i.time ? `${i.time} ` : ''}${i.title}`;
  const plans = spots.items.filter(i => i.category !== 'stay');
  return [
    `${fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}, in ${placeLabel(trip)}.`,
    plans.length ? `The day's plans, in order:\n${plans.map(i => `- ${line(i)}`).join('\n')}` : 'Nothing is planned yet that day.',
    spots.base ? `Staying at: ${spots.base.item.title}.` : '',
    `Places to eat:\n${cands.map((p, k) => `${k + 1}. ${p.name} (${p.kind}${p.address ? `, ${p.address}` : ''}) — ${Math.round(p.lunch.d * 1609)} m from ${p.lunch.near}${p.dinner.near !== p.lunch.near ? `, ${Math.round(p.dinner.d * 1609)} m from ${p.dinner.near}` : ''}${p.guideId ? ' — in the travel guide' : ''}`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}

// Gemini's answer → the places, only from the list, each once.
function readMealPicks(answer, cands) {
  const used = new Set();
  const out = [];
  for (const meal of ['lunch', 'dinner']) {
    const list = answer && Array.isArray(answer[meal]) ? answer[meal] : [];
    let n = 0;
    for (const a of list) {
      const p = a && Number.isInteger(a.number) ? cands[a.number - 1] : null;
      if (!p || used.has(p) || n === 3 || (meal === 'dinner' && p.kind === 'cafe')) continue;
      used.add(p);
      n++;
      out.push(mealPlace(p, meal, { cuisine: aiText(a.cuisine, 40), price: /^\${1,4}$/.test(a.price) ? a.price : '', why: aiText(a.why, 120) }));
    }
  }
  return out;
}

async function pickMeals(trip, day, spots, cands) {
  const pick = { type: 'array', items: { type: 'object',
    properties: { number: { type: 'integer' }, cuisine: { type: 'string' }, price: { type: 'string' }, why: { type: 'string' } },
    required: ['number', 'cuisine', 'price', 'why'] } };
  const body = {
    systemInstruction: { parts: [{ text: MEALS_RULES }] },
    contents: [{ role: 'user', parts: [{ text: mealAsk(trip, day, spots, cands) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'object', properties: { lunch: pick, dinner: pick }, required: ['lunch', 'dinner'] }, temperature: 0.3 },
  };
  return readMealPicks(JSON.parse(await callGemini(AI_MODELS[1].id, body)), cands);
}

// Finds the day's places, in the background; the screen is drawn again when they are in.
function askMeals(trip, day, spots) {
  const key = mealKey(trip, day);
  const failed = meals.failed.get(key);
  if (!navigator.onLine || meals.asking.has(key) || (failed && Date.now() - failed < 2 * 60e3)) return;
  meals.asking.add(key);
  (async () => {
    let osm = [];
    try { osm = await osmMeals(spots); } catch (e) { console.warn('Where to eat: OpenStreetMap', e); }
    const cands = mealCandidates(osm, guideFor(trip), spots);
    if (!osm.length && !cands.length) throw new Error('nothing found, or no answer');
    let places = [];
    let picked = false;
    if (cands.length > 1 && aiReady() && meals.noAI !== todayISO()) {
      try {
        places = await pickMeals(trip, day, spots, cands);
        picked = places.length > 0;
      } catch (e) {
        console.warn('Where to eat: Gemini', e);
        if (e.kind === 'daily') meals.noAI = todayISO();
      }
    }
    if (!picked) places = nearestMeals(cands);
    ai.saved.meals[key] = { v: MEALS_VERSION, lang: LANG, at: Date.now(), lat: spots.center.lat, lng: spots.center.lng, places, ai: picked };
    meals.failed.delete(key);
    saveMeals();
  })().catch((e) => {
    console.warn('Where to eat', e);
    meals.failed.set(key, Date.now());
  }).finally(() => {
    meals.asking.delete(key);
    renderSoon();
  });
}

// Offline, before anything was found: the travel guide's places to eat near the day's plans, nearest first.
function guideMeals(trip, spots) {
  const guide = guideFor(trip);
  if (!guide || !spots) return [];
  const taken = new Set(trip.items.flatMap(i => matchPlaces(i, guide).map(p => p.id)));
  const from = spots.stops.length ? spots.stops : [spots.base];
  return guide.places.filter(p => p.cat === 'food' && !taken.has(p.id) && (!guide.joined || p.local)).map((p) => {
    let best = null;
    for (const a of from) {
      const d = miles(a.c, p);
      if (!best || d < best.d) best = { p, d, from: a.item };
    }
    return best;
  }).filter(r => r.d < MEALS_WALK * 3).sort((x, y) => x.d - y.d).slice(0, 6);
}

/* ---------- On screen ---------- */

const KIND_NAMES = { restaurant: T('Restaurant'), cafe: T('Café'), pub: T('Pub') };
// Google Maps, searched by the place's name and address: it opens on the place, with its reviews and photos.
const reviewsUrl = (m, trip) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([m.name, m.address || placeLabel(trip)].join(', '));

function mealCard(m, n, day, trip) {
  const added = trip.items.some(i => isFood(i) && placeWords(i.title) === placeWords(m.name));
  const facts = [m.cuisine || KIND_NAMES[m.kind], m.price].filter(Boolean).map(esc).join(' · ');
  const guide = m.guideId && guideFor(trip);
  const gp = guide && guide.places.find(p => p.id === m.guideId);
  const why = m.why || (gp && gp.blurb ? tr(gp.blurb) : '');
  return `
    <article class="s-card meal-card" aria-label="${esc(m.name)}">
      <a class="s-body ripple" href="${esc(reviewsUrl(m, trip))}" target="_blank" rel="noopener" aria-label="${T('{name}: reviews on Google Maps', { name: esc(m.name) })}">
        <span class="s-photo" style="--h:${CATEGORIES.food.hue}">${icon('restaurant-fill')}${gp && gp.photo ? photoImg(gp, '') : ''}${m.meal === 'lunch'
          ? `<span class="tag">${icon('wb_sunny')}${T('Lunch')}</span>` : `<span class="tag">${icon('bedtime')}${T('Dinner')}</span>`}</span>
        <span class="s-name">${esc(m.name)}</span>
        <span class="meal-facts">${facts}</span>
        ${m.near ? `<span class="s-why">${icon('near_me')}<span>${T('{way} from {place}', { way: esc(travel(m.d, modeFor(trip, day)).text), place: esc(m.near) })}</span></span>` : ''}
        ${why ? `<span class="s-blurb">${esc(why)}</span>` : ''}
        <span class="more-link">${T('Reviews on Google Maps')}${icon('open_in_new')}</span>
      </a>
      <div class="s-foot">
        ${gp ? `<span class="tag">${icon('travel_explore')}${T('In the guide')}</span>` : ''}
        ${added ? `<span class="tag">${icon('check')}${T('Added')}</span>`
          : `<button type="button" class="btn tonal sm ripple" data-action="add-meal" data-date="${day}" data-n="${n}"
              aria-label="${T('Add {name}', { name: esc(m.name) })}">${icon('add')}${T('Add')}</button>`}
      </div>
    </article>`;
}

// The day's places to eat, with a line on where they come from. Looks for them when they aren't known yet.
function mealsBodyHTML(trip, day) {
  const spots = mealSpots(trip, day);
  if (!spots) return `<p class="meal-note">${icon('location_on', 'sm')}<span>${T('Add plans with an address to this day to see places to eat near them.')}</span></p>`;
  const key = mealKey(trip, day);
  const had = savedMeals(trip, day, spots);
  if (!had) askMeals(trip, day, spots);
  const asking = meals.asking.has(key) && !had;
  const fromGuide = had || asking ? [] : guideMeals(trip, spots);
  let status = '';
  if (asking) {
    status = `<p class="guide-note" role="status">${icon('restaurant')}<span>${T('Looking for places to eat…')}</span></p>`;
  } else if (!had && !navigator.onLine) {
    status = `<p class="meal-note">${icon('cloud_off', 'sm')}<span>${T('Places to eat near your plans need a connection.')}</span></p>`;
  } else if (!had && meals.failed.has(key)) {
    status = `<p class="meal-note">${icon('error', 'sm')}<span>${T('Couldn’t look for places to eat.')}</span>
      <button type="button" class="btn text ripple" data-action="meals-refresh" data-date="${day}">${T('Try again')}</button></p>`;
  }
  const list = had ? had.places : [];
  const cards = had ? list.map((m, n) => mealCard(m, n, day, trip)) : fromGuide.map(r => suggestionCard(r, day));
  const source = had
    ? `<p class="footnote"><span>${had.ai ? T('Places from OpenStreetMap, picked by Gemini. Tap one for its reviews on Google Maps.')
      : T('Places from OpenStreetMap, nearest first. Tap one for its reviews on Google Maps.')}</span></p>`
    : fromGuide.length ? `<p class="footnote">${T('Places to eat from the travel guide.')}</p>` : '';
  return `
    ${status}
    ${cards.length ? `<div class="suggest-row">${cards.join('')}</div>${source}` : ''}
    ${!cards.length && !status ? `<p class="meal-note">${icon('info', 'sm')}<span>${T('No places to eat found near these plans.')}</span></p>` : ''}`;
}

// Under a day of the Plan: one line to open, then the places.
function mealsHTML(trip, day) {
  const open = !!ui.meals[day];
  if (!open) {
    return `
      <button type="button" class="suggest-toggle ripple" data-action="toggle-meals" data-date="${day}" aria-expanded="false">
        ${icon('restaurant')}<span>${T('Where to eat')}</span><small>${T('Lunch and dinner')}</small>${icon('arrow_forward', 'sm turn')}
      </button>`;
  }
  return `
    <div class="suggest meals">
      <div class="suggest-head">
        <button type="button" class="suggest-title ripple" data-action="toggle-meals" data-date="${day}" aria-expanded="true">${icon('restaurant')}${T('Where to eat')}</button>
        ${refreshMealsHTML(trip, day)}
      </div>
      ${mealsBodyHTML(trip, day)}
    </div>`;
}

function refreshMealsHTML(trip, day) {
  const spots = mealSpots(trip, day);
  return savedMeals(trip, day, spots) && navigator.onLine && !meals.asking.has(mealKey(trip, day))
    ? `<button type="button" class="icon-btn ripple" data-action="meals-refresh" data-date="${day}" aria-label="${T('Look again')}" title="${T('Look again')}">${icon('refresh')}</button>` : '';
}

// The Food section of Ideas: the places to eat saved as ideas, then the places near a day's plans.
function foodIdeasHTML(trip, food) {
  const days = tripDays(trip).filter(d => mealSpots(trip, d));
  const today = todayISO();
  const upcoming = days.filter(d => d >= today);
  const list = upcoming.length ? upcoming : days;
  const day = list.includes(ui.mealDay) ? ui.mealDay : list[0];
  const saved = food.length
    ? `<ul class="group plans">${food.map(it => itemHTML(it, trip, { schedule: true, photo: planPhoto(it, guideFor(trip)) })).join('')}</ul>` : '';
  if (!day) {
    return `
      <p class="supporting">${T('Places to eat you want to try. Save one with “New idea”.')}</p>
      ${saved || emptyState('restaurant', T('No places to eat yet'), T('Add plans with an address to your days, and you’ll see places for lunch and dinner near them here.'))}`;
  }
  return `
    <p class="supporting">${T('Places to eat you want to try, and ideas for lunch and dinner near each day’s plans.')}</p>
    ${saved}
    <div class="suggest-head food-head">
      <h2 class="group-label">${T('Near your plans')}</h2>
      ${refreshMealsHTML(trip, day)}
    </div>
    <div class="filter-row" role="group" aria-label="${T('Pick a day')}">
      ${list.map(d => `<button type="button" class="filter-chip ripple" data-action="meal-day" data-date="${d}" aria-pressed="${d === day}">${esc(fmtDay(d, { weekday: 'short', day: 'numeric' }))}</button>`).join('')}
    </div>
    ${mealsBodyHTML(trip, day)}`;
}

/* ---------- Taps ---------- */

onAction('toggle-meals', (el) => {
  ui.meals[el.dataset.date] = el.getAttribute('aria-expanded') !== 'true';
  render();
});
onAction('meal-day', (el) => {
  ui.mealDay = el.dataset.date;
  render();
});
onAction('meals-refresh', (el) => {
  const trip = activeTrip();
  const key = mealKey(trip, el.dataset.date);
  delete ai.saved.meals[key];
  meals.failed.delete(key);
  saveMeals();
  render();
});
// A place to eat, added to its day: at lunch or dinner time, on the map where OpenStreetMap has it.
onAction('add-meal', (el) => {
  const trip = activeTrip();
  const day = el.dataset.date;
  const had = ai.saved.meals[mealKey(trip, day)];
  const m = had && had.places[+el.dataset.n];
  if (!m) return;
  const item = {
    id: uid(), title: m.name, category: 'food', date: day, time: m.meal === 'lunch' ? '12:30' : '19:30',
    place: m.address || m.name, link: '', notes: [m.cuisine, m.price].filter(Boolean).join(' · '), done: false,
    lat: m.lat, lng: m.lng, ...(m.guideId && { guideId: m.guideId }),
  };
  trip.items.push(item);
  save();
  render();
  if (navigator.vibrate) navigator.vibrate(12);
  snackbar(T('Added to {day}', { day: fmtDay(day, { weekday: 'long' }) }), T('Undo'), () => {
    trip.items = trip.items.filter(i => i !== item);
    save();
    render();
  });
});
