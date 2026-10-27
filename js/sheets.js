'use strict';

/* sheets.js — closing a sheet: its ✕, a tap outside, a swipe down, Esc or the device's Back, asking
   first when something typed in it would be lost. */

// Sheets to type in. Closed any other way than by saving (the ✕, a tap outside, a swipe down, Esc, the
// device's Back), they ask first when something in them was changed since they opened.
const DRAFTS = new Map([
  [itemDialog, { form: itemForm, ask: () => editingItemId
    ? { title: T('Discard your changes?'), text: T('The plan stays as it was.') }
    : { title: T('Discard this plan?'), text: T('What you entered hasn’t been saved.') } }],
  [tripDialog, { form: tripForm, ask: () => editingTripId
    ? { title: T('Discard your changes?'), text: T('The trip stays as it was.') }
    : { title: T('Discard this trip?'), text: T('What you entered hasn’t been saved.') } }],
  [$('#report-dialog'), { form: $('#report-form'), ask: () => ({ title: T('Discard your message?'), text: T('It hasn’t been sent.') }) }],
  [$('#vote-dialog'), { form: $('#vote-form'), ask: () => ({ title: T('Discard your idea?'), text: T('It hasn’t been sent.') }) }],
]);

// What a sheet's form holds (in the plan form, with the files attached or removed).
function draftOf(dlg) {
  const { form } = DRAFTS.get(dlg);
  const values = [...new FormData(form)].filter(([, v]) => typeof v === 'string');
  const files = form === itemForm && tickets.form ? [tickets.form.added.length, tickets.form.removed.size] : [];
  return JSON.stringify([values, files]);
}

// Called once a sheet is open and filled in: what it holds then is "nothing changed".
function draftStart(dlg) {
  DRAFTS.get(dlg).start = draftOf(dlg);
}

function draftChanged(dlg) {
  const d = DRAFTS.get(dlg);
  return !!d && dlg.open && d.start !== undefined && draftOf(dlg) !== d.start;
}

// Closes a sheet, unless something typed in it would be lost and the user keeps it.
async function closeSheet(dlg) {
  if (draftChanged(dlg)) {
    const ok = await askConfirm({ icon: 'edit', ...DRAFTS.get(dlg).ask(), ok: T('Discard'), cancel: T('Keep editing') });
    if (!ok) return;
  }
  if (dlg.open) dlg.close();
}

for (const dlg of DRAFTS.keys()) {
  // Esc is caught before it becomes the dialog's "cancel": the browser lets a page stop that only once
  // per tap or key typed, so the second Esc would close the sheet without asking.
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && draftChanged(dlg)) { e.preventDefault(); closeSheet(dlg); }
  });
  // The device's Back.
  dlg.addEventListener('cancel', (e) => {
    if (e.cancelable && draftChanged(dlg)) { e.preventDefault(); closeSheet(dlg); }
  });
}

// Close buttons close a sheet, and so does a tap on the dark area around it: one that starts and ends
// there. Selecting text and letting go outside the sheet is not one (that click goes to the dialog itself).
for (const dlg of document.querySelectorAll('dialog')) {
  let outside = false;
  dlg.addEventListener('pointerdown', (e) => { outside = e.target === dlg; });
  dlg.addEventListener('pointerup', (e) => { outside = outside && e.target === dlg; });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || (e.target === dlg && outside)) closeSheet(dlg);
  });
}

/* ---------- Swiping a sheet down closes it (touch screens, phone layout) ---------- */

const pull = { dlg: null, x: 0, y: 0, dy: 0, lastY: 0, lastAt: 0, speed: 0, on: false };

// A pull can start on the sheet's top (handle, title) at any time, and elsewhere only when everything
// under the finger is scrolled to its top. Never on the map or in a field (that's panning or selecting text).
function canPull(dlg, target) {
  if (target.closest('.handle, .sheet-head')) return true;
  if (target.closest('#map, .pad, input, textarea, select')) return false;
  for (let el = target; el && el !== dlg.parentElement; el = el.parentElement) {
    if (el.scrollTop > 0) return false;
  }
  return true;
}

document.addEventListener('touchstart', (e) => {
  pull.dlg = null;
  const dlg = e.target.closest('dialog.sheet');
  if (!dlg || e.touches.length !== 1 || matchMedia('(min-width: 900px)').matches || !canPull(dlg, e.target)) return;
  const t = e.touches[0];
  Object.assign(pull, { dlg, x: t.clientX, y: t.clientY, dy: 0, lastY: t.clientY, lastAt: e.timeStamp, speed: 0, on: false });
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  const dlg = pull.dlg;
  if (!dlg) return;
  const t = e.touches[0];
  const dy = t.clientY - pull.y;
  if (!pull.on) {
    // The first move decides: straight down pulls the sheet, anything else is a scroll or a sideways swipe.
    if (dy <= 0 || Math.abs(t.clientX - pull.x) > dy || !e.cancelable) { pull.dlg = null; return; }
    pull.on = true;
    dlg.style.transition = 'none';
  }
  if (e.cancelable) e.preventDefault();
  if (e.timeStamp > pull.lastAt) pull.speed = (t.clientY - pull.lastY) / (e.timeStamp - pull.lastAt);
  pull.lastY = t.clientY;
  pull.lastAt = e.timeStamp;
  pull.dy = Math.max(0, dy);
  dlg.style.transform = `translateY(${pull.dy}px)`;
}, { passive: false });

// Let go: far enough down (or flicked down) closes the sheet, otherwise it slides back up. A sheet
// with something typed in it slides back up and asks.
function endPull(e) {
  const dlg = pull.dlg;
  pull.dlg = null;
  if (!dlg || !pull.on) return;
  const close = e.type === 'touchend' && (pull.dy > Math.min(140, dlg.offsetHeight / 3) || (pull.speed > 0.5 && pull.dy > 24));
  const ask = close && draftChanged(dlg);
  dlg.style.transition = 'transform .2s var(--ease)';
  dlg.style.transform = close && !ask ? 'translateY(100%)' : 'none';
  setTimeout(() => {
    if (ask) closeSheet(dlg);
    else if (close && dlg.open) dlg.close();
    dlg.style.transition = dlg.style.transform = '';
  }, 200);
}
document.addEventListener('touchend', endPull);
document.addEventListener('touchcancel', endPull);
