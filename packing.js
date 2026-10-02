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
  const wet = weather.filter(w => w.wet || w.rain >= 50);
  const hiC = weather.length ? Math.max(...weather.map(w => w.hi)) : null;
  const loC = weather.length ? Math.min(...weather.map(w => w.lo)) : null;
  const plans = trip.items;
  const text = plans.map(i => norm(`${i.title} ${i.place} ${i.notes}`)).join(' | ');
  const e = trip.place && essentials.saved[placeKey(trip.place)];
  const facts = (e && e.facts) || {};
  const guide = guideFor(trip);
  const out = [];
  const add = (key, item, match, why) => out.push({ key, text: item, match, why });

  if (wet.length) add('rain', 'Umbrella or rain jacket', /umbrella|rain/, `Rain likely on ${plural(wet.length, 'day')}`);
  if (hiC !== null && hiC >= 27) {
    add('sun', 'Sunscreen and sunglasses', /sunscreen|sun ?cream|sunglasses/, `Up to ${temp(hiC)}`);
    add('water', 'Refillable water bottle', /water bottle|bottle/, `Up to ${temp(hiC)}`);
  }
  if (loC !== null && loC <= 5) add('cold', 'Warm coat, hat and gloves', /coat|gloves|hat|scarf/, `Down to ${temp(loC)}`);
  else if (loC !== null && loC <= 14) add('layers', 'A warm layer for the evenings', /jacket|sweater|layer|fleece|hoodie/, `Evenings down to ${temp(loC)}`);
  if (weather.some(w => w.icon === 'weather_snowy')) add('snow', 'Waterproof shoes', /boots|waterproof shoes/, 'Snow in the forecast');

  // Lots of stops on a day means a lot of walking.
  const busy = days.filter(d => dayItems(trip, d).length >= 4).length;
  if (busy) add('shoes', 'Comfortable walking shoes', /shoes|sneakers|trainers/, `${plural(busy, 'busy day')} on foot`);

  if (/flight|airport|airline|boarding|\bfly\b/.test(text)) {
    add('id', 'Passport or ID', /passport|\bid\b|identity/, 'You’re flying');
    add('boarding', 'Boarding passes (or the airline app)', /boarding/, 'You’re flying');
  }
  if (trip.travel === 'drive' || Object.values(trip.dayTravel || {}).includes('drive') || /car rental|rental car|hire car/.test(text)) {
    add('licence', 'Driving licence', /licen[cs]e|permit/, `Driving${facts.driving ? ` (on the ${facts.driving})` : ''}`);
  }
  if (plans.some(i => i.category === 'stay')) add('hotel', 'Hotel booking details', /hotel|booking|reservation|airbnb/, 'You have a place to stay planned');
  if (plans.some(i => i.category === 'event')) add('tickets', 'Tickets for shows and events', /ticket/, 'Shows or events planned');
  const beachy = /beach|praia|plage|playa|spiaggia|strand|swim|pool|piscina|thermal|spa\b|bath/;
  if (beachy.test(text) || (guide && plans.some(i => matchPlaces(i, guide).some(p => beachy.test(norm(p.name)))))) {
    add('swim', 'Swimsuit and towel', /swim|bathing|towel/, 'A beach or pool is planned');
  }
  if (facts.plugs && facts.plugs.length) {
    const types = facts.plugs.map(p => (/^Type (\w)/.exec(p) || [])[1]).filter(Boolean);
    add('plug', `Plug adapter${types.length ? ` (type ${types.join('/')})` : ''}`, /adapter|adaptor/, `If your chargers have other plugs${facts.voltage ? ` · ${facts.voltage}` : ''}`);
  }
  return out;
}

function packingSuggestions(trip) {
  const have = state.checklist.map(c => norm(c.text));
  const hidden = new Set(packingHidden[trip.id] || []);
  return packingIdeas(trip).filter(s => !hidden.has(s.key) && !have.some(t => s.match.test(t)));
}

function packingHTML(trip) {
  if (!trip) return '';
  const list = packingSuggestions(trip);
  if (!list.length) return '';
  return `
    <section class="pack-ideas" aria-label="Suggestions">
      <h2 class="group-label">${icon('auto_awesome', 'sm')}Suggested for ${esc(trip.name)}</h2>
      <ul class="group">${list.map(s => `
        <li class="pack-idea">
          <button type="button" class="pack-add ripple" data-action="pack-add" data-key="${s.key}" aria-label="Add ${esc(s.text)}">
            ${icon('add')}<span class="row-text"><span class="row-title">${esc(s.text)}</span><span class="row-sub">${esc(s.why)}</span></span>
          </button>
          <button type="button" class="icon-btn ripple" data-action="pack-hide" data-key="${s.key}" aria-label="Don’t suggest ${esc(s.text)}">${icon('close')}</button>
        </li>`).join('')}
      </ul>
    </section>`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action="pack-add"], [data-action="pack-hide"]');
  if (!el) return;
  const trip = activeTrip();
  if (!trip) return;
  const s = packingIdeas(trip).find(x => x.key === el.dataset.key);
  if (!s) return;
  if (el.dataset.action === 'pack-add') {
    state.checklist.push({ id: uid(), text: s.text, done: false });
    save();
    snackbar(`Added: ${s.text}`);
  } else {
    packingHidden[trip.id] = [...new Set([...(packingHidden[trip.id] || []), s.key])];
    try { localStorage.setItem(PACKING_KEY, JSON.stringify(packingHidden)); } catch { /* storage full */ }
  }
  render();
});
