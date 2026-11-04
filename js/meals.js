'use strict';

/* meals.js — Where to eat: places for lunch and dinner near each day's plans.
   - From Google Maps, through Gemini's "Grounding with Google Maps". The free tier (no billing) only allows it on
     Gemini 2.5 Flash-Lite. Only the places Google Maps itself returned are kept (each with its Google Maps link),
     never a name the model made up.
   - Asked when a day's "Where to eat" is opened, one day at a time, and kept on this device (in the assistant's
     saved data, never synced). A day is asked again when its plans move more than a mile, or with Refresh.
   - Without it (not set up, offline, the day's allowance used up, no answer), the travel guide's places to eat
     near the day's plans.
   Functions here also use the screen's files (ui.js … app.js), which load after this one. */

const MEALS_MODEL = 'gemini-2.5-flash-lite';
const MEALS_VERSION = 1;        // raise it when the question changes: the answers kept on devices are asked again
const MEALS_KEEP = 40;          // days kept on this device
const MEALS_MOVED = 1;          // miles: the day's plans moved that far, so its places are asked again
const MEALS_NEAR = 1.5;         // miles: the guide's places to eat, around the day's plans

ai.saved.meals = ai.saved.meals || {};
const meals = { asking: new Set(), failed: new Map(), usedUp: '' };     // failed: day key → { kind, at }

const isFood = item => item.category === 'food';
const mealKey = (trip, day) => `${trip.id}|${day}`;

// Where the day is spent: its plans on the map (not the stay), and the stay. null when nothing is on the map.
function mealSpots(trip, day) {
  const guide = guideFor(trip);
  const items = dayItems(trip, day);
  const stops = items.filter(i => i.category !== 'stay').map(item => ({ item, c: coordsOf(item, guide) })).filter(s => s.c);
  const base = baseFor(trip, day, guide);
  const from = stops.length ? stops : base ? [base] : [];
  if (!from.length) return null;
  return { items, stops, base, center: { lat: avg(from.map(s => s.c.lat)), lng: avg(from.map(s => s.c.lng)) } };
}

// The places saved for the day, while they still fit it (same language, plans in the same area).
function savedMeals(trip, day, spots) {
  const had = ai.saved.meals[mealKey(trip, day)];
  return had && had.v === MEALS_VERSION && had.lang === LANG && spots && miles(had, spots.center) < MEALS_MOVED ? had : null;
}

function saveMeals() {
  const all = ai.saved.meals;
  for (const k of Object.keys(all)) if (!state.trips.some(t => k.startsWith(`${t.id}|`))) delete all[k];
  const keys = Object.keys(all);
  if (keys.length > MEALS_KEEP) keys.sort((x, y) => all[x].at - all[y].at).slice(0, keys.length - MEALS_KEEP).forEach((k) => { delete all[k]; });
  saveAI();
}

/* ---------- Asking Google Maps (through Gemini) ---------- */

function mealQuestion(trip, day, spots) {
  const line = i => `${i.time ? `${i.time} ` : ''}${i.title}${i.place && norm(i.place) !== norm(i.title) ? ` (${i.place})` : ''}${isFood(i) ? ' [a meal already planned]' : ''}`;
  const lines = [
    `Find good places to eat for a traveller on ${fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}, in ${placeLabel(trip)}, using Google Maps.`,
    spots.items.filter(i => i.category !== 'stay').length
      ? `The day's plans, in order:\n${spots.items.filter(i => i.category !== 'stay').map((i, k) => `${k + 1}. ${line(i)}`).join('\n')}`
      : 'Nothing is planned yet that day.',
    spots.base ? `Staying at: ${line(spots.base.item)}.` : '',
    'Suggest 3 places for lunch, near the plans around midday, and 3 places for dinner, near the last plans of the day or where they stay.',
    'Skip a meal that is already planned. Each place must be within walking distance of a plan or of where they stay.',
    'Prefer places that are well rated on Google Maps by many people, and open at that time of day. Mix cuisines and prices. No fast-food chains.',
    'Answer only with one line per place, nothing else, in this form:',
    'lunch or dinner|name exactly as on Google Maps|cuisine, 1 to 3 words|price as Google Maps shows it|Google rating like 4.6|street address|the plan it is near, as written above|why go, at most 12 words',
    LANG !== 'en' ? `Write the cuisine and "why go" in ${LANGS[LANG]}. Keep "lunch" and "dinner" in English.` : '',
  ];
  return lines.filter(Boolean).join('\n\n');
}

