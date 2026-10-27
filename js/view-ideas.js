'use strict';

/* view-ideas.js — the Ideas section: your ideas, and Explore (the guide's places), with the details
   sheet of a guide place. */

const FILTERS = [
  ['all', T('All'), () => true],
  ['sight', T('Sights'), p => p.cat === 'sight'],
  ['food', T('Food & drink'), p => p.cat === 'food'],
  ['event', T('Shows & sports'), p => p.cat === 'event'],
  ['shopping', T('Shopping'), p => p.cat === 'shopping'],
  ['free', T('Free'), p => p.tags.includes('free'), 'money_off'],
  ['rainy', T('Rainy day'), p => p.tags.includes('rainy'), 'umbrella'],
  ['evening', T('Evening'), p => p.when === 'evening', 'bedtime'],
];

function placeHTML(p, added, trip) {
  const cat = CATEGORIES[p.cat] || CATEGORIES.other;
  const over = [p.area, p.mins < 360 && fmtDuration(p.mins), p.tags.includes('free') && T('Free')].filter(Boolean).join(' · ');
  return `
    <li class="item place">
      <button type="button" class="item-main ripple" data-action="place-info" data-place="${esc(p.id)}" data-date="">
        ${placeThumb(p, cat)}
        <span class="item-text">
          <span class="overline">${esc(over)}</span>
          <span class="item-title">${esc(p.name)}</span>
          <span class="item-notes">${esc(p.blurb)}</span>
          <span class="more-link">${T('More')}${icon('arrow_forward')}</span>
        </span>
      </button>
      <button type="button" class="icon-btn tonal add-btn ripple ${added ? 'added' : ''}"
        data-action="${added ? 'noop' : 'add-suggestion'}" data-place="${esc(p.id)}" data-date=""
        aria-label="${added ? T('{name} is already in your trip', { name: esc(p.name) }) : T('Save {name} to your ideas', { name: esc(p.name) })}">${icon(added ? 'check' : 'add')}</button>
    </li>`;
}

