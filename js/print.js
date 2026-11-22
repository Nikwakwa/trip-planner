'use strict';

/* print.js — the trip on paper: each day's plans in order, with the times, addresses, notes and the way
   between stops, then the ideas. Drawn into #print-view just before printing (the Share sheet's
   "Print or save as PDF", or the browser's own Print), and only that shows on paper (css/print.css). */

// One plan, as a line of the page.
function printItemHTML(item, num) {
  const cat = CATEGORIES[item.category] || CATEGORIES.other;
  const link = safeUrl(item.link);
  const where = item.place && norm(item.place) !== norm(item.title) ? item.place : '';
  return `
    <li class="p-item">
      <span class="p-time">${item.time ? esc(fmtTime(item.time)) : ''}</span>
      <span class="p-mark" style="--h:${cat.hue}">${num ? num : icon(cat.icon + '-fill')}</span>
      <div class="p-text">
        <b>${esc(item.title)}</b>
        ${where ? `<span>${esc(where)}</span>` : ''}
        ${item.notes ? `<span class="p-notes">${esc(item.notes)}</span>` : ''}
        ${link ? `<span class="p-link">${esc(link)}</span>` : ''}
      </div>
    </li>`;
}

// The way between two stops, as on the Plan (view-plan.js: legHTML), in words.
function printLegHTML(a, b, mode, label = '') {
  if (miles(a, b) < 0.05) return '';
  const t = legTravel(a, b, mode);
  return `<li class="p-leg">${label ? `${esc(label)} · ` : ''}${esc(t.text)} · ${fmtDist(t.dist)}</li>`;
}

// One day: where it starts, the plans in order with the way between them, and back to the stay.
function printDayHTML(trip, day, n, guide) {
  const items = dayItems(trip, day);
  const mode = modeFor(trip, day);
  const located = items.filter(it => coordsOf(it, guide));
  const ends = dayEnds(trip, day, items, guide);
  const { start, out } = ends.out || located.length ? ends : {};
  const end = located.length ? ends.end : null;
  let html = start ? `<li class="p-stay">${out ? `${T('Check out')} · ` : ''}${esc(start.item.title)}</li>` : '';
  let prev = start ? start.c : null;
  let num = 0;
  for (const item of items) {
    const c = coordsOf(item, guide);
    if (prev && c) html += printLegHTML(prev, c, mode);
    html += printItemHTML(item, c && item.category !== 'stay' ? ++num : 0);
    if (c) prev = c;
  }
  if (end && prev) html += printLegHTML(prev, end.c, mode, T('Back to your stay'));
  if (!items.length && !start) html += `<li class="p-free">${T('Free day')}</li>`;
  const title = fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric' });
  return `
    <section class="p-day" style="--day:${dayTint(n)}">
      <h2>${n >= 0 ? `<span class="p-daynum">${T('Day {n}', { n: n + 1 })}</span>` : ''}${esc(title)}</h2>
      <ul>${html}</ul>
    </section>`;
}

// The whole trip, as the page to print.
function tripPrintHTML(trip) {
  const guide = guideFor(trip);
  const tripDaysList = tripDays(trip);
  const dated = trip.start && trip.end;
  const sub = [
    dated ? T('{start} to {end}', { start: fmtDay(trip.start, { month: 'long', day: 'numeric', year: 'numeric' }), end: fmtDay(trip.end, { month: 'long', day: 'numeric', year: 'numeric' }) }) : '',
    dated ? Tn(daysBetween(trip.start, trip.end) + 1, '{n} day', '{n} days') : '',
    trip.place ? localLabel(trip.place) : '',
  ].filter(Boolean).join(' · ');
  // Day numbers count from the trip's first day; a plan outside the trip's dates has none.
  const dayNum = day => (dated && day >= trip.start && day <= trip.end ? daysBetween(trip.start, day) : -1);
  const ideas = trip.items.filter(i => !i.date);
  return `
    <header class="p-head">
      <h1>${esc(tripName(trip))}</h1>
      ${sub ? `<p>${esc(sub)}</p>` : ''}
    </header>
    ${tripDaysList.map(day => printDayHTML(trip, day, dayNum(day), guide)).join('')}
    ${ideas.length ? `
      <section class="p-day p-ideas">
        <h2>${T('Ideas')}</h2>
        <ul>${ideas.map(i => printItemHTML(i, 0)).join('')}</ul>
      </section>` : ''}
    ${!tripDaysList.length && !ideas.length ? `<p class="p-free">${T('No plans yet')}</p>` : ''}
    <footer class="p-foot">${T('Printed on {day}', { day: esc(fmtDay(todayISO(), { month: 'long', day: 'numeric', year: 'numeric' })) })}</footer>`;
}

// Drawn just before printing: from the button, and from the browser's own Print (Ctrl+P on a computer).
function preparePrint() {
  const trip = activeTrip();
  const view = $('#print-view');
  if (!trip) { view.innerHTML = ''; document.documentElement.classList.remove('printing'); return false; }
  view.innerHTML = tripPrintHTML(trip);
  document.documentElement.classList.add('printing');
  return true;
}
window.addEventListener('beforeprint', preparePrint);
window.addEventListener('afterprint', () => {
  document.documentElement.classList.remove('printing');
  $('#print-view').innerHTML = '';
});

/* ---------- Taps ---------- */

// The Share sheet's "Print or save as PDF": the sheet closes first, so only the trip is on paper.
onAction('print-trip', () => {
  if (!activeTrip()) return;
  const dlg = $('#share-dialog');
  if (dlg.open) dlg.close();
  preparePrint();
  // A moment for the sheet to go: the browser's print window then opens on the page as it now is.
  setTimeout(() => {
    try { window.print(); } catch { snackbar(T('This device can’t print from the app')); }
  }, 50);
});
