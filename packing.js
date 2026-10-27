'use strict';

/* =========================================================
   Smart packing list: suggestions for the Checklist, from the trip's
   forecast, its plans, how it gets around, and its Essentials (plugs).
   Each one can be added with a tap, or hidden (remembered on this phone).
   Functions here use helpers from app.js, which is loaded after this file.
   ========================================================= */

const PACKING_KEY = 'tripPlanner.packing';
const packingHidden = (() => { try { return JSON.parse(localStorage.getItem(PACKING_KEY)) || {}; } catch { return {}; } })();

// Each idea: when it applies to the trip, the words that mean it's already on the list, and why it's suggested.
function packingIdeas(trip) {
  const days = tripDays(trip);
  const weather = days.map(d => dayWeather(trip, d)).filter(Boolean);
  const wet = weather.filter(rainLikely);
  const hiC = weather.length ? Math.max(...weather.map(w => w.hi)) : null;
  const loC = weather.length ? Math.min(...weather.map(w => w.lo)) : null;
  const plans = trip.items;
  const text = plans.map(i => norm(`${i.title} ${i.place} ${i.notes}`)).join(' | ');
  const e = trip.place && essentials.saved[placeKey(trip.place)];
  const facts = (e && e.facts) || {};
  const guide = guideFor(trip);
  const out = [];
  const add = (key, item, match, why) => out.push({ key, text: item, match, why });

  if (wet.length) add('rain', T('Umbrella or rain jacket'), /umbrella|\brain|parapluie|imperm/, Tn(wet.length, 'Rain likely on {n} day', 'Rain likely on {n} days'));
  if (hiC !== null && hiC >= 27) {
    add('sun', T('Sunscreen and sunglasses'), /sunscreen|sun ?cream|sunglasses|solaire|lunettes de soleil/, T('Up to {temp}', { temp: temp(hiC) }));
    add('water', T('Refillable water bottle'), /water bottle|bottle|gourde|bouteille/, T('Up to {temp}', { temp: temp(hiC) }));
  }
  if (loC !== null && loC <= 5) add('cold', T('Warm coat, hat and gloves'), /coat|gloves|\bhat\b|scarf|manteau|gants|bonnet|[ée]charpe/, T('Down to {temp}', { temp: temp(loC) }));
  else if (loC !== null && loC <= 14) add('layers', T('A warm layer for the evenings'), /jacket|sweater|layer|fleece|hoodie|veste|\bpull|polaire|sweat/, T('Evenings down to {temp}', { temp: temp(loC) }));
  if (weather.some(w => w.icon === 'weather_snowy')) add('snow', T('Waterproof shoes'), /boots|waterproof shoes|bottes|chaussures imperm/, T('Snow in the forecast'));

  // Lots of stops on a day means a lot of walking.
  const busy = days.filter(d => dayItems(trip, d).length >= 4).length;
  if (busy) add('shoes', T('Comfortable walking shoes'), /shoes|sneakers|trainers|chaussures|baskets/, Tn(busy, '{n} busy day on foot', '{n} busy days on foot'));

  if (/flight|airport|airline|boarding|\bfly\b|\bvol\b|a[ée]roport|embarquement/.test(text)) {
    add('id', T('Passport or ID'), /passport|\bid\b|identity|passeport|identit/, T('You’re flying'));
    add('boarding', T('Boarding passes (or the airline app)'), /boarding|embarquement/, T('You’re flying'));
  }
  if (trip.travel === 'drive' || Object.values(trip.dayTravel || {}).includes('drive') || /car rental|rental car|hire car|location de voiture|voiture de location/.test(text)) {
    add('licence', T('Driving licence'), /licen[cs]e|permit|permis/, facts.driving ? T('Driving (on the {side})', { side: facts.driving }) : T('Driving'));
  }
  if (plans.some(i => i.category === 'stay')) add('hotel', T('Hotel booking details'), /h[oô]tel|booking|r[ée]servation|airbnb/, T('You have a place to stay planned'));
  if (plans.some(i => i.category === 'event')) add('tickets', T('Tickets for shows and events'), /ticket|billet/, T('Shows or events planned'));
  // Whole words: "Liverpool" is not a pool, the Strand Book Store not a beach, the city of Bath not a bath.
  const beachy = /\bbeach|\bpraia\b|\bplage\b|\bplaya\b|\bspiaggia\b|\bstrandbad|\bswim|\bpools?\b|\bpiscina\b|\bpiscines?\b|\bbaignade|\bthermal|\bspa\b|\b(?:public|turkish|roman|hot) baths?\b|\bbathhouse|\bhammam|\bonsen\b/;
  if (beachy.test(text) || (guide && plans.some(i => matchPlaces(i, guide).some(p => beachy.test(norm(p.name)))))) {
    add('swim', T('Swimsuit and towel'), /swim|bathing|towel|maillot|serviette/, T('A beach or pool is planned'));
  }
  if (facts.plugs && facts.plugs.length) {
    const types = facts.plugs.map(p => (/^Type (\w)/.exec(p) || [])[1]).filter(Boolean);
    add('plug', types.length ? T('Plug adapter (type {types})', { types: types.join('/') }) : T('Plug adapter'), /adapter|adaptor|adaptateur/, T('If your chargers have other plugs') + (facts.voltage ? ` · ${facts.voltage}` : ''));
  }
  return out;
}