function renderIdeas(trip) {
  const guide = guideFor(trip);
  const ideas = trip.items.filter(i => !i.date);
  const tab = ui.ideasTab;
  let html = `
    <h1 class="headline">${T('Ideas')}</h1>
    <div class="segmented" role="group" aria-label="${T('Ideas view')}">
      <button type="button" class="ripple" data-action="ideas-tab" data-tab="mine" aria-pressed="${tab === 'mine'}">${icon('lightbulb')}${T('My ideas')}${ideas.length ? ` (${ideas.length})` : ''}</button>
      <button type="button" class="ripple" data-action="ideas-tab" data-tab="explore" aria-pressed="${tab === 'explore'}">${icon('explore')}${T('Explore')}</button>
    </div>`;

  if (tab === 'mine') {
    html += `
      <p class="supporting">${T('Things you might do in {trip}. Add one to a day when you’re ready, or tap it to edit.', { trip: esc(trip.name) })}</p>
      ${ideas.length
        ? `<ul class="group plans">${ideas.map(it => itemHTML(it, trip, { schedule: true })).join('')}</ul>`
        : emptyState('travel_explore', T('No ideas yet'), T('Save places you hear about here, then schedule them later.'),
            guide ? `<button type="button" class="btn tonal ripple" data-action="ideas-tab" data-tab="explore">${icon('explore')}${T('Explore {place}', { place: esc(guide.city) })}</button>` : '')}`;
  } else if (!guide) {
    const googleIdeas = `<a class="btn tonal ripple" href="https://www.google.com/maps/search/${encodeURIComponent(T('things to do in {place}', { place: placeLabel(trip) }))}" target="_blank" rel="noopener">${icon('map')}${T('Things to do on Google Maps')}</a>`;
    const changePlace = `<button type="button" class="btn tonal ripple" data-action="edit-trip">${icon('search')}${T('Change place')}</button>`;
    const status = guideState(trip);
    if (status === 'loading') {
      html += emptyState('travel_explore', `${T('Finding things to do in {place}…', { place: esc(trip.place.name) })}`,
        T('Looking up sights, food and more in the Wikivoyage travel guide.'));
    } else if (!trip.place && !navigator.onLine) {
      html += emptyState('cloud_off', T('Ideas for {trip} need a connection', { trip: esc(trip.name) }),
        T('Connect to the internet once, and the guide is saved on your device for later.'));
    } else if (!trip.place) {
      html += emptyState('location_off', T('Couldn’t find {trip} on the map', { trip: esc(trip.name) }),
        T('Edit the trip and pick the city or country from the list to get ideas for it.'),
        `<div class="empty-actions">${changePlace}${googleIdeas}</div>`);
    } else if (status === 'failed') {
      html += emptyState('travel_explore', T('No guide found for {place}', { place: esc(trip.place.label) }),
        T('The travel guide may not cover it, or the connection dropped. You can still look for ideas on Google Maps.'),
        `<div class="empty-actions">
          <button type="button" class="btn tonal ripple" data-action="retry-guide">${icon('restart_alt')}${T('Try again')}</button>
          ${changePlace}${googleIdeas}
        </div>`);
    } else {
      html += emptyState('cloud_off', T('Ideas for {trip} need a connection', { trip: esc(trip.place.name) }),
        T('Connect to the internet once, and the guide is saved on your device for later.'));
    }
  } else {
    const taken = new Set(trip.items.flatMap(i => matchPlaces(i, guide).map(p => p.id)));
    const destinations = guide.kind === 'destinations' && !guide.joined;
    const filter = destinations ? FILTERS[0] : FILTERS.find(f => f[0] === ui.filter) || FILTERS[0];
    const list = guide.places.filter(filter[2]);
    const count = { n: guide.places.length, place: esc(guide.city), source: guide.source };
    const intro = guide.joined ? T('{n} places near your plans and in {place}, from {source}.', count)
      : !guide.source ? T('{n} hand-picked places in {place}.', count)
      : destinations ? T('{n} cities and destinations in {place}, from the {source} travel guide.', count)
      : T('{n} places in {place}, from {source}.', count);
    html += `
      <p class="supporting">${intro} ${T('Tap + to save one to your ideas.')}</p>
      ${trip.place && guide.source ? `
        <div class="place-row">
          <span class="place-pin">${icon('location_on')}<span>${esc(trip.place.label)}</span></span>
          <button type="button" class="btn text ripple" data-action="near-me">${icon('my_location')}${T('Near me')}</button>
          <button type="button" class="btn text ripple" data-action="edit-trip">${T('Change')}</button>
        </div>` : ''}
      ${destinations ? '' : `
        <div class="filter-row" role="group" aria-label="${T('Filter places')}">
          ${FILTERS.map(([key, label, , ic]) => `
            <button type="button" class="filter-chip ripple" data-action="filter" data-filter="${key}" aria-pressed="${filter[0] === key}">${ic ? icon(ic) : ''}${label}</button>`).join('')}
        </div>`}
      ${list.length
        ? `<ul class="group">${list.map(p => placeHTML(p, taken.has(p.id), trip)).join('')}</ul>`
        : emptyState('travel_explore', T('Nothing here'), T('Try another filter.'))}
      <p class="footnote">${icon('schedule', 'sm')}${T('Opening hours change — check before you go.')}</p>
      ${guide.source === 'Wikivoyage' ? `<p class="footnote"><span>${T('Places and descriptions:')} <a href="${esc(guide.sourceUrl)}" target="_blank" rel="noopener">Wikivoyage</a>, CC BY-SA.</span></p>` : ''}
      ${guide.source === 'Wikipedia' ? `<p class="footnote">${T('Places and descriptions:')} Wikipedia, CC BY-SA.</p>` : ''}`;
  }
  $('#view-ideas').innerHTML = html;
}

/* ---------- Details sheet for a guide place (full description, add or save) ---------- */

