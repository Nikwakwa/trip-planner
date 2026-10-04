'use strict';

/* =========================================================
   Drag to plan: hold a plan (or an idea in the tray at the top) for a
   moment, then drag it onto a day, or to another spot in the same day.
   Dropping a plan on the ideas tray takes it off the schedule.
   Plans with a set time stay in time order; the others keep the spot
   they're dropped in (saved as a "slot", like Optimize route does).
   Functions here use helpers from app.js, which is loaded after this file.
   ========================================================= */

const HOLD_MS = 350;
const drag = { timer: 0, src: null, id: null, active: false, x: 0, y: 0, startX: 0, startY: 0, ghost: null, line: null, target: null, raf: 0, noClick: false };

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || drag.active || ui.view !== 'plan') return;
  const el = e.target.closest('[data-drag]');
  if (!el || e.target.closest('.check, a')) return;
  drag.src = el;
  drag.id = el.dataset.id;
  drag.x = drag.startX = e.clientX;
  drag.y = drag.startY = e.clientY;
  drag.mouse = e.pointerType === 'mouse';
  drag.armed = true;
  clearTimeout(drag.timer);
  // A finger starts a drag by holding still. A mouse starts it by moving (below): holding the
  // button a little long is still just a click.
  drag.timer = drag.mouse ? 0 : setTimeout(startDrag, HOLD_MS);
});

document.addEventListener('pointermove', (e) => {
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (drag.active) { moveDrag(); return; }
  if (!drag.armed) return;
  if (drag.mouse && !(e.buttons & 1)) { cancelHold(); return; }      // the button was let go outside the window
  if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) <= 8) return;
  // With a mouse, moving while pressed is the drag. With a finger, moving before the hold is a scroll.
  if (drag.mouse) startDrag(); else cancelHold();
});

document.addEventListener('pointerup', () => { if (drag.active) endDrag(true); else cancelHold(); });
document.addEventListener('pointercancel', () => { if (drag.active) endDrag(false); else cancelHold(); });
// While dragging, the finger moves the plan instead of scrolling the page.
document.addEventListener('touchmove', (e) => { if (drag.active) e.preventDefault(); }, { passive: false });
// No long-press menu on draggable things.
document.addEventListener('contextmenu', (e) => { if (drag.active || e.target.closest('[data-drag]')) e.preventDefault(); });
// The tap that ends a drag shouldn't also open the plan it lands on (Undo stays tappable).
document.addEventListener('click', (e) => {
  if (!drag.noClick || !e.target.closest('#main')) return;
  drag.noClick = false;
  e.stopPropagation();
  e.preventDefault();
}, true);

function cancelHold() {
  clearTimeout(drag.timer);
  drag.timer = 0;
  drag.armed = false;
}

function startDrag() {
  drag.timer = 0;
  drag.armed = false;
  if (!drag.src || !drag.src.isConnected) return;
  drag.active = true;
  const r = drag.src.getBoundingClientRect();
  const ghost = drag.src.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.removeAttribute('data-drag');
  ghost.style.width = `${r.width}px`;
  ghost.style.left = `${r.left}px`;
  ghost.style.top = `${r.top}px`;
  drag.offX = drag.x - r.left;
  drag.offY = drag.y - r.top;
  document.body.append(ghost);
  drag.ghost = ghost;
  drag.src.classList.add('drag-src');
  document.body.classList.add('dragging');
  window.getSelection().removeAllRanges();
  if (navigator.vibrate) navigator.vibrate(15);
  moveDrag();
  drag.raf = requestAnimationFrame(autoScroll);
}

// Near the top or bottom of the screen, the page scrolls to reach other days.
function autoScroll() {
  if (!drag.active) return;
  const edge = 96;
  const top = 72, bottom = innerHeight - 96;
  let speed = 0;
  if (drag.y < top + edge) speed = -Math.min(18, (top + edge - drag.y) / 4);
  else if (drag.y > bottom - edge) speed = Math.min(18, (drag.y - (bottom - edge)) / 4);
  if (speed) {
    window.scrollBy(0, speed);
    findTarget();
  }
  drag.raf = requestAnimationFrame(autoScroll);
}

function moveDrag() {
  drag.ghost.style.transform = `translate(${drag.x - drag.offX - parseFloat(drag.ghost.style.left)}px, ${drag.y - drag.offY - parseFloat(drag.ghost.style.top)}px) rotate(-1.5deg)`;
  findTarget();
}

