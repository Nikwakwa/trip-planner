'use strict';

/* about.js — Settings → About: the privacy note, What's new, and Report a problem. */

function openPrivacy() {
  const part = (ic, title, lines) => `
    <section class="tip">
      <h3>${icon(ic)}${title}</h3>
      ${lines.filter(Boolean).map(l => `<p>${l}</p>`).join('')}
    </section>`;
  $('#about-title').textContent = T('Privacy');
  $('#about-body').innerHTML = [
    part('offline_pin', T('On this device'), [
      T('Your trips, plans and checklist are saved on this device. Tickets you attach and your settings are kept here only.'),
    ]),
    sync.configured && part('sync', T('In your account'), [
      T('If you sign in, your email address, trips, plans and checklist are also stored with Google Firebase, so that your devices share them.'),
      T('The person who runs this copy of the app can see them there. Your password is stored scrambled: nobody can read it.'),
      T('A trip you plan with other people is stored there once, for all of you. Everyone on it sees its plans, the list for everyone in the Checklist, who gave a heart to which idea, and the email addresses of the others. Your own checklist and your other trips stay yours. Tickets and other files can’t be shared: they never leave the device.'),
      T('Your votes for new features, and the suggestions you send, are stored there too. Everyone who is signed in can read the suggestions, without your name or email.'),
    ]),
    part('public', T('Sent to other services'), [
      T('To do its job, the app asks free outside services. They get only what the question needs, never your account.'),
      T('<b>OpenStreetMap services</b> (Photon, Nominatim, Overpass): the places you search for, and the names and addresses of your plans, to put them on the map and find opening hours. On a day by car, <b>OpenStreetMap’s routing server</b> (run by FOSSGIS) gets the map positions of that day’s stops, your stay included, for the real distance and time by road. “Find addresses and opening hours” in Settings switches these automatic lookups off.'),
      T('<b>Wikivoyage, Wikipedia and Wikidata</b>: your destination and the area around your plans, for guides, photos and essentials. <b>Open-Meteo</b>: your destination, or the area of a day’s stay and plans, for the weather.'),
      T('<b>The map</b> (OpenFreeMap, CARTO or OpenStreetMap): the part of the map you look at.'),
      aiReady() && T('<b>Google Gemini</b>: when you send a message to the AI Assistant, the message and that trip’s plans. “Flag plans that sell out” in Settings sends the names of your plans. Google’s reCAPTCHA checks that these requests really come from the app.'),
      window.REPORT_KEY && T('<b>Web3Forms</b> (an email service): when you send “Report a problem”, what you wrote, your email if you gave it, the app’s version and the kind of device. It reaches the person who runs this copy of the app.'),
      T('Your location (“Near me”) is used on this device only.'),
      T('Like any website, the app’s host (GitHub) sees your device’s internet address when the app loads.'),
    ]),
    part('shield', T('No ads, no tracking'), [
      T('The app has no ads and no visitor statistics, and your plans are not sold or shared.'),
    ]),
    part('delete', T('Removing your data'), [
      sync.configured ? T('<b>Erase everything</b> (Settings) clears this device, and your account’s trips when you are signed in. <b>Delete account</b> removes your login and everything stored in it.') : T('<b>Erase everything</b> (Settings) clears this device.'),
    ]),
  ].filter(Boolean).join('');
  $('#about-dialog').showModal();
  $('#about-body').scrollTop = 0;
}

// "What's new": the versions (version.js), newest first. Each one the same way: its number, its date,
// what is new. Only the latest few show at first; the rest open with "Earlier versions".
const VERSIONS_SHOWN = 5;
function openChangelog() {
  $('#about-title').textContent = T('What’s new');
  $('#about-body').innerHTML = CHANGELOG.map((c, i) => `
    <section class="tip version" ${i < VERSIONS_SHOWN ? '' : 'hidden'}>
      <h3>${T('Version {v}', { v: esc(c.v) })}</h3>
      <p class="version-when">${esc(fmtDay(c.date, { day: 'numeric', month: 'short', year: 'numeric' }))}${i ? '' : ` · <span class="ok">${T('on this device')}</span>`}</p>
      <ul>${c.items.map(t => `<li>${esc(T(t))}</li>`).join('')}</ul>
    </section>`).join('')
    + (CHANGELOG.length > VERSIONS_SHOWN ? `<button type="button" class="btn tonal ripple older-versions" data-action="older-versions">${T('Earlier versions')}</button>` : '');
  $('#about-dialog').showModal();
  $('#about-body').scrollTop = 0;
}

/* ---------- Report a problem ----------
   A form: what went wrong, in the user's words, plus what helps to find it (version, kind of
   device, state of the app, the last errors). With window.REPORT_KEY set (firebase-config.js)
   it is emailed to the owner through Web3Forms. Without it, or when sending fails, the same text
   goes out through the device's Share menu. */

const REPORT_URL = 'https://api.web3forms.com/submit';
const reportDialog = $('#report-dialog');
const reportForm = $('#report-form');
let reportSentAt = 0;