function openPlaceInfo(id, day) {
  const trip = activeTrip();
  const guide = trip && guideFor(trip);
  const p = guide && guide.places.find(x => x.id === id);
  if (!p) return;
  const cat = CATEGORIES[p.cat] || CATEGORIES.other;
  const added = trip.items.some(i => matchPlaces(i, guide).some(m => m.id === p.id));
  const over = [cat.label, p.area, p.mins < 360 && fmtDuration(p.mins), p.tags.includes('free') && T('Free')].filter(Boolean).join(' · ');
  const tags = [whenTag(p), p.tags.includes('rainy') && (p.when === 'morning' || p.when === 'evening') ? `<span class="tag">${icon('umbrella')}${T('Indoors')}</span>` : ''].join('');
  const dayName = day && fmtDay(day, { weekday: 'long' });
  $('#place-body').innerHTML = `
    ${p.photo ? `<figure class="pi-figure">${photoImg(p, 'pi-photo')}<figcaption>${T('Photo: Wikimedia Commons')}</figcaption></figure>` : ''}
    <div class="pi-head">
      <span class="avatar" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}</span>
      <div class="pi-heading">
        <p class="overline">${esc(over)}</p>
        <h2 tabindex="-1" autofocus>${esc(p.name)}</h2>
      </div>
      <button type="button" class="icon-btn ripple" data-close aria-label="${T('Close')}">${icon('close')}</button>
    </div>
    ${tags.trim() ? `<div class="pi-tags">${tags}</div>` : ''}
    <p class="pi-text">${esc(p.about || p.blurb)}</p>
    ${p.hours ? `<p class="pi-hours">${icon('schedule')}<span>${esc(p.hours)}</span></p>` : ''}
    ${factsHTML([[T('Price'), p.price], [T('Getting there'), p.tip]])}
    <div class="pi-links">
      <a class="assist-chip ripple" href="${esc(mapsUrl(p.place || p.name, trip, p))}" target="_blank" rel="noopener">${icon('map')}${T('Map')}</a>
      ${safeUrl(p.url) ? `<a class="assist-chip ripple" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${icon('link')}${esc(hostLabel(safeUrl(p.url)))}</a>` : ''}
      ${guide.sourceUrl && !p.local ? `<a class="assist-chip ripple" href="${esc(guide.sourceUrl)}" target="_blank" rel="noopener">${icon('open_in_new')}${esc(guide.source)}</a>` : ''}
    </div>
    <div class="sheet-actions">
      ${added
        ? `<span class="pi-added">${icon('check')}${T('Already in your trip')}</span>`
        : `${day ? `<button type="button" class="btn text ripple" data-action="add-suggestion" data-place="${esc(p.id)}" data-date="">${T('Save to ideas')}</button>` : ''}
           <span class="spacer"></span>
           <button type="button" class="btn filled lg ripple" data-action="add-suggestion" data-place="${esc(p.id)}" data-date="${day || ''}">
             ${icon('add')}${day ? T('Add to {day}', { day: esc(dayName) }) : T('Save to ideas')}</button>`}
    </div>`;
  $('#place-dialog').showModal();
}

/* ---------- Taps on Ideas, and on the guide's places ---------- */

onAction('ideas-tab', (el) => {
  ui.ideasTab = el.dataset.tab;
  render();
});
onAction('open-ideas', (el) => {
  ui.ideasTab = el.dataset.tab;
  showView('ideas', { top: true });
});
onAction('filter', (el) => {
  ui.filter = el.dataset.filter;
  render();
});
// An idea's "Add to a day": its buttons turn into the trip's days.
onAction('pick-day', (el) => {
  const id = idOf(el);
  ui.pickDay = ui.pickDay === id ? null : id;
  render();
});
onAction('set-day', (el) => {
  const found = findItem(idOf(el));
  if (!found) return;
  const { item } = found;
  item.date = el.dataset.date;
  ui.pickDay = null;
  save();
  render();
  snackbar(T('Added to {day}', { day: fmtDay(item.date, { weekday: 'long' }) }), T('Undo'), () => {
    item.date = '';
    save();
    render();
  });
});
onAction('place-info', el => openPlaceInfo(el.dataset.place, el.dataset.date));
// A guide place, added to a day (data-date) or saved to the ideas: from a suggestion, Explore or its sheet.
onAction('add-suggestion', (el) => {
  const trip = activeTrip();
  const guide = guideFor(trip);
  const p = guide && guide.places.find(x => x.id === el.dataset.place);
  if (!p) return;
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
  snackbar(item.date ? T('Added to {day}', { day: fmtDay(item.date, { weekday: 'long' }) }) : T('Saved to your ideas'), T('Undo'), () => {
    trip.items = trip.items.filter(i => i !== item);
    save();
    render();
  });
});
onAction('retry-guide', () => {
  const trip = activeTrip();
  if (trip.place) loadGuide(trip.place, { retry: true });
});
