'use strict';

/* view-checklist.js — the Checklist section: the personal checklist, and the list of a trip planned
   with other people.
   The personal checklist (state.checklist) holds two kinds of lines: a trip's own (c.trip, the trip's id,
   ticked with c.done), and lines for every trip (no c.trip), ticked off separately on each trip (c.doneOn,
   the ids of the trips where they are ticked). */

// "Hold an item and drag it", said the way the device moves things.
const dragHow = () => `<span class="touch-only">${T('Hold an item and drag it')}</span><span class="mouse-only">${T('Drag an item')}</span>`;

function taskHTML(c, list, tag = false) {
  const done = list.ticked(c);
  // With no trip open, a line for every trip can't be ticked: ticks are kept per trip.
  const canTick = list.name !== 'every' || !!activeTrip();
  return `
    <li class="task${done ? ' done' : ''}${canTick ? '' : ' no-tick'}" data-check="${esc(c.id)}" data-home="${list.name}" data-drag>
      ${canTick ? `<button type="button" class="check ripple" data-action="toggle-check" role="checkbox"
        aria-checked="${done}" aria-label="${T('Done: {name}', { name: esc(c.text) })}"><span class="box">${icon('check')}</span></button>` : ''}
      <span class="task-text">${esc(c.text)}</span>
      ${tag ? `<span class="task-tag">${T('Every trip')}</span>` : ''}
      <button type="button" class="icon-btn ripple" data-action="del-check" aria-label="${T('Remove {name}', { name: esc(c.text) })}">${icon('close')}</button>
    </li>`;
}

// A trip planned with other people has a list of its own: everyone on the trip sees it, adds to it and
// ticks things off. It is kept with the trip (trip.todos), apart from the checklist, which stays personal.
function tripListHTML(trip, typed) {
  if (!trip || !(trip.shared || (trip.todos && trip.todos.length))) return '';
  const list = listNamed('trip');
  const todos = list.get();
  const done = todos.filter(c => c.done);
  return `
    <section class="trip-list" data-list="trip" aria-label="${T('List for everyone on {trip}', { trip: esc(tripName(trip)) })}">
      <div class="label-row">
        <h2 class="group-label">${icon('group', 'sm')}${esc(tripName(trip))}${trip.shared ? T(', together') : ''}${todos.length ? ` · ${done.length}/${todos.length}` : ''}</h2>
        ${done.length ? `<button type="button" class="btn text ripple" data-action="clear-checked">${T('Clear done')}</button>` : ''}
      </div>
      ${trip.shared ? `<p class="supporting">${T('Everyone on the trip can add to it and tick things off.')}
        ${T('{how} to move it between this list and yours.', { how: dragHow() })}</p>` : ''}
      <form class="add-bar" data-form="todo">
        <input name="text" value="${esc(typed)}" placeholder="${T('Add something for everyone')}" maxlength="200" autocomplete="off" aria-label="${T('New item for everyone on the trip')}">
        <button type="submit" class="icon-btn filled ripple" aria-label="${T('Add')}">${icon('add')}</button>
      </form>
      ${todos.length ? `<ul class="group tasks">${[...todos.filter(c => !c.done), ...done].map(c => taskHTML(c, list)).join('')}</ul>` : ''}
    </section>`;
}

