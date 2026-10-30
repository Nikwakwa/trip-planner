'use strict';

/* view-plan.js — the Plan section: the trip card, each day with its plans, the way between them, and
   the ideas under each day. */

/* ---------- A plan's card (also used by Ideas) ---------- */

// drag: can be held and dragged to another day (Plan view). note: opening hours line (hours.js).
// schedule: an idea in the Ideas tab, with "Add to a day" instead of the done checkbox.
// num: the stop's number on the day's map (shown in place of the category icon). photo: a picture of the place.
function itemHTML(item, trip, { showDate = false, drag = false, note = null, schedule = false, num = 0, photo = '' } = {}) {
  const cat = CATEGORIES[item.category] || CATEGORIES.other;
  const link = safeUrl(item.link);
  const over = [
    item.time && fmtTime(item.time),
    showDate && item.date && fmtDay(item.date),
    // today.js: the day a stay begins, and for how long when its check-out day is set
    !startsStay(item, trip) ? cat.label : stayUntil(item) ? `${T('Check in')} · ${Tn(daysBetween(item.date, item.until), '{n} night', '{n} nights')}` : T('Check in'),
  ].filter(Boolean).join(' · ');
  const days = schedule ? tripDays(trip) : [];
  let chips;
  if (schedule && ui.pickDay === item.id) {
    // Picking a day for this idea: one button per trip day.
    chips = days.map(d => `<button type="button" class="assist-chip ripple" data-action="set-day" data-date="${d}">${esc(fmtDay(d, { weekday: 'short', day: 'numeric' }))}</button>`).join('')
      + `<button type="button" class="assist-chip icon-only ripple" data-action="pick-day" aria-label="${T('Cancel')}">${icon('close')}</button>`;
  } else {
    // "compact": on a phone only the icon shows, so the actions stay on one row.
    const files = filesOf(item.id).length;
    const filesLabel = files === 1 ? T('Ticket') : Tn(files, '{n} file', '{n} files');
    chips = [
      schedule && days.length && `<button type="button" class="assist-chip primary ripple" data-action="pick-day">${icon('calendar_add_on')}${T('Add to a day')}</button>`,
      item.place && `<a class="assist-chip ${schedule ? 'compact ' : ''}ripple" href="${esc(mapsUrl(item.place, trip, coordsOf(item, guideFor(trip)), item.title))}" target="_blank" rel="noopener" title="${T('Directions')}">${icon('location_on')}<span>${T('Directions')}</span></a>`,
      link && `<a class="assist-chip compact ripple" href="${esc(link)}" target="_blank" rel="noopener" title="${esc(hostLabel(link))}" aria-label="${T('Link: {site}', { site: esc(hostLabel(link)) })}">${icon('link')}<span>${esc(hostLabel(link))}</span></a>`,
      files && `<button type="button" class="assist-chip compact ripple" data-action="files" title="${filesLabel}" aria-label="${filesLabel}">${icon('confirmation_number')}<span>${filesLabel}</span></button>`,
      hasPlanInfo(item, guideFor(trip)) && `<button type="button" class="assist-chip icon-only ripple" data-action="plan-info" aria-label="${T('About {name}', { name: esc(item.title) })}" title="${T('About this place')}">${icon('info')}</button>`,
      item.date && !item.done && `<a class="assist-chip icon-only ripple" href="${esc(calendarUrl(item, trip))}" target="_blank" rel="noopener" aria-label="${T('Add {name} to Google Calendar', { name: esc(item.title) })}" title="${T('Add to Google Calendar')}">${icon('calendar_add_on')}</a>`,
    ].filter(Boolean).join('');
  }
  const check = schedule ? '' : `<button type="button" class="check ripple" data-action="toggle" role="checkbox"
        aria-checked="${item.done}" aria-label="${T('Done: {name}', { name: esc(item.title) })}" title="${T('Done')}"><span class="box">${icon('check')}</span></button>`;
  // The address line is skipped when it only repeats the title.
  const showPlace = item.place && norm(item.place) !== norm(item.title);
  const book = bookingNote(item, trip, guideFor(trip));
  return `
    <li class="item ${item.done ? 'done' : ''}" data-id="${esc(item.id)}" ${drag ? 'data-drag' : ''}>
      <button type="button" class="item-main ripple" data-action="edit">
        ${num ? `<span class="stop-badge" aria-label="${T('Stop {n}', { n: num })}">${num}</span>` : `<span class="avatar" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}</span>`}
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

/* ---------- The trip card and the days ---------- */

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
  for (const it of trip.items) {
    if (it.date) days.add(it.date);
    if (stayUntil(it)) days.add(it.until);     // today.js: a stay's check-out day shows up too
  }
  return [...days].sort();
}

function tripStatus(trip) {
  if (!trip.start || !trip.end) return null;
  const today = todayISO();
  if (today < trip.start) {
    const n = daysBetween(today, trip.start);
    return { icon: 'flight_takeoff', text: n === 1 ? T('Starts tomorrow') : T('Starts in {n} days', { n }) };
  }
  if (today > trip.end) return { icon: 'check', text: T('Trip complete') };
  return { icon: 'today', text: T('Day {n} of {total}', { n: daysBetween(trip.start, today) + 1, total: daysBetween(trip.start, trip.end) + 1 }) };
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
      <p class="hero-overline">${hasDates
        ? esc(`${fmtDay(trip.start, { month: 'short', day: 'numeric' })} – ${fmtDay(trip.end, { month: 'short', day: 'numeric' })} · ${Tn(n, '{n} day', '{n} days')}`)
        : T('No dates yet')}</p>
      <h1 class="hero-title">${esc(trip.name)}</h1>
      <div class="hero-row">
        ${status
          ? `<span class="status-chip">${icon(status.icon, 'sm')}${esc(status.text)}</span>`
          : `<button type="button" class="btn filled ripple" data-action="edit-trip">${icon('calendar_add_on')}${T('Add dates')}</button>`}
        ${planned.length ? `
          <div class="hero-progress">
            <span>${Tn(planned.length, '{done} of {n} plan done', '{done} of {n} plans done', { done })}</span>
            ${progressBar(done / planned.length, T('Plans done'))}
          </div>` : ''}
      </div>
      <div class="hero-actions">
        ${planned.length ? `<button type="button" class="hero-btn ripple" data-action="trip-map">${icon('map')}${T('Trip map')}</button>` : ''}
        ${trip.place ? `<button type="button" class="hero-btn ripple" data-action="essentials">${icon('info')}${T('Essentials')}</button>` : ''}
        ${shareButtonHTML(trip) /* share.js: with other people, or as text */}
      </div>
      <button type="button" class="icon-btn hero-edit ripple" data-action="edit-trip" aria-label="${T('Edit trip')}">${icon('edit')}</button>
    </section>`;

  html += nowCardHTML(trip);   // today.js: on a trip day, what's on now and what's next

  const guide = guideFor(trip);
  const suggestions = planSuggestions(trip, guide, days);
  // Suggestions are open for the first day from today that has some; the rest open with a tap.
  const focusDay = days.find(d => d >= today && suggestions.get(d) && suggestions.get(d).cards.length);
  if (!guide && guideState(trip) === 'loading' && state.settings.suggestions) {
    html += `<p class="guide-note" role="status">${icon('auto_awesome')}${T('Finding things to do in {place}…', { place: esc(trip.place.name) })}</p>`;
  }

  let noDays = '';
  if (!days.length) {
    noDays = emptyState('event_available', T('Your days will appear here'),
      T('Add the dates for {trip} and you’ll see the trip day by day.', { trip: esc(trip.name) }),
      `<div class="empty-actions">
        ${ideas ? `<button type="button" class="btn tonal ripple" data-action="open-ideas" data-tab="mine">${icon('lightbulb')}${Tn(ideas, 'See {n} idea', 'See {n} ideas')}</button>` : ''}
        ${guide ? `<button type="button" class="btn tonal ripple" data-action="open-ideas" data-tab="explore">${icon('explore')}${T('Explore {place}', { place: esc(guide.city) })}</button>` : ''}
      </div>`);
  }

  // Ideas not on a day yet, ready to be dragged onto one.
  const unplanned = trip.items.filter(i => !i.date);
  if (days.length && unplanned.length) {
    html += `
      <section class="idea-tray" aria-label="${T('Ideas to schedule')}">
        <p class="tray-head">${icon('lightbulb')}<span><b>${T('Ideas')}</b> · <span class="touch-only">${T('hold one and drag it onto a day')}</span><span class="mouse-only">${T('drag one onto a day')}</span></span></p>
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
      isToday && `<b>${T('Today')}</b>`,
      inRange ? T('Day {n}', { n: daysBetween(trip.start, day) + 1 }) : T('Outside trip dates'),
      items.length && Tn(items.length, '{n} plan', '{n} plans'),
    ].filter(Boolean).map(s => `<span>${s}</span>`).join(' · ');     // each part on one line ("4 activités")
    const list = dayListHTML(day, items, trip, guide);     // on a day without plans: only a stay's check-out
    html += `
      <section class="day ${isToday ? 'is-today' : ''}" id="day-${day}" style="--day:${dayTint(days.indexOf(day))}">
        <div class="day-head">
          <div class="day-text">
            <h2 class="day-title">${esc(fmtDay(day, { weekday: 'long', month: 'short', day: 'numeric' })).replace(/ (\S+)$/, '&nbsp;$1') /* "Oct 10" stays together */}</h2>
            <div class="day-sub">${sub}</div>
          </div>
          ${weatherHTML(trip, day)}
          <button type="button" class="icon-btn tonal ripple" data-action="add-on-day" data-date="${day}"
            aria-label="${T('Add a plan on {day}', { day: esc(fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric' })) })}">${icon('add')}</button>
        </div>
        ${dayToolsHTML(trip, day, items, guide)}
        ${list ? `<ul class="group plans">${list}</ul>` : ''}
        ${items.length ? '' : `<button type="button" class="empty-day ripple" data-action="add-on-day" data-date="${day}">${icon('add')}${T('Free day — tap to add a plan')}</button>`}
        ${suggestionsHTML(suggestions.get(day), day, ui.suggest[day] ?? day === focusDay)}
      </section>`;
  }

  $('#view-plan').innerHTML = html + '</div>';
  // Plans with an address that isn't in the guide get looked up on the map, then their opening hours.
  lookupMissing(trip, planned);
  lookupHours(trip, planned);
  lookupRoads(trip);           // routes.js: by car, the real way between each day's stops
  lookupBooking(trip);         // assistant.js: which plans are known to sell out
  // Save the trip's essentials while online, so they're there on arrival.
  essentialsFor(trip);
}

/* ---------- A day's plans, and the way between them ---------- */

// The travel time between two stops, as a link to directions. label: e.g. "From Hotel Avenida".
function legHTML(a, b, mode, label = '') {
  if (miles(a, b) < 0.05) return '';
  const t = legTravel(a, b, mode);      // routes.js: by car the real road, once it is known
  return `
    <li class="leg"><a class="leg-link ripple${label ? ' labelled' : ''}" href="${esc(directionsUrl(a, b, t.mode))}" target="_blank" rel="noopener"
      aria-label="${[T('Directions'), label && esc(label.toLowerCase()), `${esc(t.text)}, ${fmtDist(t.dist)}`].filter(Boolean).join(', ')}">${label ? `${icon('hotel')}<span class="leg-base">${T('{label}:', { label: esc(label) })}</span>` : ''}${icon(t.icon)}<span>${esc(t.text)} · ${fmtDist(t.dist)}</span><span class="leg-go">${T('Directions')}</span></a></li>`;
}

// A day's plans, with the travel time between each pair of stops, and to and from the home base (today.js).
function dayListHTML(day, items, trip, guide) {
  const mode = modeFor(trip, day);
  const located = items.filter(it => coordsOf(it, guide));
  const ends = dayEnds(trip, day, items, guide);
  // The day starts at the hotel: its name, then the way to the first stop. On the day it is left
  // (for another stay, or on its check-out day: today.js) it says so, also on a day without plans.
  const { start, out } = ends.out || located.length ? ends : {};
  const end = located.length ? ends.end : null;
  let html = start ? `
    <li class="stay-pill"><button type="button" class="ripple" data-action="edit" data-id="${esc(start.item.id)}"
      aria-label="${out ? T('Check out of') : T('Your stay:')} ${esc(start.item.title)}">${icon('hotel')}<span>${out ? `<b>${T('Check out')}</b> · ` : ''}${esc(start.item.title)}</span></button></li>` : '';
  let prev = start ? start.c : null;
  let num = 0;
  for (const item of items) {
    const c = coordsOf(item, guide);
    if (prev && c) html += legHTML(prev, c, mode);
    // Stops are numbered like their map pins; a stay keeps its hotel icon, as on the map.
    html += itemHTML(item, trip, { drag: true, note: hoursNote(item, guide), num: c && item.category !== 'stay' ? ++num : 0, photo: planPhoto(item, guide) });
    if (c) prev = c;
  }
  if (end && prev) html += legHTML(prev, end.c, mode, T('Back to your stay'));
  return html;
}

/* ---------- Ideas under each day ---------- */

// Suggestions for a day. Open by default only for the day being planned next (the others
// show one line to tap), so a long trip isn't a wall of cards.
function suggestionsHTML(s, day, open) {
  if (!s || !s.cards.length) return '';
  if (!open) {
    return `
      <button type="button" class="suggest-toggle ripple" data-action="toggle-suggest" data-date="${day}" aria-expanded="false">
        ${icon('auto_awesome')}<span>${esc(s.title)}</span><small>${Tn(s.cards.length, '{n} idea', '{n} ideas')}</small>${icon('arrow_forward', 'sm turn')}
      </button>`;
  }
  return `
    <div class="suggest">
      <div class="suggest-head">
        <button type="button" class="suggest-title ripple" data-action="toggle-suggest" data-date="${day}" aria-expanded="true">${icon('auto_awesome')}${esc(s.title)}</button>
        <button type="button" class="icon-btn ripple" data-action="shuffle" data-date="${day}" aria-label="${T('Show other suggestions')}">${icon('shuffle')}</button>
      </div>
      <div class="suggest-row">${s.cards.map(r => suggestionCard(r, day)).join('')}</div>
    </div>`;
}

function suggestionCard(r, day) {
  const p = r.p;
  const cat = CATEGORIES[p.cat] || CATEGORIES.other;
  const why = r.from
    ? `${icon('near_me')}<span>${T('{way} from {place}', { way: esc(travel(r.d, modeFor(activeTrip(), day)).text), place: esc(r.from.title) })}</span>`
    : p.area ? `${icon('location_on')}<span>${esc(p.area)}</span>` : '';
  return `
    <article class="s-card" aria-label="${esc(p.name)}">
      <button type="button" class="s-body ripple" data-action="place-info" data-place="${esc(p.id)}" data-date="${day}" aria-label="${T('More about {name}', { name: esc(p.name) })}">
        <span class="s-photo" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}${photoImg(p, '')}${whenTag(p)}</span>
        <span class="s-name">${esc(p.name)}</span>
        ${why ? `<span class="s-why">${why}</span>` : ''}
        <span class="s-blurb">${esc(p.blurb)}</span>
        <span class="more-link">${T('More')}${icon('arrow_forward')}</span>
      </button>
      <div class="s-foot">
        ${p.mins < 360 ? `<span class="tag">${icon('schedule')}${fmtDuration(p.mins)}</span>` : ''}
        ${p.tags.includes('free') ? `<span class="tag">${T('Free')}</span>` : ''}
        <button type="button" class="btn tonal sm ripple" data-action="add-suggestion" data-place="${esc(p.id)}" data-date="${day}"
          aria-label="${T('Add {name}', { name: esc(p.name) })}">${icon('add')}${T('Add')}</button>
      </div>
    </article>`;
}

/* ---------- Taps on the Plan ---------- */

onAction('toggle', (el) => {
  const card = el.closest('[data-id]');
  const found = findItem(card.dataset.id);
  if (!found) return;
  found.item.done = !found.item.done;
  save();
  tick(card, found.item.done);
});
onAction('edit', (el) => {
  const found = findItem(idOf(el));
  if (found) openItemForm(found.item);
});
onAction('add-on-day', el => openItemForm(null, { date: el.dataset.date }));
onAction('toggle-suggest', (el) => {
  ui.suggest[el.dataset.date] = el.getAttribute('aria-expanded') !== 'true';
  render();
});
onAction('shuffle', (el) => {
  ui.shuffle[el.dataset.date] = (ui.shuffle[el.dataset.date] || 0) + 1;
  render();
});
// Switches this day to the other way of getting around (or back to the trip's own).
onAction('day-travel', (el) => {
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
});