// What goes with the user's words. Counts and settings, never the plans themselves.
// They stay in English, whatever the app's language: they are for the person who looks after the app.
function problemDetails() {
  const plans = state.trips.reduce((n, t) => n + t.items.length, 0);
  const account = !sync.configured ? 'sync not set up'
    : !sync.saved ? 'not signed in'
    : `signed in, sync ${sync.status}${sync.error ? ` (${sync.error})` : ''}, ${plural(waitingCount(), 'change')} waiting, `
      + (sharing.off ? 'sharing not switched on' : `${plural(state.trips.filter(t => t.shared).length, 'shared trip')}`);
  return [
    `Version: ${APP_VERSION}`,
    `Device: ${navigator.userAgent}`,
    `Window: ${innerWidth}×${innerHeight}, ${installed() ? 'installed' : 'in the browser'}, ${navigator.onLine ? 'online' : 'offline'}, language ${navigator.language || '?'}, app in ${LANG}`,
    `App: section "${ui.view}", ${plural(state.trips.length, 'trip')}${state.trips.some(isArchived) ? ` (${state.trips.filter(isArchived).length} archived)` : ''}, ${plural(plans, 'plan')}, theme ${state.settings.theme}, ${state.settings.units}`,
    `Account: ${account}`,
    `Recent errors: ${recentErrors.length ? '\n  ' + recentErrors.join('\n  ') : 'none'}`,
  ].join('\n');
}

function reportError(text) {
  $('#report-error').textContent = text;
  $('#report-error').hidden = !text;
}

function openReport() {
  reportForm.reset();
  reportError('');
  // The reply address is theirs to give: filled in from the account, and they can clear it.
  reportForm.elements.email.value = sync.saved ? sync.saved.email : '';
  $('#report-details').textContent = problemDetails();
  $('#report-send').textContent = window.REPORT_KEY ? T('Send') : T('Share report');
  $('#report-other').hidden = true;
  $('#report-how').textContent = window.REPORT_KEY
    ? T('Your message goes by email to the person who looks after this copy of the app.')
    : T('Your message is handed to the Share menu: send it to the person who shared the app with you.');
  reportDialog.showModal();
  draftStart(reportDialog);
  reportForm.elements.message.focus();
}

function reportText() {
  const f = reportForm.elements;
  const email = f.email.value.trim();
  return `${f.message.value.trim()}\n\n${email ? `Reply to: ${email}\n` : ''}---\n${$('#report-details').textContent}`;
}

// Without an email service, or when it fails: any app on the device can carry the report.
async function shareReport() {
  const text = reportText();
  try {
    if (navigator.share) {
      await navigator.share({ title: `Dotted Line ${APP_VERSION}: a problem`, text });
    } else {
      await navigator.clipboard.writeText(text);
      snackbar(T('Report copied — paste it in a message to the person who shared the app with you'));
    }
    reportDialog.close();
  } catch (err) {
    if (!err || err.name !== 'AbortError') reportError(T('Couldn’t share it from here. Copy your text and send it yourself, with the version: {v}.', { v: APP_VERSION }));
  }
}

reportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = reportForm.elements;
  const message = f.message.value.trim();
  const email = f.email.value.trim();
  if (message.length < 10) return reportError(T('Say a little more about what went wrong: what you did, and what happened.'));
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return reportError(T('That email address doesn’t look right. Fix it, or leave it empty.'));
  reportError('');
  if (!window.REPORT_KEY) return shareReport();
  if (!navigator.onLine) return reportError(T('No connection. Your message stays here: try again when you’re online.'));
  if (Date.now() - reportSentAt < 30000) return reportError(T('You just sent one. Wait half a minute before the next.'));

  const buttons = reportForm.querySelectorAll('button');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const res = await fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: window.REPORT_KEY,
        subject: `Dotted Line ${APP_VERSION}: a problem`,
        from_name: 'Dotted Line',
        message,
        ...(email ? { email } : {}),      // becomes the address a reply goes to
        details: $('#report-details').textContent,
      }),
    });
    const answer = await res.json().catch(() => ({}));
    if (!res.ok || !answer.success) throw new Error((answer.body && answer.body.message) || answer.message || `HTTP ${res.status}`);
    reportSentAt = Date.now();
    reportDialog.close();
    snackbar(T('Sent — thank you'));
  } catch (err) {
    console.warn('Report not sent', err);
    reportError(T('Couldn’t send it just now. Try again in a moment, or use “Send another way”.'));
    $('#report-other').hidden = false;
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
});
$('#report-other').addEventListener('click', shareReport);

/* ---------- Taps in Settings → About ---------- */

onAction('privacy', () => openPrivacy());
onAction('whats-new', () => openChangelog());
onAction('older-versions', (el) => {
  for (const s of document.querySelectorAll('#about-body .version[hidden]')) s.hidden = false;
  el.remove();
});
onAction('report-problem', () => openReport());
