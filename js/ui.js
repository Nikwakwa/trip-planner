'use strict';

/* ui.js — pieces of the screen shared by every section: shapes, empty states, photos of places, the
   message bar (snackbar), the confirmation dialog, the theme colors, ticking things off and the touch ripple. */

/* ---------- Expressive "cookie" shape ---------- */

// A circle with gentle scalloped edges, like the shapes on Pixel phones.
function cookiePath(size, lobes, depth) {
  const r = size / 2;
  const pts = [];
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * 2 * Math.PI;
    const rr = r * (1 - depth) + r * depth * Math.cos(lobes * a);
    pts.push(`${(r + rr * Math.sin(a)).toFixed(2)} ${(r - rr * Math.cos(a)).toFixed(2)}`);
  }
  return 'M' + pts.join('L') + 'Z';
}
const HERO_SHAPE = cookiePath(100, 12, 0.045);
const EMPTY_SHAPE = cookiePath(100, 9, 0.06);

const shape = (d, cls) => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><path d="${d}"/></svg>`;

function emptyState(ic, title, text, action = '') {
  return `
    <div class="empty-state">
      <div class="empty-art">${shape(EMPTY_SHAPE, 'shape')}${icon(ic)}</div>
      <h2>${title}</h2>
      <p>${text}</p>
      ${action}
    </div>`;
}

function progressBar(fraction, label) {
  const p = Math.max(0, Math.min(1, fraction));
  return `
    <div class="progress" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}">
      ${p > 0 ? `<span class="on" style="flex-grow:${p}"></span>` : ''}
      ${p < 1 ? `<span class="off" style="flex-grow:${1 - p}"></span>` : ''}
    </div>`;
}

/* ---------- Photos of guide places (from Wikimedia, when the guide has one) ---------- */

const photoImg = (p, cls) => (p.photo
  ? `<img class="${cls}" data-photo src="${esc(p.photo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '');
// A photo that can't load (offline, or the file is gone) is taken out, with its caption.
document.addEventListener('error', (e) => {
  if (e.target.matches && e.target.matches('img[data-photo]')) (e.target.closest('figure') || e.target).remove();
}, true);

// A small square photo in lists, with the category icon underneath in case it doesn't load.
function placeThumb(p, cat) {
  return `<span class="avatar thumb" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}${photoImg(p, '')}</span>`;
}

function whenTag(p) {
  if (p.when === 'morning') return `<span class="tag">${icon('wb_sunny')}${T('Morning')}</span>`;
  if (p.when === 'evening') return `<span class="tag">${icon('bedtime')}${T('Evening')}</span>`;
  if (p.tags.includes('rainy')) return `<span class="tag">${icon('umbrella')}${T('Indoors')}</span>`;
  return '';
}

/* ---------- Snackbar (message bar at the bottom, with optional Undo) ---------- */

let snackTimer;
function snackbar(msg, actionLabel, onTap, duration) {
  const bar = $('#snackbar');
  const btn = $('#snackbar-action');
  $('#snackbar-msg').textContent = msg;
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  btn.onclick = () => { hideSnackbar(); onTap && onTap(); };
  bar.classList.add('show');
  document.body.classList.add('snack-open');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnackbar, duration || (actionLabel ? 5000 : 2800));
}
function hideSnackbar() {
  $('#snackbar').classList.remove('show');
  document.body.classList.remove('snack-open');
}

/* ---------- Confirmation dialog for big decisions ---------- */

function askConfirm({ icon: ic, title, text, ok, cancel = T('Cancel') }) {
  const dlg = $('#confirm-dialog');
  $('#confirm-icon').setAttribute('href', `${SPRITE}#${ic}`);
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = ok;
  $('#confirm-cancel').textContent = cancel;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise(resolve =>
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

/* ---------- Theme: the trip's color drives the whole palette ---------- */

const colorCanvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function toHex(css) {
  colorCanvas.fillStyle = '#000';
  colorCanvas.fillStyle = css;
  colorCanvas.fillRect(0, 0, 1, 1);
  const [r, g, b] = colorCanvas.getImageData(0, 0, 1, 1).data;
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Light or dark: your choice in Settings → Appearance, or the phone's setting when "Automatic".
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyAppearance() {
  const t = state.settings.theme;
  document.documentElement.dataset.theme =
    (t === 'light' || t === 'dark') ? t : (darkQuery.matches ? 'dark' : 'light');
  setMapTheme();      // maps.js: the map is light or dark too
}
darkQuery.addEventListener('change', () => render());

function applyTheme(seed) {
  applyAppearance();
  document.documentElement.style.setProperty('--seed', seed);
  // Paint Android's status bar to match the app background.
  const bg = getComputedStyle($('#theme-probe')).backgroundColor;
  $('meta[name="theme-color"]').setAttribute('content', toHex(bg));
}

/* ---------- Date fields ---------- */

// A browser's date field writes the date the device's way ("12/26/2026" on an American computer), whatever
// the app's Date setting says. So the field's own text is hidden and the date is written over it in the app's
// style ("26 Dec 2026"); tapping still opens the device's own calendar. Typing the date with the keyboard
// shows the field's own text again until it loses focus.
const shownDate = v => (isDate(v) ? fmtDay(v, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
function dressDateField(input) {
  const label = document.createElement('span');
  label.className = 'date-shown';
  label.setAttribute('aria-hidden', 'true');
  input.after(label);
  input.classList.add('dressed');
  const show = () => { label.textContent = shownDate(input.value); };
  // The forms fill their fields by setting `value`, which sends no event: catch it here.
  const own = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return own.get.call(this); },
    set(v) { own.set.call(this, v); show(); },
  });
  input.addEventListener('input', show);
  input.addEventListener('change', show);
  input.addEventListener('keydown', (e) => {
    if (/^(\d|Backspace|Delete|ArrowUp|ArrowDown)$/.test(e.key)) input.classList.add('typing');
  });
  input.addEventListener('blur', () => input.classList.remove('typing'));
  // With a mouse, a click on the date would only pick its month or day to type: open the calendar instead.
  input.addEventListener('click', () => {
    if (matchMedia('(pointer: fine)').matches && input.showPicker) try { input.showPicker(); } catch { /* already open */ }
  });
  show();
}
document.querySelectorAll('input[type="date"]').forEach(dressDateField);

/* ---------- Ticking things off (animated in place, then re-sorted) ---------- */

let rerenderTimer;
function tick(el, done) {
  el.classList.toggle('done', done);
  el.querySelector('.check').setAttribute('aria-checked', done);
  if (done && navigator.vibrate) navigator.vibrate(12);
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(renderSoon, 550);     // not while typing the next checklist item
}

/* ---------- Touch ripple ---------- */

document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.ripple');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const size = Math.hypot(r.width, r.height) * 2;
  const wave = document.createElement('span');
  wave.className = 'wave';
  wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  el.append(wave);
  wave.addEventListener('animationend', () => wave.remove());
});
