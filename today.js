'use strict';

/* =========================================================
   During the trip:
   - Home base: a "Stay" plan with an address (the hotel, apartment…) is where each
     day starts and ends, from its day on. Before the first one, the first one counts;
     a stay saved as an idea (no day) counts for the whole trip.
   - Now & next: on a trip day, the plan going on now, the next one, and when to leave for it.
   - What's near me: guide places around the phone's location, open now first.
   Functions here use helpers from app.js, which is loaded after this file.
   ========================================================= */

/* ---------- Home base ---------- */

function baseFor(trip, day, guide = guideFor(trip)) {
  const all = trip.items
    .filter(i => i.category === 'stay')
    .map(i => ({ item: i, c: coordsOf(i, guide) }));
  const stays = all.filter(s => s.c);
  if (!stays.length) return null;
  const byDate = (a, b) => (a.item.date < b.item.date ? -1 : a.item.date > b.item.date ? 1 : 0);
  const dated = stays.filter(s => s.item.date).sort(byDate);
  if (!dated.length) return stays[0];
  const since = day ? dated.filter(s => s.item.date <= day) : [];
  if (!since.length) return dated[0];
  const base = since[since.length - 1];
  // A later stay that isn't on the map (its address wasn't found): the earlier one is no longer
  // the base. Better no base than a hotel in another city.
  const moved = all.some(s => !s.c && s.item.date && s.item.date > base.item.date && s.item.date <= day);
  return moved ? null : base;
}

/* ---------- Now & next ---------- */

