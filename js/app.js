'use strict';

/* app.js — starting the app: installing it, working offline, new versions, and coming back to it
   after a while. Loaded last: everything else is there by then. */

/* ---------- Offline & install support ---------- */

let installPrompt = null;      // Chrome hands us this when the app can be installed
let storagePersisted = false;
// iPhones and iPads never offer to install: Settings explains how instead.
const onIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (ui.view === 'more') render();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  snackbar(T('Installed! Find Dotted Line on your home screen.'));
});

onAction('install', () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  installPrompt.userChoice.finally(() => { installPrompt = null; render(); });
});

function updateOnlineBadge() { $('#offline-badge').hidden = navigator.onLine; }
function onConnectionChange() {
  updateOnlineBadge();
  // Back online: look up places and guides that couldn't be fetched offline,
  // and give the ones that failed (often because the connection dropped) another try.
  if (navigator.onLine) {
    placeTried.clear();
    for (const [key, status] of guideStatus) if (status === 'failed') guideStatus.delete(key);
    for (const [key, status] of essentials.status) if (status === 'failed') essentials.status.delete(key);
    planInfo.failed.clear();
  }
  $('#ai-send').disabled = ai.busy || !aiReady() || !navigator.onLine;
  render();
  renderShare();      // share.js: inviting people needs a connection
}
window.addEventListener('online', onConnectionChange);
window.addEventListener('offline', onConnectionChange);
updateOnlineBadge();

if ('serviceWorker' in navigator) {
  const hadOldVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // Android often resumes the app instead of restarting it, so also
      // check for a new version every time the app comes back on screen.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(err => console.warn('Offline mode unavailable', err));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadOldVersion) snackbar(T('A new version is ready'), T('Reload'), () => location.reload(), 15000);
  });
}

// Ask Android not to clear our saved data when the phone is low on space.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted()
    .then(p => p || navigator.storage.persist())
    .then(p => { storagePersisted = p; if (ui.view === 'more') render(); })
    .catch(() => {});
}

// The big + button: a new plan on today during the trip, else on its first day; a new idea on Ideas.
$('#fab').addEventListener('click', () => {
  if (ui.view === 'ideas') return openItemForm(null, { date: '' });
  const trip = activeTrip();
  const today = todayISO();
  const inTrip = trip.start && today >= trip.start && today <= trip.end;
  openItemForm(null, { date: inTrip ? today : (trip.start || '') });
});

/* ---------- Start ---------- */

// Scrolling is handled per section (showView). After a reload, open the section that was showing.
history.scrollRestoration = 'manual';
ui.view = pageView();
translatePage();   // i18n.js: the page's own texts, in the app's language
render();
startSync();
loadFileIndex();   // files.js: which plans have tickets attached
checkInviteLink(); // share.js: opened from an invitation to a trip

// After an update: say so once, with a way to see what changed. (Not on the very first visit.)
if (state.settings.seenVersion !== APP_VERSION) {
  const updated = !!state.settings.seenVersion;
  state.settings.seenVersion = APP_VERSION;
  saveLocal();
  if (updated) snackbar(T('Updated to version {v}', { v: APP_VERSION }), T('What’s new'), openChangelog, 10000);
}

// "?selfcheck" in the address: test the parts that must not break (selfcheck.js), and show the result.
if (new URLSearchParams(location.search).has('selfcheck')) {
  loadScript('js/selfcheck.js').then(() => showSelfCheck()).catch(err => console.warn(err));
}

// If the trip is happening now, jump to today's card.
function jumpToToday() {
  const card = document.getElementById('day-' + todayISO());
  if (!card) return;
  card.scrollIntoView({ block: 'start' });
  showFabs();     // this jump isn't the user scrolling down: the + and AI buttons stay
}
jumpToToday();
repinNumbered();   // maps.js: a one-time repair of some pins

// A phone keeps the app open for days. Back on screen it is drawn again: "today", "now and next" and
// the forecast move on. On a new day the plan opens on that day, like at a fresh start.
let shownDay = todayISO();
let hiddenAt = Date.now();
function catchUp() {
  const day = todayISO();
  const newDay = day !== shownDay;
  if (!newDay && Date.now() - hiddenAt < 5 * 60e3) return;      // a quick look at another app
  shownDay = day;
  const busy = document.querySelector('dialog[open]') || document.body.classList.contains('dragging')
    || /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName);
  if (!newDay || busy || ui.view !== 'plan') { renderSoon(); return; }
  render();
  jumpToToday();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') catchUp();
  else hiddenAt = Date.now();
});
// Left open on screen past midnight.
setInterval(() => {
  if (document.visibilityState === 'visible' && todayISO() !== shownDay) catchUp();
}, 60000);