function clearMarks() {
  if (drag.line) drag.line.remove();
  document.querySelectorAll('.drop-on').forEach(el => el.classList.remove('drop-on'));
}

// What's under the finger: a spot in a day's list, an empty day, or the ideas tray.
function findTarget() {
  const under = document.elementFromPoint(drag.x, drag.y);
  const tray = under && under.closest('.idea-tray');
  const dayEl = under && under.closest('.day');
  const item = activeTrip() && activeTrip().items.find(i => i.id === drag.id);
  let target = null;

  if (tray && item && item.date) {
    target = { kind: 'ideas', el: tray };
  } else if (dayEl) {
    const day = dayEl.id.slice(4);
    const list = dayEl.querySelector('ul.group');
    if (list) {
      const rows = [...list.querySelectorAll(':scope > .item[data-id]')].filter(li => li.dataset.id !== drag.id);
      let index = 0;
      for (const li of rows) {
        const r = li.getBoundingClientRect();
        if (drag.y > r.top + r.height / 2) index++;
      }
      target = { kind: 'day', day, index, list, before: rows[index] || null };
    } else {
      target = { kind: 'day', day, index: 0, el: dayEl.querySelector('.empty-day') || dayEl };
    }
  }

  const same = (a, b) => a && b && a.kind === b.kind && a.day === b.day && a.index === b.index;
  if (same(target, drag.target) && (!drag.line || drag.line.isConnected)) return;
  drag.target = target;
  clearMarks();
  if (!target) return;
  if (target.list) {
    drag.line = drag.line || Object.assign(document.createElement('li'), { className: 'drop-line' });
    drag.line.setAttribute('aria-hidden', 'true');
    target.list.insertBefore(drag.line, target.before);
  } else {
    target.el.classList.add('drop-on');
  }
}

function endDrag(drop) {
  cancelAnimationFrame(drag.raf);
  const target = drag.target;
  clearMarks();
  if (drag.ghost) drag.ghost.remove();
  if (drag.src) drag.src.classList.remove('drag-src');
  document.body.classList.remove('dragging');
  drag.active = false;
  drag.ghost = null;
  drag.target = null;
  drag.noClick = true;
  setTimeout(() => { drag.noClick = false; }, 400);
  if (drop && target) dropOn(target);
}

function dropOn(target) {
  const trip = activeTrip();
  const item = trip && trip.items.find(i => i.id === drag.id);
  if (!item) return;
  const before = trip.items.map(i => [i, i.date, i.slot]);
  let message;

  if (target.kind === 'ideas') {
    item.date = '';
    delete item.slot;
    message = 'Moved back to ideas';
  } else {
    const fromDay = item.date;
    const was = fromDay === target.day ? dayItems(trip, target.day) : null;
    item.date = target.day;
    // The day's plans in their new order. It holds if the plans with a time are still in time order:
    // then the plans without a time are numbered where they now sit, after the timed plan before them.
    const order = dayItems(trip, target.day).filter(i => i !== item);
    order.splice(target.index, 0, item);
    // Put back where it was: nothing changes.
    if (was && order.every((it, k) => it === was[k])) { render(); return; }
    const timed = order.filter(i => i.time);
    const inTimeOrder = timed.every((it, k) => !k || timed[k - 1].time <= it.time);
    if (inTimeOrder) {
      let anchor = '00:00', n = 0;
      for (const it of order) {
        if (it.time) { anchor = it.time; n = 0; }
        else it.slot = `${anchor}~${String(++n).padStart(2, '0')}`;
      }
    } else if (fromDay === target.day) {
      // A timed plan dropped on the wrong side of another timed plan: it can't go there.
      render();
      snackbar(`Stays at ${fmtTime(item.time)}, in time order with the day’s other timed plans`);
      return;
    }
    message = fromDay === target.day ? 'Moved'
      : `Moved to ${fmtDay(target.day, { weekday: 'long' })}${item.time ? `, ${fmtTime(item.time)}` : ''}`;
  }

  const changed = before.some(([i, date, slot]) => i.date !== date || i.slot !== slot);
  render();
  if (!changed) return;
  save();
  if (navigator.vibrate) navigator.vibrate(10);
  snackbar(message, 'Undo', () => {
    for (const [i, date, slot] of before) {
      i.date = date;
      if (slot === undefined) delete i.slot; else i.slot = slot;
    }
    save();
    render();
  });
}