// "Name" without accents, case or punctuation, to find a place among Google Maps' answers.
const placeWords = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// The answer's lines, kept only for the places Google Maps returned (sources: its grounding chunks).
function parseMeals(text, sources) {
  const found = (Array.isArray(sources) ? sources : []).map(s => s && s.maps)
    .filter(m => m && typeof m.title === 'string' && m.title.trim() && typeof m.uri === 'string' && safeUrl(m.uri));
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const f = raw.replace(/^[\s*•\-\d.)]+/, '').split('|').map(s => s.trim().replace(/^\*+|\*+$/g, '').trim());
    if (f.length < 7) continue;
    const meal = /^lunch\b/i.test(f[0]) ? 'lunch' : /^dinner\b/i.test(f[0]) ? 'dinner' : '';
    const name = placeWords(f[1]);
    if (!meal || name.length < 2) continue;
    const m = found.find(p => placeWords(p.title) === name)
      || found.find((p) => { const t = placeWords(p.title); return Math.min(t.length, name.length) >= 4 && (t.includes(name) || name.includes(t)); });
    if (!m || out.some(o => o.uri === safeUrl(m.uri))) continue;
    const rating = parseFloat(String(f[4]).replace(',', '.'));
    out.push({
      meal,
      name: m.title.trim().slice(0, 80),
      cuisine: f[2].slice(0, 40),
      price: /\d|[$€£¥₩₹]/.test(f[3]) ? f[3].slice(0, 16) : '',
      rating: rating >= 1 && rating <= 5 ? Math.round(rating * 10) / 10 : 0,
      address: f[5].slice(0, 120),
      near: f[6].slice(0, 80),
      why: (f[7] || '').slice(0, 120),
      uri: safeUrl(m.uri),
    });
  }
  // Lunch first, then dinner, as the day goes.
  return [...out.filter(p => p.meal === 'lunch'), ...out.filter(p => p.meal === 'dinner')];
}

// Asks for one day, in the background; the screen is drawn again when the answer is in.
function askMeals(trip, day, spots) {
  const key = mealKey(trip, day);
  const failed = meals.failed.get(key);
  if (!aiReady() || !navigator.onLine || meals.usedUp === todayISO() || meals.asking.has(key)
    || (failed && Date.now() - failed.at < 2 * 60e3)) return;
  meals.asking.add(key);
  const body = {
    contents: [{ role: 'user', parts: [{ text: mealQuestion(trip, day, spots) }] }],
    tools: [{ googleMaps: {} }],
    toolConfig: { retrievalConfig: { latLng: { latitude: spots.center.lat, longitude: spots.center.lng }, languageCode: LANG } },
    generationConfig: { temperature: 0.4 },
  };
  const sources = [];
  callGemini(MEALS_MODEL, body, sources).then((text) => {
    meals.failed.delete(key);
    ai.saved.meals[key] = { v: MEALS_VERSION, lang: LANG, at: Date.now(), lat: spots.center.lat, lng: spots.center.lng, places: parseMeals(text, sources) };
    saveMeals();
  }).catch((e) => {
    console.warn('Where to eat', e);
    if (e.kind === 'daily') meals.usedUp = todayISO();
    else meals.failed.set(key, { kind: e.kind || 'other', at: Date.now() });
  }).finally(() => {
    meals.asking.delete(key);
    renderSoon();
  });
}

// The travel guide's places to eat near the day's plans (or its stay), nearest first.
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
  }).filter(r => r.d < MEALS_NEAR).sort((x, y) => x.d - y.d).slice(0, 6);
}

/* ---------- On screen ---------- */

function mealCard(m, n, day, trip) {
  const added = trip.items.some(i => i.link === m.uri || (isFood(i) && placeWords(i.title) === placeWords(m.name)));
  const facts = [m.cuisine && esc(m.cuisine), m.price && esc(m.price)].filter(Boolean).join(' · ');
  return `
    <article class="s-card meal-card" aria-label="${esc(m.name)}">
      <a class="s-body ripple" href="${esc(m.uri)}" target="_blank" rel="noopener" aria-label="${T('{name} on Google Maps', { name: esc(m.name) })}">
        <span class="s-photo" style="--h:${CATEGORIES.food.hue}">${icon('restaurant-fill')}${m.meal === 'lunch'
          ? `<span class="tag">${icon('wb_sunny')}${T('Lunch')}</span>` : `<span class="tag">${icon('bedtime')}${T('Dinner')}</span>`}</span>
        <span class="s-name">${esc(m.name)}</span>
        ${m.rating || facts ? `<span class="meal-facts">${m.rating ? `<span class="meal-rating">${icon('star-fill')}${fmtNum(m.rating)}</span>` : ''}${m.rating && facts ? ' · ' : ''}${facts}</span>` : ''}
        ${m.near ? `<span class="s-why">${icon('near_me')}<span>${T('Near {place}', { place: esc(m.near) })}</span></span>` : ''}
        ${m.why ? `<span class="s-blurb">${esc(m.why)}</span>` : ''}
        <span class="more-link"><span translate="no">Google Maps</span>${icon('open_in_new')}</span>
      </a>
      <div class="s-foot">
        ${added ? `<span class="tag">${icon('check')}${T('Added')}</span>`
          : `<button type="button" class="btn tonal sm ripple" data-action="add-meal" data-date="${day}" data-n="${n}"
              aria-label="${T('Add {name}', { name: esc(m.name) })}">${icon('add')}${T('Add')}</button>`}
      </div>
    </article>`;
}