const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const toMinutes = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minutesText = m => fmtTime(`${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

// How long a plan usually takes: the guide's visit length, or about an hour.
function planLength(item, guide) {
  const p = matchPlaces(item, guide)[0];
  return p && p.mins < 360 ? p.mins : item.category === 'food' ? 75 : 60;
}

function nowNext(trip) {
  const today = todayISO();
  const guide = guideFor(trip);
  const items = dayItems(trip, today);
  // A day with only the hotel on it has nothing to show.
  if (!items.some(it => it.time || it.category !== 'stay')) return null;
  const now = nowMinutes();
  let current = null;
  for (const it of items) {
    if (it.time && !it.done && toMinutes(it.time) <= now && now < toMinutes(it.time) + planLength(it, guide)) current = it;
  }
  // The hotel itself isn't something to go to next, unless it has a time (check-in).
  const upcoming = items.filter(it => !it.done && it !== current
    && (it.time ? toMinutes(it.time) > now : it.category !== 'stay'));
  const next = upcoming[0] || null;
  if (!current && !next) return { done: true };

  let leave = null;
  if (next) {
    // From the plan before it (or the hotel, first thing in the day) to the next plan.
    const before = items.slice(0, items.indexOf(next)).reverse().find(it => coordsOf(it, guide));
    const from = before ? coordsOf(before, guide) : (baseFor(trip, today, guide) || {}).c;
    const to = coordsOf(next, guide);
    if (from && to) {
      const t = travel(miles(from, to), modeFor(trip, today));
      leave = { trip: t, at: next.time ? toMinutes(next.time) - t.mins - 5 : null, to };
    } else if (to) {
      leave = { trip: null, at: null, to };
    }
  }
  return { current, next, leave, now };
}

function nowCardHTML(trip) {
  const n = nowNext(trip);
  if (!n) return '';
  if (n.done) {
    return `<section class="now-card" id="now-card"><p class="now-label">${icon('check')}Today</p>
      <p class="now-title">All of today’s plans are done.</p>
      <div class="now-actions"><button type="button" class="assist-chip ripple" data-action="near-me">${icon('my_location')}What’s near me</button></div></section>`;
  }
  const line = (label, it, sub) => `
    <div class="now-row">
      <p class="now-label">${label}</p>
      <p class="now-title">${it.time ? `<b>${esc(fmtTime(it.time))}</b> · ` : ''}${esc(it.title)}</p>
      ${sub ? `<p class="now-sub">${sub}</p>` : ''}
    </div>`;
  let leaveText = '';
  if (n.next && n.leave && n.leave.trip) {
    const late = n.leave.at !== null && n.leave.at <= n.now;
    leaveText = n.leave.at === null ? `${icon(n.leave.trip.icon)}${esc(n.leave.trip.text)}`
      : late ? `<span class="now-late">${icon(n.leave.trip.icon)}Leave now · ${esc(n.leave.trip.text)}</span>`
      : `${icon(n.leave.trip.icon)}Leave by <b>${esc(minutesText(n.leave.at))}</b> · ${esc(n.leave.trip.text)}`;
  }
  const mode = n.leave && n.leave.trip ? n.leave.trip.mode : 'transit';
  return `
    <section class="now-card" id="now-card" aria-label="Now and next">
      ${n.current ? line(`${icon('navigation')}Now`, n.current, '') : ''}
      ${n.next ? line(`${icon('schedule')}Next`, n.next, leaveText) : ''}
      <div class="now-actions">
        ${n.next && n.leave ? `<a class="assist-chip ripple" href="https://www.google.com/maps/dir/?api=1&destination=${n.leave.to.lat},${n.leave.to.lng}&travelmode=${mode}" target="_blank" rel="noopener">${icon('directions')}Directions</a>` : ''}
        <button type="button" class="assist-chip ripple" data-action="near-me">${icon('my_location')}What’s near me</button>
      </div>
    </section>`;
}

// Keeps "leave by" and "now" up to date while the Plan tab is open.
setInterval(() => {
  const card = document.getElementById('now-card');
  if (!card || ui.view !== 'plan' || document.body.classList.contains('dragging')) return;
  const trip = activeTrip();
  const html = trip ? nowCardHTML(trip) : '';
  if (html) card.outerHTML = html; else card.remove();
}, 30000);

/* ---------- What's near me ---------- */

const near = { status: '', pos: null, error: '' };

function openNearMe() {
  near.status = 'locating';
  near.error = '';
  if (!$('#near-dialog').open) $('#near-dialog').showModal();     // "Try again" is tapped inside the open sheet
  renderNearMe();
  if (!navigator.geolocation) { near.status = 'error'; near.error = 'This device’s browser can’t share its location.'; renderNearMe(); return; }
  navigator.geolocation.getCurrentPosition((p) => {
    near.pos = { lat: p.coords.latitude, lng: p.coords.longitude };
    near.status = 'ready';
    renderNearMe();
  }, (err) => {
    near.status = 'error';
    near.error = err.code === 1
      ? 'Location is blocked for this app. Allow it for this site in your browser’s settings (on an iPhone: Settings → Privacy → Location Services), then try again.'
      : 'Couldn’t find where you are. Check that location is on, then try again.';
    renderNearMe();
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

// Open now? true / false, or null when the guide doesn't say.
function openNow(p) {
  const rules = p.hours && guideHours(p.hours);
  if (!rules) return null;
  const open = hoursOn(rules, todayISO());
  const t = nowMinutes();
  return open.some(([a, b]) => (t >= a && t < b) || (t + 1440 >= a && t + 1440 < b));
}

function renderNearMe() {
  const trip = activeTrip();
  const body = $('#near-body');
  if (!trip) return;
  const guide = guideFor(trip);
  if (near.status === 'locating') { body.innerHTML = `<p class="guide-note">${icon('my_location')}Finding where you are…</p>`; return; }
  if (near.status === 'error') {
    body.innerHTML = emptyState('location_off', 'No location', esc(near.error),
      `<button type="button" class="btn tonal ripple" data-action="near-me">${icon('restart_alt')}Try again</button>`);
    return;
  }
  if (!guide) { body.innerHTML = emptyState('travel_explore', 'No guide yet', `The guide for ${esc(trip.name)} isn’t ready. Open the trip while online first.`); return; }
  const here = near.pos;
  const ranked = guide.places.map(p => ({ p, d: miles(here, p) })).sort((a, b) => a.d - b.d);
  if (!ranked.length || ranked[0].d > 30) {
    body.innerHTML = emptyState('my_location', `You’re ${ranked.length ? fmtDist(ranked[0].d) : 'far'} from ${esc(guide.city)}`,
      'This shows places around you once you’re there.');
    return;
  }
  const mode = modeFor(trip, todayISO());
  const close = ranked.filter(r => r.d <= 1.5).slice(0, 30);
  const list = (close.length >= 5 ? close : ranked.slice(0, 10))
    .map(r => ({ ...r, open: openNow(r.p) }))
    .sort((a, b) => (a.open === false) - (b.open === false) || a.d - b.d);
  const day = trip.start && todayISO() >= trip.start && todayISO() <= trip.end ? todayISO() : '';
  body.innerHTML = `
    <p class="supporting">${close.length >= 5 ? `Within ${fmtDist(1.5)}` : 'Closest to you'}, from the ${esc(guide.city)} guide. Tap one for more.</p>
    <ul class="group">${list.map(({ p, d, open }) => {
      const cat = CATEGORIES[p.cat] || CATEGORIES.other;
      const t = travel(d, mode);
      return `
        <li class="item place ${open === false ? 'closed' : ''}">
          <button type="button" class="item-main ripple" data-action="place-info" data-place="${esc(p.id)}" data-date="${day}">
            ${placeThumb(p, cat)}
            <span class="item-text">
              <span class="overline">${esc([fmtDist(d), t.text].join(' · '))}</span>
              <span class="item-title">${esc(p.name)}</span>
              ${open === true ? `<span class="item-hours">${icon('schedule')}Open now</span>` : ''}
              ${open === false ? `<span class="item-hours warn">${icon('event_busy')}Closed now</span>` : ''}
              <span class="item-notes">${esc(p.blurb)}</span>
            </span>
          </button>
        </li>`;
    }).join('')}</ul>`;
}
