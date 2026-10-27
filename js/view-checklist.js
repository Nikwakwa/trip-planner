'use strict';

/* view-checklist.js — the Checklist section: the personal checklist, and the list of a trip planned
   with other people. */

function taskHTML(c) {
  return `
    <li class="task ${c.done ? 'done' : ''}" data-check="${esc(c.id)}" data-drag>
      <button type="button" class="check ripple" data-action="toggle-check" role="checkbox"
        aria-checked="${c.done}" aria-label="${T('Done: {name}', { name: esc(c.text) })}"><span class="box">${icon('check')}</span></button>
      <span class="task-text">${esc(c.text)}</span>
      <button type="button" class="icon-btn ripple" data-action="del-check" aria-label="${T('Remove {name}', { name: esc(c.text) })}">${icon('close')}</button>
    </li>`;
}

// A trip planned with other people has a list of its own: everyone on the trip sees it, adds to it and
// ticks things off. It is kept with the trip (trip.todos), apart from the checklist, which stays personal.
function tripListHTML(trip, typed) {
  if (!trip || !(trip.shared || (trip.todos && trip.todos.length))) return '';
  const todos = trip.todos || [];
  const done = todos.filter(c => c.done);
  return `
    <section class="trip-list" data-list="trip" aria-label="${T('List for everyone on {trip}', { trip: esc(trip.name) })}">
      <div class="label-row">
        <h2 class="group-label">${icon('group', 'sm')}${esc(trip.name)}${trip.shared ? T(', together') : ''}${todos.length ? ` · ${done.length}/${todos.length}` : ''}</h2>
        ${done.length ? `<button type="button" class="btn text ripple" data-action="clear-checked">${T('Clear done')}</button>` : ''}
      </div>
      ${trip.shared ? `<p class="supporting">${T('Everyone on this trip sees this list, adds to it and ticks things off.')}
        ${T('{how} to move it between this list and yours.', { how: `<span class="touch-only">${T('Hold an item and drag it')}</span><span class="mouse-only">${T('Drag an item')}</span>` })}</p>` : ''}
      <form class="add-bar" data-form="todo">
        <input name="text" value="${esc(typed)}" placeholder="${T('Add something for everyone')}" maxlength="200" autocomplete="off" aria-label="${T('New item for everyone on the trip')}">
        <button type="submit" class="icon-btn filled ripple" aria-label="${T('Add')}">${icon('add')}</button>
      </form>
      ${todos.length ? `<ul class="group tasks">${[...todos.filter(c => !c.done), ...done].map(taskHTML).join('')}</ul>` : ''}
    </section>`;
}

// One of the Checklist's two lists: 'trip' is the open trip's own (for everyone on it), 'own' the personal one.
function listNamed(name) {
  const trip = name === 'trip' ? activeTrip() : null;
  return trip
    ? { get: () => trip.todos || [], set: (list) => { trip.todos = list; } }
    : { get: () => state.checklist, set: (list) => { state.checklist = list; } };
}
// The list a checklist row, button or form belongs to.
const listAt = el => listNamed(el.closest('[data-list="trip"]') ? 'trip' : 'own');

function renderChecklist() {
  const list = state.checklist;
  const todo = list.filter(c => !c.done);
  const done = list.filter(c => c.done);
  // What is being typed in "Add something…" survives a redraw (after ticking an item, or news from another device).
  const typedIn = (form) => { const el = $(`#view-pack [data-form="${form}"] input`); return el ? el.value : ''; };
  const typed = typedIn('check');
  const together = tripListHTML(activeTrip(), typedIn('todo'));
  // The two lists are the places a row can be dragged to (drag.js): data-list, and "tasks" for the open items.
  $('#view-pack').innerHTML = `
    <h1 class="headline">${T('Checklist')}</h1>
    <p class="supporting">${T('Packing and to-dos for the whole trip.')}</p>
    ${together}
    <section class="own-list" data-list="own" aria-label="${T('Your own checklist')}">
    ${together ? `<h2 class="group-label">${T('Just for you')}</h2>` : ''}
    ${list.length ? `
      <div class="progress-card">
        <div><span class="big">${done.length}</span><span class="of"> / ${list.length}</span></div>
        <p>${done.length === list.length ? T('All done — you’re ready to go!') : T('packed & done')}</p>
        ${progressBar(done.length / list.length, T('Checklist progress'))}
      </div>` : ''}
    <form class="add-bar" data-form="check">
      <input name="text" value="${esc(typed)}" placeholder="${T('Add something to pack or do')}" maxlength="200" autocomplete="off" aria-label="${T('New checklist item')}">
      <button type="submit" class="icon-btn filled ripple" aria-label="${T('Add')}">${icon('add')}</button>
    </form>
    ${todo.length ? `<ul class="group tasks">${todo.map(taskHTML).join('')}</ul>` : ''}
    ${!list.length ? emptyState('luggage', T('Nothing to pack yet'), T('Add chargers, tickets, snacks — anything you don’t want to forget.')) : ''}
    ${packingHTML(activeTrip())}
    ${done.length ? `
      <div class="label-row">
        <h2 class="group-label">${T('Completed ({n})', { n: done.length })}</h2>
        <button type="button" class="btn text ripple" data-action="clear-checked">${T('Clear')}</button>
      </div>
      <ul class="group">${done.map(taskHTML).join('')}</ul>` : ''}
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

// Ticking off, removing and clearing work on the personal checklist, or on the trip's own list (listAt).
onAction('toggle-check', (el) => {
  const row = el.closest('[data-check]');
  const c = listAt(el).get().find(x => x.id === row.dataset.check);
  if (!c) return;
  c.done = !c.done;
  save();
  tick(row, c.done);
});
onAction('del-check', (el) => {
  const list = listAt(el);
  const index = list.get().findIndex(x => x.id === el.closest('[data-check]').dataset.check);
  if (index < 0) return;
  const [removed] = list.get().splice(index, 1);
  save();
  render();
  snackbar(T('Item removed'), T('Undo'), () => {
    // Back where it was, unless the list changed meanwhile (someone else on the trip): then at the end.
    const now = list.get().slice();
    if (now.some(x => x.id === removed.id)) return;
    now.splice(Math.min(index, now.length), 0, removed);
    list.set(now);
    save();
    render();
  });
});
onAction('clear-checked', (el) => {
  const list = listAt(el);
  const cleared = list.get().filter(x => x.done);
  list.set(list.get().filter(x => !x.done));
  save();
  render();
  snackbar(Tn(cleared.length, 'Cleared {n} item', 'Cleared {n} items'), T('Undo'), () => {
    const now = list.get();
    list.set([...now, ...cleared.filter(c => !now.some(x => x.id === c.id))]);
    save();
    render();
  });
});
