'use strict';

/* form-plan.js — the sheet to add or edit a plan. */

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
  if (category === 'transport') return { title: T('e.g. Train to the airport'), place: city ? T('e.g. the main station in {city}', { city }) : T('e.g. the main station') };
  if (category === 'stay') return { title: T('e.g. Hotel check-in'), place: T('The address of your hotel or apartment') };
  const guide = trip && guideFor(trip);
  const taken = guide ? new Set(trip.items.flatMap(i => matchPlaces(i, guide).map(p => p.id))) : new Set();
  const pool = guide ? guide.places.filter(p => !taken.has(p.id)) : [];
  const p = pool.find(x => x.cat === category) || (category === 'other' ? pool[0] : null);
  if (!p) {
    const generic = { sight: T('e.g. Visit the old town'), food: T('e.g. Dinner out'), event: T('e.g. Concert or show'), shopping: T('e.g. Browse the market'), other: T('e.g. Meet friends') };
    return { title: generic[category] || generic.sight, place: city ? T('A place name or an address in {city}', { city }) : T('A place name or an address') };
  }
  const name = { name: p.name };
  const title = guide.kind === 'destinations' ? T('e.g. Day trip to {name}', name)
    : category === 'sight' ? T('e.g. Visit {name}', name) : category === 'food' ? T('e.g. Eat at {name}', name)
    : category === 'shopping' ? T('e.g. Shopping at {name}', name) : T('e.g. {name}', name);
  return { title, place: T('e.g. {name}', { name: p.place || p.name }) };
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
const planMatch = { chosen: null, results: [], field: '', timer: 0, ctl: null, typeSet: false, press: false, late: false };
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

// Where to look first: around the plan being edited, else the stay of its day (a trip can cover
// several cities), else the trip's first plan on the map, its city, or its guide.
function matchCenter(trip, guide, item, day) {
  const spot = p => p && typeof p.lat === 'number' && typeof p.lng === 'number' ? p : null;
  const base = isDate(day) ? baseFor(trip, day, guide) : null;
  return spot(item) || (base && base.c) || (isDate(day) && trip.items.find(i => i.date === day && spot(i)))
    || trip.items.find(spot) || spot(trip.place) || (guide && guide.places[0]) || null;
}

async function findMatches(trip, q, signal, by) {
  const guide = guideFor(trip);
  const fromGuide = guide ? guide.places.filter(p => norm(p.name).includes(norm(q))).slice(0, 3).map(p => ({
    name: p.name, place: p.place || p.name, sub: p.area || guide.city || '', cat: p.cat, lat: p.lat, lng: p.lng, guideId: p.id,
  })) : [];
  if (!navigator.onLine) return fromGuide;
  const params = new URLSearchParams({ q, limit: '8', lang: LANG === 'fr' ? 'fr' : 'en' });
  // Results close to the plan come first.
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
      const editing = editingItemId && trip.items.find(i => i.id === editingItemId);
      const by = matchCenter(trip, guideFor(trip), editing, itemForm.elements.date.value);
      showMatches(field, await findMatches(trip, q, ctl.signal, by));
    } catch (err) {
      if (err.name !== 'AbortError') showMatches(field, []);
    }
  }, 300);
}
itemForm.elements.title.addEventListener('input', onMatchInput);
itemForm.elements.place.addEventListener('input', onMatchInput);