// The day's places to eat, with a line on where they come from. Asks Google Maps when they aren't known yet.
function mealsBodyHTML(trip, day) {
  const spots = mealSpots(trip, day);
  if (!spots) return `<p class="meal-note">${icon('location_on', 'sm')}<span>${T('Add plans with an address to this day to see places to eat near them.')}</span></p>`;
  const key = mealKey(trip, day);
  const had = savedMeals(trip, day, spots);
  if (!had) askMeals(trip, day, spots);
  const asking = meals.asking.has(key);
  const failed = meals.failed.get(key);
  const google = had && had.places.length ? had.places : null;
  const fromGuide = google || asking ? [] : guideMeals(trip, spots);
  // Why Google Maps has nothing to show (yet).
  let status = '';
  if (asking) {
    status = `<p class="guide-note" role="status">${icon('restaurant')}<span>${T('Looking for places to eat on {source}…', { source: '<span translate="no">Google Maps</span>' })}</span></p>`;
  } else if (google || !aiReady()) {
    status = '';
  } else if (had) {
    status = `<p class="meal-note">${icon('info', 'sm')}<span>${T('Google Maps found no places to eat near these plans.')}</span></p>`;
  } else if (!navigator.onLine) {
    status = `<p class="meal-note">${icon('cloud_off', 'sm')}<span>${T('Places to eat from Google Maps need a connection.')}</span></p>`;
  } else if (meals.usedUp === todayISO()) {
    status = `<p class="meal-note">${icon('info', 'sm')}<span>${T('Today’s searches on Google Maps are used up. Try again tomorrow.')}</span></p>`;
  } else if (failed) {
    status = `<p class="meal-note">${icon('error', 'sm')}<span>${T('Couldn’t reach Google Maps.')}</span>
      <button type="button" class="btn text ripple" data-action="meals-refresh" data-date="${day}">${T('Try again')}</button></p>`;
  }
  const cards = google ? google.map((m, n) => mealCard(m, n, day, trip)) : fromGuide.map(r => suggestionCard(r, day));
  const source = google
    ? `<p class="footnote"><span>${T('Places, ratings and prices from {source}.', { source: '<span translate="no">Google Maps</span>' })}</span></p>`
    : fromGuide.length ? `<p class="footnote">${T('Places to eat from the travel guide.')}</p>` : '';
  return `
    ${status}
    ${cards.length ? `<div class="suggest-row">${cards.join('')}</div>${source}` : ''}
    ${!cards.length && !status && !asking ? `<p class="meal-note">${icon('info', 'sm')}<span>${T('No places to eat found near these plans.')}</span></p>` : ''}`;
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
  return savedMeals(trip, day, spots) && aiReady() && !meals.asking.has(mealKey(trip, day))
    ? `<button type="button" class="icon-btn ripple" data-action="meals-refresh" data-date="${day}" aria-label="${T('Look again on Google Maps')}" title="${T('Look again on Google Maps')}">${icon('refresh')}</button>` : '';
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
// A place from Google Maps, added to its day: at lunch or dinner time, with its address and its Google Maps link.
onAction('add-meal', (el) => {
  const trip = activeTrip();
  const day = el.dataset.date;
  const had = savedMeals(trip, day, mealSpots(trip, day));
  const m = had && had.places[+el.dataset.n];
  if (!m) return;
  const item = {
    id: uid(), title: m.name, category: 'food', date: day, time: m.meal === 'lunch' ? '12:30' : '19:30',
    place: m.address || m.name, link: m.uri, notes: [m.cuisine, m.price].filter(Boolean).join(' · '), done: false,
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