// One of the Checklist's lists, for the trip that is open: 'trip' is its list for everyone on it, 'own'
// its lines of the personal checklist, 'every' the personal lines for every trip (also the only list when
// no trip is open). Each says how its lines are ticked.
function listNamed(name) {
  const trip = activeTrip();
  if (name === 'trip' && trip) {
    return {
      name,
      get: () => trip.todos || [],
      // A line moved here from the personal checklist: everyone sees it, so nothing personal goes with it.
      set: (list) => { list.forEach((c) => { delete c.trip; delete c.doneOn; }); trip.todos = list; },
      ticked: c => c.done,
      tick: (c, on) => { c.done = on; },
    };
  }
  const every = name === 'every' || !trip;
  const mine = every ? (c => !c.trip) : (c => c.trip === trip.id);
  return {
    name: every ? 'every' : 'own',
    get: () => state.checklist.filter(mine),
    // The other lines (of this list's other kind, and of the other trips) stay as they are.
    set: (list) => {
      list.forEach((c) => { if (every) delete c.trip; else c.trip = trip.id; });
      state.checklist = [...state.checklist.filter(c => !mine(c) && !list.includes(c)), ...list];
    },
    ticked: c => (every ? !!trip && (c.doneOn || []).includes(trip.id) : c.done),
    tick: (c, on) => {
      if (!every) { c.done = on; return; }
      if (!trip) return;
      const others = (c.doneOn || []).filter(id => id !== trip.id);
      if (on) c.doneOn = [...others, trip.id];
      else if (others.length) c.doneOn = others;
      else delete c.doneOn;
      c.done = false;
    },
  };
}
// The list a checklist row, button or form belongs to: a row says it (a ticked one is drawn apart from its list).
function listAt(el) {
  const home = el.closest('[data-home]');
  const zone = el.closest('[data-list]');
  return listNamed(home ? home.dataset.home : zone ? zone.dataset.list : 'own');
}

// Before version 2.28 the checklist was one list for all trips, with one tick per line. Such a tick (also
// one made on a device still on an older version) now counts for the trip under way or coming next.
function settleChecks() {
  const trip = soonestTrip();          // archive.js
  if (!trip) return false;
  let changed = false;
  for (const c of state.checklist) {
    if (c.trip || !c.done) continue;
    c.doneOn = [...new Set([...(c.doneOn || []), trip.id])];
    c.done = false;
    changed = true;
  }
  return changed;
}

// A trip that goes away takes its own lines of the checklist with it, and its ticks on the others.
function dropTripChecks(id) {
  state.checklist = state.checklist.filter(c => c.trip !== id);
  for (const c of state.checklist) {
    if (!(c.doneOn || []).includes(id)) continue;
    c.doneOn = c.doneOn.filter(x => x !== id);
    if (!c.doneOn.length) delete c.doneOn;
  }
}