// The plan's name after a place is picked under it. The place's own name, when what was typed is a part
// of it ("brattle" → "Brattle Book Shop") or is that name followed by where it is ("Trader Joe's in Long
// Island City, 22-43 Jackson Avenue" → "Trader Joe's"). Anything else stays as typed ("Dinner at Carbone").
function titleAfterPick(typed, m) {
  const text = norm(typed.trim()), name = norm(m.name);
  if (name.includes(text)) return m.name;
  if (!text.startsWith(name)) return typed;
  const rest = text.slice(name.length);
  if (/^\s*([,(–-]|(in|near|on)\s)/.test(rest)) return m.name;
  const known = new Set(plainWords(`${m.place} ${m.sub}`));
  const words = plainWords(rest);
  return /^\s/.test(rest) && words.length && words.every(w => known.has(w)) ? m.name : typed;
}

itemForm.addEventListener('click', (e) => {
  const opt = e.target.closest('[data-match-index]');
  if (!opt) return;
  const m = planMatch.results[Number(opt.dataset.matchIndex)];
  const f = itemForm.elements;
  if (planMatch.field === 'title') f.title.value = titleAfterPick(f.title.value, m).slice(0, 120);
  f.place.value = m.place;
  if (m.cat && !editingItemId && !planMatch.typeSet) { f.category.value = m.cat; setPlanExamples(); showStayFields(); }
  planMatch.chosen = m;
  showMatches('', []);
});

function closeMatches() {
  clearTimeout(planMatch.timer);
  if (planMatch.ctl) planMatch.ctl.abort();
  showMatches('', []);
}

// Moving on to another field puts the list away. In the middle of a click or a tap, only once it is
// over: without the list the form gets shorter, and a button that moves away from under the pointer
// (Save, in the form's window on a computer) never gets its click.
itemForm.addEventListener('focusin', (e) => {
  if (!planMatch.field || e.target.name === planMatch.field || e.target.closest('[data-match]')) return;
  if (planMatch.press) planMatch.late = true;
  else closeMatches();
});
itemDialog.addEventListener('mousedown', () => { planMatch.press = true; }, true);
addEventListener('mouseup', () => {
  if (planMatch.late) setTimeout(closeMatches);   // after the click, which comes right behind
  planMatch.press = planMatch.late = false;
}, true);

function openItemForm(item, defaults = {}) {
  planMatch.chosen = null;
  planMatch.typeSet = false;
  planMatch.press = planMatch.late = false;
  showMatches('', []);
  editingItemId = item ? item.id : null;
  const v = item || { title: '', category: 'sight', date: '', time: '', place: '', link: '', notes: '', ...defaults };
  $('#item-dialog-title').textContent = item ? T('Edit plan') : (v.date ? T('New plan') : T('New idea'));
  for (const f of ['title', 'category', 'date', 'time', 'place', 'link', 'notes', 'until']) {
    itemForm.elements[f].value = v[f] || '';
  }
  showStayFields();
  itemForm.elements.booked.checked = v.booked === true;
  $('#item-delete').hidden = !item;
  showTimeClear();
  setPlanExamples();
  openFilesInForm(item ? item.id : null);   // files.js: tickets & bookings
  itemDialog.showModal();
  itemDialog.scrollTop = 0;
  draftStart(itemDialog);
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

// A stay has a check-in day and, if you like, a check-out day (after it).
function showStayFields() {
  const f = itemForm.elements;
  const stay = f.category.value === 'stay';
  $('#item-until').hidden = !stay;
  f.until.disabled = !stay;        // a field that isn't shown must not stop the form from saving
  $('#item-day-label').textContent = stay ? T('Check-in day') : T('Day');
  const first = isDate(f.date.value) ? parseDate(f.date.value) : null;
  if (first) first.setDate(first.getDate() + 1);
  f.until.min = first ? toISO(first) : '';
}
itemForm.elements.date.addEventListener('change', showStayFields);

// Another type of plan: other examples.
$('#item-category').addEventListener('change', () => { planMatch.typeSet = true; setPlanExamples(); showStayFields(); });

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
  const until = data.category === 'stay' && isDate(f.until.value) ? f.until.value : '';
  if (until) data.until = until;
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
    if (!until) delete found.item.until;
    Object.assign(found.item, data, spot);
  } else {
    trip.items.push({ id: uid(), done: false, ...data, ...spot });
  }
  saveFormFiles(editingItemId || trip.items[trip.items.length - 1].id);
  save();
  itemDialog.close();
  render();
  snackbar(data.date ? T('Saved to {day}', { day: fmtDay(data.date, { weekday: 'long', month: 'short', day: 'numeric' }) }) : T('Saved to Ideas'));
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
  snackbar(T('Plan deleted'), T('Undo'), () => {
    trip.items.splice(index, 0, item);
    save();
    render();
  });
});
