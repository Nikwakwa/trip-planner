'use strict';

/* view-settings.js — the Settings section. */

function renderMore() {
  const offlineReady = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
  const signedIn = !!sync.saved;
  const archived = state.trips.filter(isArchived).length;     // their own sheet (archive.js)
  let account;
  if (!sync.configured) {
    account = `
      <li><div class="row">
        <span class="row-icon">${icon('sync')}</span>
        <span class="row-text"><span class="row-title">${T('Sync between devices')}</span>
          <span class="row-sub">${T('Not set up yet — see “Sync between devices” in the README')}</span></span>
      </div></li>`;
  } else if (!signedIn) {
    account = `
      <li><button type="button" class="row accent ripple" data-action="sign-in">
        <span class="row-icon">${icon('login')}</span>
        <span class="row-text"><span class="row-title">${T('Sign in to sync')}</span>
          <span class="row-sub">${T('See your trips on all your devices, and plan them with other people')}</span></span>
      </button></li>`;
  } else {
    account = `
      <li><div class="row">
        <span class="row-icon">${icon(sync.status === 'error' ? 'error' : navigator.onLine ? 'cloud_done' : 'cloud_off')}</span>
        <span class="row-text"><span class="row-title">${esc(sync.saved.email)}</span>
          <span class="row-sub">${syncStatusText()}</span></span>
      </div></li>
      ${sync.saved.verified === false ? `<li><button type="button" class="row accent ripple" data-action="verify-email">
        <span class="row-icon">${icon('send')}</span>
        <span class="row-text"><span class="row-title">${T('Confirm your email')}</span>
          <span class="row-sub">${T('Tap the link we emailed you, so “Forgot password?” can reach you. Tap here if you did, or to get a new link.')}</span></span>
      </button></li>` : ''}
      <li><button type="button" class="row ripple" data-action="edit-name">
        <span class="row-icon">${icon('person')}</span>
        <span class="row-text"><span class="row-title">${state.profile ? esc(state.profile.name) : T('Add your name')}</span>
          <span class="row-sub">${T('First name or nickname, shown to the people you plan trips with')}</span></span>
      </button></li>
      <li><button type="button" class="row ripple" data-action="change-password">
        <span class="row-icon">${icon('shield')}</span>
        <span class="row-text"><span class="row-title">${T('Change password')}</span></span>
      </button></li>
      <li><button type="button" class="row ripple" data-action="sign-out">
        <span class="row-icon">${icon('logout')}</span>
        <span class="row-text"><span class="row-title">${T('Sign out')}</span><span class="row-sub">${T('Plans stay on this device but stop syncing')}</span></span>
      </button></li>
      <li><button type="button" class="row danger ripple" data-action="delete-account">
        <span class="row-icon">${icon('delete')}</span>
        <span class="row-text"><span class="row-title">${T('Delete account')}</span><span class="row-sub">${T('Removes the login and the trips stored in it')}</span></span>
      </button></li>`;
  }

  $('#view-more').innerHTML = `
    <h1 class="headline">${T('Settings')}</h1>

    <h2 class="group-label">${T('Account')}</h2>
    <ul class="group">${account}</ul>

    <h2 class="group-label">${T('Trips')}</h2>
    <ul class="group">
      ${tripsShown().map(t => `
        <li><button type="button" class="row ripple" data-action="edit-trip" data-trip-id="${esc(t.id)}">
          <span class="trip-avatar" style="--c:${esc(t.color)}">${esc(t.name.charAt(0).toUpperCase())}</span>
          <span class="row-text">
            <span class="row-title">${esc(t.name)}</span>
            <span class="row-sub">${t.start && t.end ? esc(fmtDay(t.start, { month: 'short', day: 'numeric' }) + ' – ' + fmtDay(t.end, { month: 'short', day: 'numeric' })) : T('No dates')} · ${Tn(t.items.length, '{n} plan', '{n} plans')}${t.shared && signedIn ? ` · ${T('shared')}` : ''}</span>
          </span>
          <span class="row-trail">${icon('edit')}</span>
        </button></li>`).join('')}
      ${archived ? `<li><button type="button" class="row ripple" data-action="archive-list">
        <span class="row-icon">${icon('archive')}</span>
        <span class="row-text"><span class="row-title">${T('Archived trips')}</span><span class="row-sub">${Tn(archived, '{n} trip, off the top bar', '{n} trips, off the top bar')}</span></span>
      </button></li>` : ''}
      <li><button type="button" class="row ripple" data-action="new-trip">
        <span class="row-icon">${icon('add')}</span>
        <span class="row-text"><span class="row-title">${T('Add a trip')}</span></span>
      </button></li>
      ${sync.configured ? `<li><button type="button" class="row ripple" data-action="join-trip">
        <span class="row-icon">${icon('group')}</span>
        <span class="row-text"><span class="row-title">${T('Join a trip')}</span><span class="row-sub">${T('With the invitation link someone sent you')}</span></span>
      </button></li>` : ''}
    </ul>

    <h2 class="group-label">${T('Appearance')}</h2>
    <ul class="group">
      ${[
        // The language: what the device uses when the app has it (i18n.js). Changing it starts the app again.
        [T('Language'), 'lang', Object.entries(LANGS), LANG],
        [T('Theme'), 'theme', [['auto', T('Auto'), 'brightness_auto'], ['light', T('Light'), 'light_mode'], ['dark', T('Dark'), 'dark_mode']], state.settings.theme],
        [T('Units'), 'units', [['metric', 'km · °C'], ['imperial', 'mi · °F']], imperial() ? 'imperial' : 'metric'],
        // French writes the day first, always.
        !LOCALES[LANG] && [T('Date'), 'date-order', [['dmy', '31 Oct'], ['mdy', 'Oct 31']], state.settings.dateOrder],
        [T('Time'), 'clock', [['24', '14:30'], ['12', '2:30 PM']], state.settings.clock],
      ].filter(Boolean).map(([name, action, options, chosen]) => `
        <li><div class="row pick">
          <span class="pick-label">${name}</span>
          <div class="segmented" role="group" aria-label="${name}">
            ${options.map(([value, label, ic]) => `
              <button type="button" class="ripple" data-action="${action}" data-value="${value}" aria-pressed="${chosen === value}">${ic ? icon(ic) : ''}${label}</button>`).join('')}
          </div>
        </div></li>`).join('')}
    </ul>

    <h2 class="group-label">${T('Planning help')}</h2>
    <ul class="group">
      <li><button type="button" class="row ripple" data-action="toggle-suggestions" role="switch" aria-checked="${state.settings.suggestions}">
        <span class="row-icon">${icon('auto_awesome')}</span>
        <span class="row-text"><span class="row-title">${T('Day suggestions')}</span><span class="row-sub">${T('Ideas under each day, from the city’s travel guide')}</span></span>
        <span class="switch ${state.settings.suggestions ? 'on' : ''}" aria-hidden="true"></span>
      </button></li>
      <li><button type="button" class="row ripple" data-action="toggle-lookup" role="switch" aria-checked="${state.settings.lookup}">
        <span class="row-icon">${icon('pin_drop')}</span>
        <span class="row-text"><span class="row-title">${T('Find addresses and opening hours')}</span><span class="row-sub">${T('And the way by road. Sends where your plans are (not what you plan there) to OpenStreetMap')}</span></span>
        <span class="switch ${state.settings.lookup ? 'on' : ''}" aria-hidden="true"></span>
      </button></li>
      ${aiReady() ? `<li><button type="button" class="row ripple" data-action="toggle-booking" role="switch" aria-checked="${state.settings.booking !== false}">
        <span class="row-icon">${icon('confirmation_number')}</span>
        <span class="row-text"><span class="row-title">${T('Flag plans that sell out')}</span><span class="row-sub">${T('Sends the names of your plans to Google Gemini (free service)')}</span></span>
        <span class="switch ${state.settings.booking !== false ? 'on' : ''}" aria-hidden="true"></span>
      </button></li>` : ''}
    </ul>

    <h2 class="group-label">${T('App')}</h2>
    <ul class="group">
      ${installPrompt ? `
        <li><button type="button" class="row accent ripple" data-action="install">
          <span class="row-icon">${icon('install_mobile')}</span>
          <span class="row-text"><span class="row-title">${T('Install app')}</span><span class="row-sub">${T('Add Dotted Line to your home screen')}</span></span>
        </button></li>` : onIOS && !installed() ? `
        <li><div class="row">
          <span class="row-icon">${icon('install_mobile')}</span>
          <span class="row-text"><span class="row-title">${T('Install app')}</span><span class="row-sub">${T('Tap your browser’s Share button, then “Add to Home Screen”')}</span></span>
        </div></li>` : ''}
      <li><div class="row">
        <span class="row-icon">${icon('offline_pin')}</span>
        <span class="row-text"><span class="row-title">${T('Works offline')}</span>
          <span class="row-sub">${offlineReady ? T('<span class="ok">Ready</span> — saved on this device') : T('Open the app once while online')}</span></span>
      </div></li>
      <li><div class="row">
        <span class="row-icon">${icon('shield')}</span>
        <span class="row-text"><span class="row-title">${T('Data protected')}</span>
          <span class="row-sub">${storagePersisted ? T('<span class="ok">On</span> — your device won’t clear it') : T('Installing the app usually turns this on')}</span></span>
      </div></li>
    </ul>

    <h2 class="group-label">${T('Backup &amp; calendar')}</h2>
    <ul class="group">
      ${activeTrip() ? `<li><button type="button" class="row ripple" data-action="trip-calendar">
        <span class="row-icon">${icon('calendar_add_on')}</span>
        <span class="row-text"><span class="row-title">${T('Calendar file for {trip}', { trip: esc(activeTrip().name) })}</span><span class="row-sub">${T('Every plan with a day, for any calendar app (in Google Calendar: Settings → Import)')}</span></span>
      </button></li>` : ''}
      <li><button type="button" class="row ripple" data-action="export">
        <span class="row-icon">${icon('download')}</span>
        <span class="row-text"><span class="row-title">${T('Save backup file')}</span><span class="row-sub">${T('Goes to your Downloads folder')}</span></span>
      </button></li>
      <li><button type="button" class="row ripple" data-action="import">
        <span class="row-icon">${icon('upload')}</span>
        <span class="row-text"><span class="row-title">${T('Restore from backup')}</span><span class="row-sub">${T('Replaces what’s in the app now')}</span></span>
      </button></li>
      <li><button type="button" class="row danger ripple" data-action="reset">
        <span class="row-icon">${icon('restart_alt')}</span>
        <span class="row-text"><span class="row-title">${T('Erase everything')}</span><span class="row-sub">${T('Start over with a clean slate')}</span></span>
      </button></li>
    </ul>
    <input type="file" id="import-file" accept=".json,application/json" hidden>

    <h2 class="group-label">${T('About')}</h2>
    <ul class="group">
      ${sync.configured ? `<li><button type="button" class="row accent ripple" data-action="feature-votes">
        <span class="row-icon">${icon('lightbulb')}</span>
        <span class="row-text"><span class="row-title">${T('What should come next?')}</span><span class="row-sub">${T('Vote for new features, or suggest your own')}</span></span>
      </button></li>` : ''}
      <li><button type="button" class="row ripple" data-action="privacy">
        <span class="row-icon">${icon('shield')}</span>
        <span class="row-text"><span class="row-title">${T('Privacy')}</span><span class="row-sub">${T('Where your plans are kept, and what is sent where')}</span></span>
      </button></li>
      <li><button type="button" class="row ripple" data-action="report-problem">
        <span class="row-icon">${icon('error')}</span>
        <span class="row-text"><span class="row-title">${T('Report a problem')}</span><span class="row-sub">${T('Write what went wrong. The app’s version goes with it, never your plans')}</span></span>
      </button></li>
      <li><button type="button" class="row ripple" data-action="whats-new">
        <span class="row-icon">${icon('info')}</span>
        <span class="row-text"><span class="row-title">${T('What’s new')}</span>
          <span class="row-sub">${T('Version {v}', { v: esc(APP_VERSION) })} · ${esc(fmtDay(CHANGELOG[0].date, { day: 'numeric', month: 'short', year: 'numeric' }))}</span></span>
      </button></li>
    </ul>

    <p class="footnote">${icon('shield', 'sm')}${signedIn
      ? T('Your plans are stored on this device and in your account.')
      : T('Your plans are stored only on this device.')}</p>
    <p class="footnote">${T('Maps, address and place search: © OpenStreetMap contributors. City guides: Wikivoyage and Wikipedia, CC BY-SA.')}</p>`;
}

/* ---------- Taps in Settings ---------- */

// The choices under Appearance (the Language is below).
for (const [action, key] of [['theme', 'theme'], ['units', 'units'], ['date-order', 'dateOrder'], ['clock', 'clock']]) {
  onAction(action, (el) => {
    state.settings[key] = el.dataset.value;
    save();
    render();
  });
}
onAction('lang', (el) => {
  // Every text is picked when the app starts (i18n.js): it starts again in the new language.
  if (el.dataset.value === LANG) return;
  state.settings.lang = el.dataset.value;
  saveLocal();
  location.reload();
});
// The switches under Planning help.
onAction('toggle-suggestions', () => {
  state.settings.suggestions = !state.settings.suggestions;
  save();
  render();
});
onAction('toggle-lookup', () => {
  state.settings.lookup = !state.settings.lookup;
  if (state.settings.lookup) state.trips.forEach(t => t.items.forEach(i => delete i.geoMiss));
  save();
  render();
});
onAction('toggle-booking', () => {
  state.settings.booking = state.settings.booking === false;
  save();
  render();
});