function renderChecklist() {
  const trip = activeTrip();
  const own = listNamed('own'), every = listNamed('every');
  const open = list => list.get().filter(c => !list.ticked(c));
  // Everything this trip asks of you: its own lines, and those for every trip.
  const lines = [...(trip ? own.get().map(c => [c, own]) : []), ...every.get().map(c => [c, every])];
  const done = lines.filter(([c, list]) => list.ticked(c));
  // What is being typed in "Add something…" survives a redraw (after ticking an item, or news from another device).
  const typedIn = (form) => { const el = $(`#view-pack [data-form="${form}"] input`); return el ? el.value : ''; };
  const typed = typedIn('check');
  const together = tripListHTML(trip, typedIn('todo'));
  const ownOpen = trip ? open(own) : [];
  const everyOpen = open(every);
  // The lists are the places a row can be dragged to (drag.js): data-list, and "tasks" for the open items.
  // With no trip open, there is only the list for every trip.
  $('#view-pack').innerHTML = `
    <h1 class="headline">${T('Checklist')}</h1>
    <p class="supporting">${trip ? T('Packing and to-dos for {trip}.', { trip: esc(tripName(trip)) }) : T('Things to take on every trip.')}</p>
    ${together}
    <section class="own-list" aria-label="${T('Your own checklist')}">
    ${together ? `<h2 class="group-label">${T('Just for you')}</h2>` : ''}
    ${trip && lines.length ? `
      <div class="progress-card">
        <div><span class="big">${done.length}</span><span class="of"> / ${lines.length}</span></div>
        <p>${done.length === lines.length ? (myName() ? T('All done, {name} — you’re ready to go!', { name: esc(myName()) }) : T('All done — you’re ready to go!')) : T('packed & done')}</p>
        ${progressBar(done.length / lines.length, T('Checklist progress'))}
      </div>` : ''}
    <div data-list="${trip ? 'own' : 'every'}">
      <form class="add-bar" data-form="check">
        <input name="text" value="${esc(typed)}" placeholder="${T('Add something to pack or do')}" maxlength="200" autocomplete="off" aria-label="${T('New checklist item')}">
        <button type="submit" class="icon-btn filled ripple" aria-label="${T('Add')}">${icon('add')}</button>
      </form>
      ${trip && ownOpen.length ? `<ul class="group tasks">${ownOpen.map(c => taskHTML(c, own)).join('')}</ul>` : ''}
      ${!trip && everyOpen.length ? `<ul class="group tasks">${everyOpen.map(c => taskHTML(c, every)).join('')}</ul>` : ''}
    </div>
    ${!lines.length ? emptyState('luggage', T('Nothing to pack yet'), T('Add chargers, tickets, snacks — anything you don’t want to forget.')) : ''}
    ${trip && lines.length ? `
      <div class="every-list" data-list="every">
        <h2 class="group-label">${T('On every trip')}</h2>
        <p class="supporting">${T('Ticked off separately on each trip.')} ${T('{how} here to keep it for every trip.', { how: dragHow() })}</p>
        ${everyOpen.length ? `<ul class="group tasks">${everyOpen.map(c => taskHTML(c, every)).join('')}</ul>` : ''}
      </div>` : ''}
    ${packingHTML(trip)}
    ${done.length ? `
      <div class="label-row">
        <h2 class="group-label">${T('Completed ({n})', { n: done.length })}</h2>
        ${done.some(([, list]) => list === own) ? `<button type="button" class="btn text ripple" data-action="clear-checked" data-home="own">${T('Clear')}</button>` : ''}
      </div>
      <ul class="group">${done.map(([c, list]) => taskHTML(c, list, list === every)).join('')}</ul>` : ''}
    </section>`;
}

// Adding to the checklist.
document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form="check"], [data-form="todo"]');
  if (!form) return;
  e.preventDefault();
  const text = form.elements.text.value.trim();
  if (!text) return;
  const list = listAt(form);
  list.set([...list.get(), { id: uid(), text, done: false }]);
  form.elements.text.value = '';
  save();
  render();
  $(`[data-form="${form.dataset.form}"] input`).focus();
});

// Ticking off, removing and clearing work on the list the row or button belongs to (listAt).
onAction('toggle-check', (el) => {
  const row = el.closest('[data-check]');
  const list = listAt(row);
  const c = list.get().find(x => x.id === row.dataset.check);
  if (!c) return;
  const on = !list.ticked(c);
  list.tick(c, on);
  save();
  tick(row, on);
});
onAction('del-check', (el) => {
  const row = el.closest('[data-check]');
  const list = listAt(row);
  const index = list.get().findIndex(x => x.id === row.dataset.check);
  if (index < 0) return;
  const removed = list.get()[index];
  list.set(list.get().filter(x => x !== removed));
  save();
  render();
  snackbar(list.name === 'every' ? T('Removed from every trip') : T('Item removed'), T('Undo'), () => {
    // Back where it was, unless the list changed meanwhile (someone else on the trip): then at the end.
    const now = list.get().slice();
    if (now.some(x => x.id === removed.id)) return;
    now.splice(Math.min(index, now.length), 0, removed);
    list.set(now);
    save();
    render();
  });
});
// Clears this trip's ticked lines. Those for every trip stay: they are needed again on the next one.
onAction('clear-checked', (el) => {
  const list = listAt(el);
  const cleared = list.get().filter(x => list.ticked(x));
  list.set(list.get().filter(x => !list.ticked(x)));
  save();
  render();
  snackbar(Tn(cleared.length, 'Cleared {n} item', 'Cleared {n} items'), T('Undo'), () => {
    const now = list.get();
    list.set([...now, ...cleared.filter(c => !now.some(x => x.id === c.id))]);
    save();
    render();
  });
});