function packingSuggestions(trip) {
  // Already on the checklist, or on the trip's own list: not suggested again.
  const have = [...state.checklist, ...(trip.todos || [])].map(c => norm(c.text));
  const hidden = new Set(packingHidden[trip.id] || []);
  return packingIdeas(trip).filter(s => !hidden.has(s.key) && !have.some(t => s.match.test(t)));
}

function packingHTML(trip) {
  if (!trip) return '';
  const list = packingSuggestions(trip);
  if (!list.length) return '';
  return `
    <section class="pack-ideas" aria-label="${T('Suggestions')}">
      <h2 class="group-label">${icon('auto_awesome', 'sm')}${T('Suggested for {trip}', { trip: esc(trip.name) })}</h2>
      ${trip.shared ? `<p class="supporting">${T('Tap one to add it to your own checklist, or {icon} to add it for everyone on the trip.', { icon: icon('group', 'sm') })}</p>` : ''}
      <ul class="group">${list.map(s => `
        <li class="pack-idea">
          <button type="button" class="pack-add ripple" data-action="pack-add" data-key="${s.key}" aria-label="${trip.shared ? T('Add {name} to your own checklist', { name: esc(s.text) }) : T('Add {name}', { name: esc(s.text) })}">
            ${icon('add')}<span class="row-text"><span class="row-title">${esc(s.text)}</span><span class="row-sub">${esc(s.why)}</span></span>
          </button>
          ${trip.shared ? `<button type="button" class="icon-btn tonal ripple" data-action="pack-add-all" data-key="${s.key}"
            aria-label="${T('Add {name} to the list for everyone', { name: esc(s.text) })}" title="${T('Add for everyone on the trip')}">${icon('group')}</button>` : ''}
          <button type="button" class="icon-btn ripple" data-action="pack-hide" data-key="${s.key}" aria-label="${T('Don’t suggest {name}', { name: esc(s.text) })}" title="${T('Don’t suggest this')}">${icon('close')}</button>
        </li>`).join('')}
      </ul>
    </section>`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action="pack-add"], [data-action="pack-add-all"], [data-action="pack-hide"]');
  if (!el) return;
  const trip = activeTrip();
  if (!trip) return;
  const s = packingIdeas(trip).find(x => x.key === el.dataset.key);
  if (!s) return;
  if (el.dataset.action === 'pack-add') {
    state.checklist.push({ id: uid(), text: s.text, done: false });
    save();
    snackbar(trip.shared ? T('Added to your own checklist: {name}', { name: s.text }) : T('Added: {name}', { name: s.text }));
  } else if (el.dataset.action === 'pack-add-all') {
    // On a trip planned with other people: onto the trip's own list, for everyone.
    trip.todos = [...(trip.todos || []), { id: uid(), text: s.text, done: false }];
    save();
    snackbar(T('Added for everyone: {name}', { name: s.text }));
  } else {
    packingHidden[trip.id] = [...new Set([...(packingHidden[trip.id] || []), s.key])];
    try { localStorage.setItem(PACKING_KEY, JSON.stringify(packingHidden)); } catch { /* storage full */ }
  }
  render();
});
