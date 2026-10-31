'use strict';

/* =========================================================
   Self-check: tests the parts of the app that must not break (dates, checking data from
   outside, backups, merging the account's plans, AI answers, opening hours, translations), and how
   the code is put together (files saved for offline use, actions, names, links).
   Open the app with "?selfcheck" at the end of its address to run it, before every update
   that ships, and on a new kind of device. It is only loaded then.
   It works on made-up plans: the real ones are set aside while it runs and nothing is saved.
   ========================================================= */

// The checks expect the app's English texts: they run in English, whatever language the app is in.
function runSelfCheck() {
  const lang = LANG;
  LANG = 'en';
  try { return runChecks(); } finally { LANG = lang; }
}

function runChecks() {
  const results = [];
  let group = '';
  // A check passes when it returns true. Anything else (or an error) is shown as what went wrong.
  const check = (name, fn) => {
    let detail = '';
    try {
      const r = fn();
      if (r !== true) detail = typeof r === 'string' ? r : 'failed';
    } catch (e) {
      detail = 'error: ' + ((e && e.message) || e);
    }
    results.push({ group, name, ok: !detail, detail });
  };
  const same = (got, want) => stable(got) === stable(want) || `got ${stable(got)}, expected ${stable(want)}`;
  const copy = v => JSON.parse(JSON.stringify(v));
  const throws = (fn) => { try { fn(); } catch { return true; } return 'no error was raised'; };
  // The app's own files, read as they are on the server (for the checks on texts and on the code).
  const read = (url) => {
    const req = new XMLHttpRequest();
    req.open('GET', url, false);      // waits: the checks run in one go
    req.send();
    if (req.status !== 200) throw new Error(`couldn’t read ${url} (offline?)`);
    return req.responseText;
  };
  // The code files index.html loads (not the vendored libraries).
  const codeFiles = () => [...new DOMParser().parseFromString(read('index.html'), 'text/html').querySelectorAll('script[src]')]
    .map(s => s.getAttribute('src')).filter(src => !/^(https?:|vendor\/)/.test(src));

  // The real plans and account are set aside, and nothing can be saved, sent or redrawn meanwhile.
  // Everything inside is done in one go (no waiting), so nothing else runs in between.
  const sandbox = (fn) => {
    const real = {
      state, saved: sync.saved, own: sync.own, shared: sync.shared, db: sync.db, status: sync.status, error: sync.error,
      saveLocal, writeSyncInfo, renderSoon, pushChanges, render, setSyncStatus, guideFor,
    };
    try {
      saveLocal = writeSyncInfo = renderSoon = pushChanges = render = setSyncStatus = () => {};
      guideFor = () => null;
      sync.own = newSpace();
      sync.shared = {};
      return fn();
    } finally {
      state = real.state;
      Object.assign(sync, { saved: real.saved, own: real.own, shared: real.shared, db: real.db, status: real.status, error: real.error });
      saveLocal = real.saveLocal; writeSyncInfo = real.writeSyncInfo; renderSoon = real.renderSoon;
      pushChanges = real.pushChanges; render = real.render; setSyncStatus = real.setSyncStatus; guideFor = real.guideFor;
    }
  };

  // Made-up plans, the same at every run.
  const sample = () => ({
    version: 1,
    activeTripId: 'trip1',
    trips: [{
      id: 'trip1', name: 'Lisbon', color: '#b3261e', start: '2026-05-01', end: '2026-05-03', travel: 'transit',
      items: [
        { id: 'a', title: 'Castle', category: 'sight', date: '2026-05-01', time: '10:00', place: 'Castelo', link: '', notes: '', done: false },
        { id: 'b', title: 'Lunch', category: 'food', date: '2026-05-01', time: '', place: '', link: '', notes: 'Book a table', done: false },
        { id: 'c', title: 'Tram 28', category: 'other', date: '', time: '', place: '', link: '', notes: '', done: false },
      ],
    }],
    checklist: [{ id: 'k1', text: 'Passport', done: false }],
    settings: { ...defaultSettings() },
  });
  const titles = () => state.trips[0].items.map(i => i.title).sort().join(', ');
  // Starts from the sample as both the phone's and the account's plans, then merges what `remote` says.
  const merge = (changeLocal, changeRemote) => sandbox(() => {
    const base = stateDocs(sample());
    const local = sample();
    changeLocal(local);
    const remote = sample();
    changeRemote(remote);
    state = local;
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: { ...base }, shared: {} };
    const waiting = waitingCount();
    mergeRemote(stateDocs(remote), new Set());
    return { titles: titles(), checklist: state.checklist.length, waiting };
  });
  const item = (s, id) => s.trips[0].items.find(i => i.id === id);
  const drop = (s, id) => { s.trips[0].items = s.trips[0].items.filter(i => i.id !== id); };

  /* ---------- Dates and times ---------- */
  group = 'Dates and times';
  check('A real day is accepted, an impossible one is not', () =>
    same([isDate('2026-02-28'), isDate('2026-02-31'), isDate('2026-2-3'), isDate(20260228), isDate('')], [true, false, false, false, false]));
  check('A real time is accepted, an impossible one is not', () =>
    same([isTime('09:05'), isTime('23:59'), isTime('24:00'), isTime('9:05'), isTime(905)], [true, true, false, false, false]));
  check('A day survives being read and written back, also when the clocks change', () =>
    same(['2026-03-29', '2026-10-25', '2026-03-08', '2026-11-01', '2028-02-29'].map(d => toISO(parseDate(d))),
      ['2026-03-29', '2026-10-25', '2026-03-08', '2026-11-01', '2028-02-29']));
  check('Days are counted right across a clock change and a new year', () =>
    same([daysBetween('2026-03-28', '2026-03-30'), daysBetween('2026-10-24', '2026-10-26'), daysBetween('2026-12-31', '2027-01-01'), daysBetween('2026-05-03', '2026-05-01')], [2, 2, 1, -2]));
  check('Dates are written in the chosen order', () => sandbox(() => {
    state = sample();
    state.settings.dateOrder = 'dmy';
    const dmy = fmtDay('2026-10-31');
    state.settings.dateOrder = 'mdy';
    const mdy = fmtDay('2026-10-31');
    return (/^Sat,? 31 Oct$/.test(dmy) && /^Sat, Oct 31$/.test(mdy)) || `got "${dmy}" and "${mdy}"`;
  }));
  check('The forms’ date fields show the date in the chosen order', () => sandbox(() => {
    state = sample();
    const fields = [...document.querySelectorAll('input[type="date"]')];
    if (!fields.length || fields.some(f => !f.classList.contains('dressed'))) return 'a date field is not dressed';
    const f = fields[0], was = f.value, got = [];
    for (const order of ['dmy', 'mdy']) {
      state.settings.dateOrder = order;
      f.value = '2026-12-26';
      got.push(f.nextElementSibling.textContent);
    }
    f.value = '';
    got.push(f.nextElementSibling.textContent);
    f.value = was;
    return same(got, ['26 Dec 2026', 'Dec 26, 2026', '']) || `got ${stable(got)}`;
  }));
  check('Times are written with the chosen clock', () => sandbox(() => {
    state = sample();
    state.settings.clock = '24';
    const h24 = [fmtTime('14:30'), fmtTime('00:05')];
    state.settings.clock = '12';
    const h12 = [fmtTime('14:30'), fmtTime('00:05')];
    return (h24[0] === '14:30' && /^0?0:05$/.test(h24[1]) && /^2:30\sPM$/.test(h12[0]) && /^12:05\sAM$/.test(h12[1])) || `got ${stable(h24)} and ${stable(h12)}`;
  }));

  /* ---------- Text from outside ---------- */
  group = 'Text from outside can’t run as code';
  check('Text is made safe before it goes into the page', () =>
    same(esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;'));
  check('Only normal web links are kept', () =>
    same([safeUrl('javascript:alert(1)'), safeUrl('data:text/html,x'), safeUrl('example.com/a'), safeUrl(' https://example.com/b ')],
      ['', '', 'https://example.com/a', 'https://example.com/b']));
  check('An id can only be letters, digits, "-", "_" and "."', () =>
    same([isId('abc-1_2.x'), isId('a b'), isId('<x>'), isId(''), isId('a'.repeat(101)), isId(5)], [true, false, false, false, false, false]));

  /* ---------- Saved plans and the account's plans ---------- */
  group = 'Reading saved plans';
  check('A damaged plan is repaired, and fields from a newer version are kept', () =>
    same(tidyItem({ id: 'a', title: 5, date: '2026-02-31', time: '25:00', done: 'yes', lat: 'x', lng: 2, slot: 'nope', newer: { x: 1 } }),
      { id: 'a', title: 'Untitled', category: 'other', date: '', time: '', place: '', link: '', notes: '', done: false, newer: { x: 1 } }));
  check('A plan with a bad id is left out, or gets a new id on this device', () =>
    (tidyItem({ id: '<bad>' }) === null && tidyItem(null) === null && isId(tidyItem({ id: '<bad>' }, true).id)) || 'bad id not handled');
  check('A damaged trip is repaired, and fields from a newer version are kept', () =>
    same(tidyTrip({ id: 't', name: '', color: 'red', start: '2026-01-01', end: 'nope', place: { name: 'X' }, travel: 'fly', newer: [1] }),
      { id: 't', name: 'Trip', color: COLORS[0], start: '', end: '', newer: [1] }));
  check('A trip whose last day comes before its first gets them the right way round', () =>
    same([tidyTrip({ id: 't', name: 'A', start: '2026-05-09', end: '2026-05-02' }), cleanBackup({ trips: [{ start: '2026-05-09', end: '2026-05-02' }] }).trips[0]]
      .map(t => [t.start, t.end]), [['2026-05-02', '2026-05-09'], ['2026-05-02', '2026-05-09']]));
  check('An empty checklist line is left out', () =>
    (tidyCheck({ id: 'c', text: '' }) === null && tidyCheck({ id: 'c', text: 'Socks', done: 1 }).done === false) || 'checklist line not handled');
  check('The saved copy is read without losing a trip', () => {
    const s = tidyState({ trips: [{ id: 't', name: 'A', items: [{ id: 'i', title: 'X' }, null, 7] }, 'junk'], checklist: 'no' });
    return same([s.trips.length, s.trips[0].items.length, s.checklist, s.settings], [1, 1, [], {}]);
  });

  /* ---------- Backup files ---------- */
  group = 'Backup files';
  check('A file that isn’t a backup is refused', () =>
    [throws(() => cleanBackup(null)), throws(() => cleanBackup({})), throws(() => cleanBackup({ trips: 'x' }))].every(r => r === true) || 'a bad file was accepted');
  check('A backup comes back the same', () => {
    const s = sample();
    return same(cleanBackup(copy(s)), s);
  });
  check('Reading a backup twice changes nothing more', () => {
    const once = cleanBackup(copy(sample()));
    return same(cleanBackup(copy(once)), once);
  });
  check('Unknown fields, bad ids and bad values in a backup are cleaned', () => {
    const s = cleanBackup({
      activeTripId: 'gone',
      trips: [{
        id: '<script>', name: 'N'.repeat(99), color: 'javascript:1', start: '2026-13-01', evil: '<b>',
        items: [{ id: 'dup', title: 'T'.repeat(500), date: 'x', time: '99:99', evil: 1 }, { id: 'dup', category: '<i>' }, null],
      }],
      checklist: [{ id: 'dup', text: 'Socks' }, { text: '' }],
      settings: { theme: 'pink', evil: true },
    });
    const t = s.trips[0];
    const ids = [t.id, ...t.items.map(i => i.id), ...s.checklist.map(c => c.id)];
    if (!ids.every(isId) || new Set(ids).size !== ids.length) return 'ids not unique and clean: ' + ids.join(' ');
    if ('evil' in t || 'evil' in t.items[0] || 'evil' in s.settings) return 'an unknown field was kept';
    return same([t.name.length, t.color, t.start, t.items.length, t.items[0].title.length, t.items[0].date, t.items[0].time, t.items[1].category, s.checklist.length, s.settings.theme, s.activeTripId === t.id],
      [40, COLORS[0], '', 2, 120, '', '', 'other', 1, 'auto', true]);
  });

  /* ---------- Sync ---------- */
  group = 'Sync between devices';
  check('The same plans always give the same text, whatever the order of their fields', () =>
    same(stable({ b: 1, a: undefined, c: [2, { z: 1, y: 2 }] }), '{"b":1,"c":[2,{"y":2,"z":1}]}'));
  check('Plans survive the trip to the account and back', () => sandbox(() => {
    const docs = stateDocs(sample());
    state = { ...sample(), trips: [], checklist: [], activeTripId: null };
    applyDocs(docs);
    return same(stateDocs(state), docs) === true && same(state.activeTripId, 'trip1');
  }));
  check('A change made on another device arrives', () =>
    same(merge(() => {}, (r) => { item(r, 'b').title = 'Dinner'; r.trips[0].items.push({ ...item(r, 'c'), id: 'd', title: 'Museum' }); }),
      { titles: 'Castle, Dinner, Museum, Tram 28', checklist: 1, waiting: 0 }));
  check('A change made here while offline is kept, next to the other device’s', () =>
    same(merge((l) => { item(l, 'a').title = 'Castle at 9'; }, (r) => { item(r, 'b').title = 'Dinner'; }),
      { titles: 'Castle at 9, Dinner, Tram 28', checklist: 1, waiting: 1 }));
  check('A plan deleted here stays deleted', () =>
    same(merge(l => drop(l, 'c'), () => {}), { titles: 'Castle, Lunch', checklist: 1, waiting: 1 }));
  check('A plan deleted on another device goes away here', () =>
    same(merge(() => {}, (r) => { drop(r, 'b'); r.checklist = []; }), { titles: 'Castle, Tram 28', checklist: 0, waiting: 0 }));
  check('When both devices changed the same plan, this device’s unsent change wins', () =>
    same(merge((l) => { item(l, 'a').title = 'Mine'; }, (r) => { item(r, 'a').title = 'Theirs'; }).titles, 'Lunch, Mine, Tram 28'));
  check('When two devices changed different things about the same plan, both changes are kept', () => sandbox(() => {
    const base = stateDocs(sample());
    state = sample();
    item(state, 'a').time = '11:30';
    const remote = sample();
    item(remote, 'a').title = 'Castle with Ana';
    item(remote, 'a').notes = 'Bring water';
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: { ...base }, shared: {} };
    mergeRemote(stateDocs(remote), new Set());
    const a = item(state, 'a');
    return same([a.title, a.time, a.notes], ['Castle with Ana', '11:30', 'Bring water']);
  }));
  check('A plan deleted here doesn’t undo what another device changed in the plans after it', () => sandbox(() => {
    const base = stateDocs(sample());
    state = sample();
    drop(state, 'a');                                   // "Lunch" and "Tram 28" each move up one place
    const remote = sample();
    item(remote, 'b').title = 'Dinner';
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: { ...base }, shared: {} };
    mergeRemote(stateDocs(remote), new Set());
    return same([titles(), JSON.parse(stateDocs(state).item_b).pos], ['Dinner, Tram 28', 0]);
  }));
  check('An answer from the offline copy never wipes the plans', () => sandbox(() => {
    state = sample();
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: stateDocs(sample()), shared: {} };
    onAccountSnapshot({ metadata: { fromCache: true }, forEach() {} });
    return same(titles(), 'Castle, Lunch, Tram 28');
  }));

  /* ---------- A trip planned by several accounts ---------- */
  group = 'Planning a trip together';
  // The sample, plus a trip to Rome that is shared ("s1"), as the account and the device both have them.
  const rome = () => ({
    id: 'trip2', shared: 's1', name: 'Rome', color: '#1565c0', start: '', end: '',
    items: [
      { id: 'x', title: 'Forum', category: 'sight', date: '', time: '', place: '', link: '', notes: '', done: false },
      { id: 'y', title: 'Gelato', category: 'food', date: '', time: '', place: '', link: '', notes: '', done: false },
    ],
  });
  const both = () => { const s = sample(); s.trips.push(rome()); return s; };
  const romeTitles = () => { const t = state.trips.find(x => x.id === 'trip2'); return t ? t.items.map(i => i.title).sort().join(', ') : 'no Rome'; };
  // Like merge() above, for the shared trip: what `remote` says its space holds is merged in.
  const mergeShared = (changeLocal, changeRemote, keep) => sandbox(() => {
    const local = both();
    changeLocal(local);
    const remote = both();
    changeRemote(remote);
    state = local;
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: stateDocs(both()), shared: { s1: { trip: 'trip2', base: stateDocs(both(), 's1') } } };
    sync.shared.s1 = newSpace();
    mergeRemote(stateDocs(remote, 's1'), new Set(), keep, 's1');
    return { rome: romeTitles(), lisbon: titles(), trips: state.trips.map(t => `${t.id}${t.shared ? ':' + t.shared : ''}`).join(' '), own: Object.keys(stateDocs(state)).length };
  });
  const romeOf = s => s.trips.find(t => t.id === 'trip2');

  check('A shared trip’s plans are kept apart from the account’s own', () => {
    const s = both();
    s.trips.push({ ...sample().trips[0], id: 'trip3', items: [] });
    const own = stateDocs(s), theirs = stateDocs(s, 's1');
    const doc = JSON.parse(theirs.trip_trip2);
    return same([Object.keys(own).sort(), Object.keys(theirs).sort(), 'shared' in doc, doc.pos, JSON.parse(own.trip_trip3).pos],
      [['check_k1', 'item_a', 'item_b', 'item_c', 'trip_trip1', 'trip_trip3'], ['item_x', 'item_y', 'trip_trip2'], false, 0, 1]);
  });
  check('A change someone else made to a shared trip arrives, and the account’s own trips don’t move', () =>
    same(mergeShared(() => {}, (r) => { romeOf(r).items[0].title = 'Forum at 9'; romeOf(r).items.pop(); }),
      { rome: 'Forum at 9', lisbon: 'Castle, Lunch, Tram 28', trips: 'trip1 trip2:s1', own: 5 }));
  check('A change made here to a shared trip is kept, next to the others’', () =>
    same(mergeShared((l) => { romeOf(l).items[1].title = 'Gelato twice'; }, (r) => { romeOf(r).items[0].title = 'Forum at 9'; }).rome, 'Forum at 9, Gelato twice'));
  check('The first time a shared trip arrives, it replaces this device’s own copy of it', () => sandbox(() => {
    // The device has Rome as a trip of its own (no "shared"), with a plan the shared one doesn't have.
    state = both();
    delete romeOf(state).shared;
    romeOf(state).items.push({ ...rome().items[0], id: 'z', title: 'Only in my copy' });
    const mine = romeOf(state);
    const remote = both();
    romeOf(remote).items[0].title = 'Forum at 9';
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: stateDocs(state), shared: { s1: { trip: 'trip2', base: {}, fresh: true } } };
    sync.shared.s1 = newSpace();
    mergeRemote(stateDocs(remote, 's1'), new Set(), new Set(), 's1');
    return same([romeTitles(), state.trips.map(t => t.id), romeOf(state) === mine, mine.shared, Object.keys(stateDocs(state)).filter(k => /trip2|_[xyz]$/.test(k))],
      ['Forum at 9, Gelato', ['trip1', 'trip2'], true, 's1', []]);
  }));
  check('Only the trip a share was made for is taken from it, never another trip', () =>
    same(mergeShared(() => {}, (r) => {
      // Someone on the trip slipped in a trip with the id of one of this account's own, and one more.
      r.trips.push({ ...sample().trips[0], shared: 's1', name: 'Not Lisbon', items: [] }, { ...rome(), id: 'evil', name: 'Evil', items: [] });
    }), { rome: 'Forum, Gelato', lisbon: 'Castle, Lunch, Tram 28', trips: 'trip1 trip2:s1', own: 5 }));
  check('A shared trip that is gone from this device is brought back, not deleted for the others', () => sandbox(() => {
    state = sample();      // as after "Restore from backup": Rome is not here any more
    const docs = stateDocs(both(), 's1');
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: stateDocs(sample()), shared: { s1: { trip: 'trip2', base: { ...docs } } } };
    let sent = 0;
    sync.db = { batch: () => ({ set() { sent++; }, delete() { sent++; }, commit: () => new Promise(() => {}) }) };
    sync.shared.s1 = { ...newSpace(), col: { doc: k => k }, known: { ...docs } };
    pushSpace('s1');
    const nothingSent = sent;
    // What share.js does with the next answer about a trip that isn't here: take what the account has.
    mergeRemote(docs, new Set(), new Set(), 's1');
    state.trips[1].items.pop();
    pushSpace('s1');
    return same([nothingSent, romeTitles(), sent], [0, 'Forum', 1]);
  }));
  check('An invitation is read from a link, from a message around it, or from the code alone', () => {
    const invite = { id: 'abcdefghijkmnpqrstuv', code: '23456789abcd' };
    const link = inviteLink(invite);
    return same([readInvite(link), readInvite(`Join my trip: ${link} — see you there!`), readInvite('abcdefghijkmnpqrstuv.23456789abcd'),
      readInvite('https://example.com/trip-planner/'), readInvite('abcdefghijkmnpqrstuv.2345'), readInvite(null), link.includes('#join=')],
    [invite, invite, invite, null, null, null, true]);
  });
  check('The codes of invitations are long, readable and never the same twice', () => {
    const a = randomCode(20), b = randomCode(20);
    return (/^[a-km-np-z2-9]{20}$/.test(a) && a !== b && randomCode(12).length === 12) || `got ${a} and ${b}`;
  });
  check('The list of people on a trip is checked before it is shown', () =>
    same([
      tidyRoot('s1', { owner: 'bob', trip: 'trip2', code: '23456789abcd', uids: ['ann', 'bob', 7], members: { ann: { email: 'ann@x.org', at: 5 }, bob: { email: 9, at: 1 }, eve: { email: 'eve@x.org' } } }),
      tidyRoot('s1', { owner: 'bob', trip: '<b>', uids: ['bob'] }), tidyRoot('<b>', { owner: 'bob', trip: 'trip2', uids: ['bob'] }),
      tidyRoot('s1', { owner: 'bob', trip: 'trip2', uids: 'bob' }), tidyRoot('s1', null),
    ], [{ id: 's1', owner: 'bob', trip: 'trip2', code: '23456789abcd', members: [{ uid: 'bob', email: '', at: 1 }, { uid: 'ann', email: 'ann@x.org', at: 5 }] }, null, null, null, null]));
  check('“Shared” is only kept when it can be an id, and never comes back from a backup file', () =>
    same([tidyTrip({ id: 't', shared: 's1' }).shared, tidyTrip({ id: 't', shared: '<b>' }).shared, cleanBackup({ trips: [{ id: 't', name: 'A', shared: 's1' }] }).trips[0].shared],
      ['s1', undefined, undefined]));
  check('The list for everyone on a trip travels with the trip, and the checklist stays personal', () => sandbox(() => {
    const withList = () => { const s = both(); romeOf(s).todos = [{ id: 't1', text: 'Tent', done: false }, { id: 't2', text: 'Stove', done: false }]; return s; };
    state = withList();
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: stateDocs(withList()), shared: { s1: { trip: 'trip2', base: stateDocs(withList(), 's1') } } };
    sync.shared.s1 = newSpace();
    const docs = stateDocs(state, 's1');
    const mine = romeOf(state).todos[0];
    romeOf(state).todos[1].done = true;                 // ticked here, not sent yet
    const remote = withList();
    romeOf(remote).todos[0].text = 'Big tent';          // someone else renamed one and added one
    romeOf(remote).todos.push({ id: 't3', text: 'Map', done: false });
    mergeRemote(stateDocs(remote, 's1'), new Set(), undefined, 's1');
    const todos = romeOf(state).todos;
    return same([Object.keys(docs).filter(k => k.startsWith('todo_')), 'todos' in JSON.parse(docs.trip_trip2), JSON.parse(docs.todo_t1).trip,
      Object.keys(stateDocs(state)).some(k => k.startsWith('todo_')), todos.map(c => `${c.text}${c.done ? ' (done)' : ''}`), todos[0] === mine, state.checklist.length],
    [['todo_t1', 'todo_t2'], false, 'trip2', false, ['Big tent', 'Stove (done)', 'Map'], true, 1]);
  }));
  check('A trip’s own list is checked when it is read, and comes back from a backup file', () => {
    const s = tidyState({ trips: [{ id: 't', name: 'A', items: [], todos: [{ id: 'x', text: 'Tent', done: 1 }, { text: '' }, 7] }, { id: 'u', name: 'B', todos: 'no' }] });
    const b = cleanBackup({ trips: [{ id: 't', name: 'A', todos: [{ id: 'x', text: 'Tent', done: true, evil: 1 }, null] }, { id: 'u', name: 'B' }] });
    return same([s.trips[0].todos, 'todos' in s.trips[1], b.trips[0].todos, b.trips[1].todos],
      [[{ id: 'x', text: 'Tent', done: false }], false, [{ id: 'x', text: 'Tent', done: true }], undefined]);
  });

  // Hearts on ideas: sharing.roots is not part of the sandbox, so it is put back by hand.
  const withRoot = (members, fn) => {
    const real = sharing.roots;
    try {
      sharing.roots = { s1: { id: 's1', owner: 'selfcheck', trip: 'trip2', code: '', members: members.map(u => ({ uid: u, email: `${u}@test.org`, at: 0 })) } };
      return fn();
    } finally { sharing.roots = real; }
  };
  check('Hearts on ideas travel as one document per person, apart from the trip, and come back', () => sandbox(() => {
    const withHearts = () => { const s = both(); romeOf(s).hearts = { ann: ['x'], selfcheck: ['x', 'y'] }; return s; };
    state = withHearts();
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: {}, shared: { s1: { trip: 'trip2', base: {} } } };
    const docs = stateDocs(state, 's1');
    romeOf(state).hearts = { eve: ['y'] };
    applyDocs(docs, 's1');
    return same([Object.keys(docs).filter(k => k.startsWith('heart_')), 'hearts' in JSON.parse(docs.trip_trip2), JSON.parse(docs.heart_ann),
      Object.keys(stateDocs(state)).some(k => k.startsWith('heart_')), romeOf(state).hearts, SYNCED_KINDS.test('heart_ann')],
    [['heart_ann', 'heart_selfcheck'], false, { ids: ['x'], k: 'heart', trip: 'trip2', uid: 'ann' }, false, { ann: ['x'], selfcheck: ['x', 'y'] }, true]);
  }));
  check('Two people giving hearts at the same moment both keep theirs', () => sandbox(() => {
    state = both();
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: stateDocs(both()), shared: { s1: { trip: 'trip2', base: stateDocs(both(), 's1') } } };
    sync.shared.s1 = newSpace();
    toggleHeart(romeOf(state), 'y');                    // given here, not sent yet
    const remote = both();
    romeOf(remote).hearts = { ann: ['x'] };              // given by Ann meanwhile
    mergeRemote(stateDocs(remote, 's1'), new Set(), undefined, 's1');
    return same(romeOf(state).hearts, { ann: ['x'], selfcheck: ['y'] });
  }));
  check('Hearts are checked when they are read, and never come back from a backup file', () =>
    same([tidyTrip({ id: 't', hearts: { ann: ['x', '<b>', 'x', 7], '<b>': ['y'], bob: 'no', cat: [] } }).hearts, 'hearts' in tidyTrip({ id: 't', hearts: 5 }),
      'hearts' in tidyTrip({ id: 't', hearts: ['x'] }), cleanBackup({ trips: [{ id: 't', name: 'A', hearts: { ann: ['x'] } }] }).trips[0].hearts],
    [{ ann: ['x'] }, false, false, undefined]));
  check('The ideas the group likes most come first, and only the hearts of people on the trip count', () => sandbox(() => withRoot(['selfcheck', 'ann'], () => {
    state = both();
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: {}, shared: {} };
    const r = romeOf(state);
    r.items.push({ ...r.items[0], id: 'z', title: 'Pantheon' });
    r.hearts = { ann: ['z', 'y'], selfcheck: ['y'], eve: ['x', 'z'] };     // Eve has left the trip
    const order = byHearts(r, r.items).map(i => i.title);
    const solo = byHearts(state.trips[0], state.trips[0].items).map(i => i.id);
    return same([order, heartsFor(r, 'x'), heartNames(r, heartsFor(r, 'y')), solo], [['Gelato', 'Pantheon', 'Forum'], [], 'You and Ann', ['a', 'b', 'c']]);
  })));
  check('A heart is given and taken back, and plans deleted meanwhile leave the list', () => sandbox(() => {
    state = both();
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: {}, shared: {} };
    const r = romeOf(state);
    r.hearts = { selfcheck: ['gone'], ann: ['x'] };
    const given = [toggleHeart(r, 'x'), JSON.stringify(r.hearts)];
    const back = [toggleHeart(r, 'x'), JSON.stringify(r.hearts)];
    delete r.hearts.ann;
    toggleHeart(r, 'y'); toggleHeart(r, 'y');
    return same([given, back, 'hearts' in r], [[true, '{"selfcheck":["x"],"ann":["x"]}'], [false, '{"ann":["x"]}'], false]);
  }));
  check('With more than three hearts, the names are cut short', () => withRoot(['selfcheck', 'ann', 'bob', 'cat', 'dan'], () => {
    const real = sync.saved;
    try {
      sync.saved = { uid: 'selfcheck', shared: {} };
      return same(heartNames({ shared: 's1' }, ['ann', 'bob', 'selfcheck', 'cat', 'ghost']), 'You, Ann, and 3 others');
    } finally { sync.saved = real; }
  }));

  check('A chosen name goes to the account, and into each shared trip as one document per person', () => sandbox(() => {
    state = both();
    state.profile = { name: 'Nico' };
    romeOf(state).names = { ann: 'Annie', selfcheck: 'Old name' };
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: {}, shared: { s1: { trip: 'trip2', base: {} } } };
    const own = stateDocs(state), docs = stateDocs(state, 's1');
    sync.saved.linked = false;                // a new device, before the account's documents arrive: it changes nothing
    const early = JSON.parse(stateDocs(state, 's1').name_selfcheck).name;
    sync.saved.linked = true;
    delete state.profile;                     // the name taken away
    const gone = 'name_selfcheck' in stateDocs(state, 's1');
    return same([JSON.parse(own.profile_me), JSON.parse(docs.name_selfcheck).name, JSON.parse(docs.name_ann), 'names' in JSON.parse(docs.trip_trip2),
      Object.keys(own).some(k => k.startsWith('name_')), early, gone, SYNCED_KINDS.test('name_ann') && SYNCED_KINDS.test('profile_me')],
    [{ k: 'profile', name: 'Nico' }, 'Nico', { k: 'name', name: 'Annie', trip: 'trip2', uid: 'ann' }, false, false, 'Old name', false, true]);
  }));
  check('Names are checked when they are read, and come back from the account', () => sandbox(() => {
    state = both();
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: {}, shared: { s1: { trip: 'trip2', base: {} } } };
    const own = stateDocs(sample());
    own.profile_me = stable({ k: 'profile', name: '  Nico \n las ' });
    applyDocs(own);
    const docs = stateDocs(both(), 's1');
    docs.name_ann = stable({ k: 'name', trip: 'trip2', uid: 'ann', name: 'Annie' });
    docs.name_bob = stable({ k: 'name', trip: 'trip2', uid: 'bob', name: '   ' });
    docs['name_<b>'] = stable({ k: 'name', trip: 'trip2', uid: '<b>', name: 'Evil' });
    applyDocs(docs, 's1');
    return same([state.profile, romeOf(state).names, tidyName('Ann\u0007ie'), tidyName('x'.repeat(50)).length, 'profile' in tidyState({ trips: [], profile: { name: ' ' } }),
      tidyTrip({ id: 't', names: { ann: 'Annie', bob: 5, '<b>': 'Eve' } }).names, cleanBackup({ trips: [], profile: { name: 'Nico' } }).profile],
    [{ name: 'Nico las' }, { ann: 'Annie' }, 'Annie', 30, false, { ann: 'Annie' }, undefined]);
  }));
  check('Hearts and the people on a trip show the names they chose, else the start of their email', () => sandbox(() => withRoot(['selfcheck', 'ann', 'bob'], () => {
    state = both();
    state.profile = { name: 'Nico' };
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: {}, shared: {} };
    const r = romeOf(state);
    r.names = { ann: 'Annie' };
    const shown = [heartNames(r, ['bob', 'ann', 'selfcheck']), personName(r, 'selfcheck'), personName(r, 'bob'), personName(r, 'ghost')];
    dropProfile();
    return same([shown, 'profile' in state], [['You, Bob, and Annie', 'Nico', 'Bob', ''], false]);
  })));

  /* ---------- Ideas on the map (maps.js) ---------- */
  group = 'Ideas on the map';
  const onMap = (day, fn) => {
    const real = mapView.day;
    try { mapView.day = day; return fn(); } finally { mapView.day = real; }
  };
  check('Only ideas with a spot are on the map, the ones the group likes most first', () => sandbox(() => withRoot(['selfcheck', 'ann'], () => {
    state = both();
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: {}, shared: {} };
    const r = romeOf(state);
    r.items[0].lat = 41.89; r.items[0].lng = 12.49;           // Forum
    r.items[1].lat = 41.9; r.items[1].lng = 12.48;            // Gelato
    r.items.push({ ...r.items[0], id: 'z', title: 'Somewhere', lat: undefined, lng: undefined });
    r.items.push({ ...r.items[0], id: 'w', title: 'Planned', date: '2026-05-02' });
    r.hearts = { ann: ['y'] };
    const shared = mapIdeas(r).map(s => s.it.title);
    const solo = mapIdeas(state.trips[0]).length;              // Lisbon's idea has no spot
    return same([shared, solo, ideasToggleHTML(state.trips[0]), /2 ideas/.test(ideasToggleHTML(r))], [['Gelato', 'Forum'], 0, '', true]);
  })));
  check('An idea’s pin says how far it is from the day’s stops, and adds it to that day or any day of the trip', () => sandbox(() => onMap('2026-05-01', () => {
    state = sample();
    sync.saved = null;
    const t = state.trips[0];
    Object.assign(t.items[0], { lat: 38.7139, lng: -9.1335 });       // the castle, on 1 May
    Object.assign(t.items[2], { lat: 38.7110, lng: -9.1400, place: 'Martim Moniz' });     // the tram 28 idea
    const s = { it: t.items[2], c: coordsOf(t.items[2], null) };
    const day = ideaPopupHTML(t, s);
    mapView.day = 'all';
    const all = ideaPopupHTML(t, s);
    const dates = h => [...h.matchAll(/data-action="map-add-idea" data-date="([\d-]+)"/g)].map(m => m[1]);
    return same([dates(day), dates(all), /from Castle/.test(day), /from /.test(all), /Martim Moniz/.test(day)],
      [['2026-05-01'], ['2026-05-01', '2026-05-02', '2026-05-03'], true, false, true]);
  })));

  /* ---------- Archived trips (archive.js) ---------- */
  group = 'Archived trips';
  check('Which trips are archived is read back, and a bad mark is left out', () =>
    same(tidyState({ trips: [], archived: { t1: '2026-05-04', '<b>': '2026-05-04', t2: 'soon', t3: 5 } }).archived, { t1: '2026-05-04' }));
  check('The top bar leaves archived trips out, except the one on screen', () => sandbox(() => {
    state = both();
    state.archived = { trip2: '2026-05-04' };
    return same([barTrips(state.trips[0]).map(t => t.id), barTrips(romeOf(state)).map(t => t.id)], [['trip1'], ['trip1', 'trip2']]);
  }));
  check('With every trip archived the app opens on none, but a trip being looked at stays on screen', () => sandbox(() => {
    state = sample();
    state.archived = { trip1: '2026-05-04' };
    state.activeTripId = null;
    const none = [activeTrip(), firstTripId()];
    state.activeTripId = 'trip1';
    return same([...none, activeTrip().id], [null, null, 'trip1']);
  }));
  check('Archiving the trip on screen goes to the trip under way, else the next one, else one without dates, else the latest', () => sandbox(() => {
    const day = (n) => { const d = parseDate(todayISO()); d.setDate(d.getDate() + n); return toISO(d); };
    const trip = (id, from, to) => ({ ...sample().trips[0], id, start: from === null ? '' : day(from), end: to === null ? '' : day(to), items: [] });
    state = { ...sample(), trips: [trip('old', -30, -25), trip('last', -9, -2), trip('later', 20, 25), trip('idea', null, null), trip('soon', 3, 6), trip('now', -1, 1)] };
    const order = [];
    for (let next = soonestTrip(); next; next = soonestTrip()) {
      order.push(next.id);
      state.archived = { ...state.archived, [next.id]: todayISO() };
    }
    return same(order, ['now', 'soon', 'later', 'idea', 'last', 'old']);
  }));
  check('Which trips are archived goes to the account and back, apart from the trips (a shared trip’s too)', () => sandbox(() => {
    state = both();
    state.archived = { trip1: '2026-05-04', trip2: '2026-05-05' };
    const own = stateDocs(state), theirs = stateDocs(state, 's1');
    const marks = Object.keys(own).filter(k => k.startsWith('arch_')).sort();
    const inTrips = [JSON.parse(own.trip_trip1), JSON.parse(theirs.trip_trip2)].some(d => 'archived' in d);
    state = { ...both(), archived: {} };
    applyDocs(own);
    return same([marks, Object.keys(theirs).some(k => k.startsWith('arch_')), inTrips, state.archived, SYNCED_KINDS.test('arch_trip1')],
      [['arch_trip1', 'arch_trip2'], false, false, { trip1: '2026-05-04', trip2: '2026-05-05' }, true]);
  }));
  check('Archiving on another device arrives, unarchiving there too, and archiving here offline is kept', () => {
    const run = (base, local, remote) => sandbox(() => {
      const s = (archived) => ({ ...sample(), archived });
      state = s(local);
      sync.saved = { uid: 'selfcheck', email: '', linked: true, base: stateDocs(s(base)), shared: {} };
      const waiting = waitingCount();
      mergeRemote(stateDocs(s(remote)), new Set());
      return [state.archived, waiting];
    });
    const on = { trip1: '2026-05-04' };
    return same([run({}, {}, on), run(on, on, {}), run({}, on, {})], [[on, 0], [{}, 0], [on, 1]]);
  });
  check('Leaving a shared trip, or deleting a trip, takes its mark away', () => sandbox(() => {
    state = both();
    state.archived = { trip1: '2026-05-04', trip2: '2026-05-05' };
    sync.saved = { uid: 'selfcheck', email: '', linked: true, base: {}, shared: {} };
    dropShare('s1');
    return same([state.trips.map(t => t.id), state.archived], [['trip1'], { trip1: '2026-05-04' }]);
  }));
  check('Closing an archived trip goes back to the trip and section it was opened from, else to a trip on the top bar', () => sandbox(() => {
    const was = { view: ui.view, peek: ui.peek };
    const day = (n) => { const d = parseDate(todayISO()); d.setDate(d.getDate() + n); return toISO(d); };
    try {
      const run = (from, view) => {
        state = both();
        romeOf(state).start = day(-1); romeOf(state).end = day(1);
        state.trips.push({ ...sample().trips[0], id: 'trip3', name: 'Oslo', items: [] });
        state.archived = { trip3: '2026-05-04' };
        state.activeTripId = 'trip3';
        ui.peek = { id: 'trip3', trip: from, view };
        endPeek(view);
        return [state.activeTripId, ui.view, ui.peek];
      };
      return same([run('trip1', 'more'), run('gone', 'plan')], [['trip1', 'more', null], ['trip2', 'plan', null]]);
    } finally {
      ui.view = was.view;
      ui.peek = was.peek;
    }
  }));
  check('A backup keeps which trips are archived, under the ids the trips have', () => {
    const b = cleanBackup({ trips: [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }], archived: { t2: '2026-05-02', gone: '2026-05-03', t1: 'nope' } });
    const all = cleanBackup({ trips: [{ id: 't1', name: 'A' }], archived: { t1: '2026-05-02' } });
    return same([b.archived, b.activeTripId, all.activeTripId, 'archived' in cleanBackup(copy(sample()))], [{ t2: '2026-05-02' }, 't1', null, false]);
  });

  /* ---------- Order of the plans in a day ---------- */
  group = 'Plans';
  check('Plans go by time, then by their spot on the route; the rest in the afternoon, before the evening', () =>
    same([{ id: 'dinner', time: '20:00' }, { id: 'rest' }, { id: 'noon', time: '12:30' }, { id: 'after9', slot: '09:00~01' }, { id: 'nine', time: '09:00' },
      { id: 'late', slot: '20:00~01' }, { id: 'five', time: '17:00' }, { id: 'first', slot: '00:00~01' }]
      .sort(byPlanOrder).map(i => i.id), ['first', 'nine', 'after9', 'noon', 'five', 'rest', 'dinner', 'late']));

  check('“Book ahead” is read from a guide’s words, and only from words that mean it', () =>
    same(['Tickets sell out weeks in advance.', 'Reservations are strongly recommended and essential on weekends.', 'Reservation strongly required.',
      'By appointment only.', 'Entry costs 12 euros, timed tickets.', 'A reservoir with a waiting room.'].map(t => BOOK_TEXT.test(t)),
    [true, false, true, true, false, false]));
  check('Packing ideas go by whole words: Liverpool is not a pool, the Strand Book Store not a beach', () => {
    const swim = title => packingIdeas({ id: 't', name: 'T', start: '', end: '', items: [{ id: 'i', title, category: 'sight', date: '', place: '', notes: '' }] })
      .some(s => s.key === 'swim');
    return same(['Liverpool Street station', 'Strand Book Store', 'Day trip to Bath', 'Bondi Beach', 'Hotel pool', 'Thermal baths'].map(swim),
      [false, false, false, true, true, true]);
  });
  check('The day you change stays starts at the one you leave and ends at the new one', () => {
    const stay = (id, title, date, lat) => ({ id, title, category: 'stay', date, lat, lng: -71 });
    const first = stay('a', 'B&B', '2026-10-13', 42.36), second = stay('b', 'Hotel', '2026-10-16', 40.75);
    const out = stay('c', 'Check out: Hotel', '2026-10-24', 40.75);
    const trip = { items: [first, second, out] };
    const ends = (day, items, t = trip) => { const e = dayEnds(t, day, items, null); return [e.start && e.start.item.id, e.end && e.end.item.id, !!e.out]; };
    return same([
      ends('2026-10-13', [first]), ends('2026-10-14', []), ends('2026-10-16', [second]), ends('2026-10-17', []), ends('2026-10-24', [out]),
      [first, second, out].map(i => startsStay(i, trip, null)),
    ], [[null, 'a', false], ['a', 'a', false], ['a', 'b', true], ['b', 'b', false], [null, null, false], [true, true, false]]);
  });
  check('A stay with a check-out day is left that day, and is no longer the base afterwards', () => {
    const stay = (id, date, until, lat) => ({ id, title: id, category: 'stay', date, until, lat, lng: -71 });
    const first = stay('a', '2026-10-13', '2026-10-15', 42.36), second = stay('b', '2026-10-16', '2026-10-24', 40.75);
    const trip = { items: [first, second] };
    const open = { items: [{ ...first, until: undefined }, second] };     // the first stay has no check-out day
    const ends = (day, items, t = trip) => { const e = dayEnds(t, day, items, null); return [e.start && e.start.item.id, e.end && e.end.item.id, !!e.out]; };
    return same([
      ends('2026-10-14', []), ends('2026-10-15', []), ends('2026-10-16', [second]), ends('2026-10-23', []), ends('2026-10-24', []), ends('2026-10-25', []),
      ends('2026-10-16', [second], open), ends('2026-10-24', [], open), ends('2026-10-25', [], open),
      stayUntil(second), stayUntil({ ...second, until: '2026-10-16' }), stayUntil({ ...second, category: 'sight' }), tidyItem({ ...second, until: 'soon' }).until,
    ], [['a', 'a', false], ['a', null, true], [null, 'b', false], ['b', 'b', false], ['b', null, true], [null, null, false],
      ['a', 'b', true], ['b', null, true], [null, null, false],
      '2026-10-24', '', '', undefined]);
  });
  check('A place picked under a plan’s name gives its own name, unless more than the place was typed', () => {
    const tj = { name: 'Trader Joe\'s', place: '22-43 Jackson Avenue, New York', sub: '22-43 Jackson Avenue, New York' };
    return same([
      titleAfterPick('trader', tj),
      titleAfterPick('Trader Joe’s in Long Island City, 22-43 Jackson Avenue', tj),
      titleAfterPick('Trader Joe’s Jackson Avenue', tj),
      titleAfterPick('Trader Joe’s run with Sam', tj),
      titleAfterPick('Dinner at Carbone', { name: 'Carbone', place: '181 Thompson Street, New York', sub: '' }),
    ], ['Trader Joe\'s', 'Trader Joe\'s', 'Trader Joe\'s', 'Trader Joe’s run with Sam', 'Dinner at Carbone']);
  });
  check('The forecast is for where each day is spent: the city, else the day’s stay or its plans', () => {
    const at = (id, category, date, lat, lng) => ({ id, title: id, category, date, lat, lng });
    const plans = [
      at('air', 'transport', '2026-10-13', 42.36, -71.01), at('a', 'stay', '2026-10-13', 42.37, -71.1), at('salem', 'sight', '2026-10-15', 42.52, -70.89),
      at('train', 'transport', '2026-10-16', 42.35, -71.05), at('b', 'stay', '2026-10-16', 40.75, -73.94), at('shop', 'shopping', '2026-10-16', 40.75, -73.95),
      at('falls1', 'sight', '2026-10-18', 43.08, -79.07), at('falls2', 'sight', '2026-10-18', 43.09, -79.06),
    ];
    const country = { place: { kind: 'country', lat: 39.8, lng: -100.4 }, items: plans };
    const city = { place: { kind: 'city', lat: 42.36, lng: -71.06 }, items: plans.slice(0, 3) };
    const left = { place: country.place, items: [{ ...plans[4], until: '2026-10-20' }] };     // a stay with a check-out day
    const spot = (trip, day) => { const s = weatherSpot(trip, day, null); return s && [s.lat, s.lng]; };
    return same([
      spot(country, '2026-10-14'), spot(country, '2026-10-15'), spot(country, '2026-10-16'), spot(country, '2026-10-17'), spot(country, '2026-10-18'),
      spot({ place: country.place, items: [] }, '2026-10-14'), spot(city, '2026-10-15'), spot({ place: city.place, items: [] }, '2026-10-14'),
      spot(left, '2026-10-19'), spot(left, '2026-10-20'), spot(left, '2026-10-21'),
    ], [[42.37, -71.1], [42.37, -71.1], [40.75, -73.94], [40.75, -73.94], [43.1, -79.1], null, [42.36, -71.06], [42.36, -71.06],
      [40.75, -73.94], [40.75, -73.94], null]);
  });
  check('A small chance of drizzle is not a rainy day', () => {
    const look = (code, rain) => { const w = { rain, ...weatherLook(code, rain) }; return [w.icon, !!w.wet, !!rainLikely(w)]; };
    return same([look(51, 11), look(61, 33), look(53, 41), look(63, 90), look(3, 65), look(95, 10), weatherLook(61).wet],
      [['cloud', false, false], ['rainy', true, false], ['rainy', true, true], ['rainy', true, true], ['cloud', false, true], ['thunderstorm', true, false], true]);
  });
  check('Calendar times use the time zone of where the day is spent, not of the middle of the country', () => sandbox(() => {
    const real = { weather: weather.saved, essentials: essentials.saved };
    const stay = (id, date, lat, lng) => ({ id, title: id, category: 'stay', date, lat, lng });
    const trip = { id: 't', start: '2026-10-13', end: '2026-10-20', place: { kind: 'country', lat: 39.8, lng: -100.4, osm: 'R1' },
      items: [stay('a', '2026-10-13', 42.37, -71.1), stay('b', '2026-10-16', 40.75, -73.94), stay('c', '2026-10-19', 34.05, -118.24)] };
    const zone = (t, day) => { zoneMemo.clear(); return tripTimeZone(t, day); };
    try {
      essentials.saved = { R1: { tz: 'America/Chicago' } };
      weather.saved = { '42.37,-71.10': { fetched: 1, days: {}, tz: 'America/New_York' }, '34.05,-118.24': { fetched: 1, days: {}, tz: 'America/Los_Angeles' } };
      const got = [zone(trip, '2026-10-14'), zone(trip, '2026-10-17'), zone(trip, '2026-10-20'), zone({ ...trip, items: [] }, '2026-10-14')];
      weather.saved = {};
      return same([...got, zone(trip, '2026-10-14'), zone({ id: 'u', items: [] }, '2026-10-14')],
        ['America/New_York', 'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'America/Chicago', '']);
    } finally {
      weather.saved = real.weather;
      essentials.saved = real.essentials;
      zoneMemo.clear();
    }
  }));
  check('On a trip to a country, a plan’s link to the map names the town it is in', () => {
    const trip = { name: 'USA', place: { kind: 'country', name: 'United States', label: 'United States', lat: 39.8, lng: -100.4 } };
    const city = { name: 'Boston', place: { kind: 'city', name: 'Boston', label: 'Boston, Massachusetts, United States', lat: 42.36, lng: -71.06 } };
    const query = (...args) => new URL(mapsUrl(...args)).searchParams.get('query');
    const at = { lat: 42.339, lng: -71.094 };
    // The guides saved on this device are set aside: one made-up guide, around Boston.
    const real = { ...savedGuides };
    const empty = () => { for (const k of Object.keys(savedGuides)) delete savedGuides[k]; };
    try {
      empty();
      savedGuides['near:selfcheck'] = { kind: 'near', city: 'Boston', center: { lat: 42.36, lng: -71.06 }, places: [] };
      return same([query('Museum of Fine Arts', trip, at), query('Museum of Fine Arts', trip), query('465 Huntington Ave, Boston', trip, at),
        query('Boston Common', trip, at), query('Space Needle', trip, { lat: 47.62, lng: -122.35 }), query('Museum of Fine Arts', city, at)],
      ['Museum of Fine Arts, Boston, United States', 'Museum of Fine Arts, United States', '465 Huntington Ave, Boston, United States',
        'Boston Common, United States', 'Space Needle, United States', 'Museum of Fine Arts, Boston, Massachusetts, United States']);
    } finally {
      empty();
      Object.assign(savedGuides, real);
    }
  });
  check('On a trip to a town, a plan in another town isn’t sent to the trip’s town on the map', () => {
    const trip = { name: 'Daun', place: { kind: 'city', name: 'Daun', label: 'Daun, Germany', lat: 50.19625, lng: 6.8305, bbox: [6.7441, 50.161, 6.8755, 50.2461] } };
    const query = (...args) => new URL(mapsUrl(...args)).searchParams.get('query');
    const real = { ...savedGuides };
    const empty = () => { for (const k of Object.keys(savedGuides)) delete savedGuides[k]; };
    try {
      empty();
      return same([
        query('Am Bahnhof', trip, { lat: 50.1955, lng: 7.37125 }, 'Moselkern'),                          // 24 miles away, no town in the address
        query('Clara-Viebig-Straße, Bad Bertrich', trip, { lat: 50.06913, lng: 7.03182 }, 'Vulkaneifel Therme'),
        query('Auf der Holl, Schalkenmehren', trip, { lat: 50.16553, lng: 6.85597 }, 'Hike'),          // a village of Daun
        query('Am Bahnhof', trip, null, 'Station'),
        query('Daun', trip, { lat: 50.19825, lng: 6.82968 }, 'Volcano Museum, Daun'),
        query('Daun', trip, null, 'Volcano Museum'),
        query('Leopoldstraße 1, Daun', trip, { lat: 50.1974, lng: 6.83003 }, 'Café U'),
        query('Austraße 10, 52156 Monschau, Germany', trip, { lat: 50.5546, lng: 6.2443 }, 'Monschau'),
      ], ['50.1955,7.37125', 'Clara-Viebig-Straße, Bad Bertrich, Germany', 'Auf der Holl, Schalkenmehren, Daun, Germany', 'Am Bahnhof, Daun, Germany',
        'Volcano Museum, Daun', 'Volcano Museum, Daun, Germany', 'Leopoldstraße 1, Daun', 'Austraße 10, 52156 Monschau, Germany']);
    } finally {
      empty();
      Object.assign(savedGuides, real);
    }
  });
  check('A sight is not taken for the station named after it', () =>
    same(['Museum of Fine Arts station', 'Brooklyn Bridge–City Hall/Chambers Street station', 'Harvard station', 'Museum of Fine Arts, Boston', 'Fenway Park', 'Grand Central Terminal']
      .map(t => TRANSIT_ARTICLE.test(t)), [true, true, true, false, false, false]));
  check('A trip being edited keeps its place under a new name, and a new trip is looked up again', () => {
    const real = { id: editingTripId, chosen: placeSearch.chosen, name: tripForm.elements.name.value };
    const place = { name: 'United States', label: 'United States', kind: 'country', lat: 39.8, lng: -100.4 };
    const rename = (editing) => {
      editingTripId = editing;
      placeSearch.chosen = place;
      tripForm.elements.name.value = 'USA with Sam';
      onTripNameInput();
      clearTimeout(placeSearch.timer);        // no search: this only checks what happens to the place
      return placeSearch.chosen;
    };
    try {
      return same([rename('trip1'), rename(null)], [place, null]);
    } finally {
      editingTripId = real.id;
      placeSearch.chosen = real.chosen;
      tripForm.elements.name.value = real.name;
      showChosenPlace();
    }
  });
  check('Matching places are looked for around the plan being edited, else the stay of its day', () => {
    const stay = (id, date, lat) => ({ id, title: id, category: 'stay', date, lat, lng: -71 });
    const plan = { id: 'p', title: 'Shop', category: 'shopping', date: '2026-10-16', lat: 40.74, lng: -73.94 };
    const trip = { items: [{ id: 'air', title: 'Airport', category: 'transport', date: '2026-10-13', lat: 42.3, lng: -71 }, stay('a', '2026-10-13', 42.36), stay('b', '2026-10-16', 40.75), plan] };
    const lat = (item, day) => matchCenter(trip, null, item, day).lat;
    return same([lat(plan, '2026-10-16'), lat(null, '2026-10-14'), lat(null, '2026-10-20'), lat(null, ''), matchCenter({ items: [] }, null, null, '')],
      [40.74, 42.36, 40.75, 42.3, null]);
  });
  check('The list of matching places stays until a click on Save is over, so Save doesn’t move away under it', () => {
    const list = itemForm.querySelector('[data-match="title"]'), btn = itemForm.querySelector('[type="submit"]');
    showMatches('title', [{ name: 'Target', place: '1 Main Street', sub: '', cat: 'shopping', lat: 1, lng: 1 }]);
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const during = list.hidden;
    planMatch.press = planMatch.late = false;
    btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));      // with the keyboard: right away
    return same([during, list.hidden, planMatch.field], [false, true, '']);
  });
  check('A street address is not taken for a town with the street’s name, nor a plan for a namesake far away', () => {
    const guide = prepGuide({ id: 'check', places: [{ id: 'j', name: 'Jackson', lat: 43.48, lng: -110.76 }, { id: 'p', name: 'Central Park', lat: 40.78, lng: -73.97 }] });
    const ids = item => matchPlaces(item, guide).map(p => p.id);
    return same([
      ids({ title: 'Trader Joe\'s', place: '22-43 Jackson Avenue, New York', lat: 40.7459, lng: -73.946 }),
      ids({ title: 'Shopping on Jackson Avenue', place: '', lat: 40.7459, lng: -73.946 }),
      ids({ title: 'Walk', place: 'Central Park, New York', lat: 40.77, lng: -73.97 }),
      ids({ title: 'Arrive in Jackson', place: '' }),
    ], [[], [], ['p'], ['j']]);
  });
  // A trip across a country: Munich's "Residenz" is in the guide, Würzburg has one too, 140 miles away.
  const twoTowns = () => {
    const guide = prepGuide({ id: 'check', kind: 'destinations', places: [
      { id: 'res', name: 'Residenz', lat: 48.141, lng: 11.578, local: true }, { id: 'dd', name: 'Dresden', lat: 51.05, lng: 13.74 }] });
    const plan = (id, title, date, at) => ({ id, title, category: 'sight', date, time: '', place: '', link: '', notes: '', done: false, ...(at ? { lat: at[0], lng: at[1] } : {}) });
    const s = sample();
    s.trips[0].items = [
      plan('hotel', 'Hotel', '2026-11-02', [48.136, 11.58]), plan('muc', 'Residenz tour', '2026-11-02'),
      plan('bridge', 'Old bridge', '2026-11-04', [49.79, 9.93]), plan('wue', 'Würzburg Residenz', '2026-11-04'), plan('dd', 'Arrive in Dresden', '2026-11-04'),
    ];
    return { s, guide };
  };
  check('A plan is not the place with its name in another town: where it is, or the plans around it, decide', () => sandbox(() => {
    const { s, guide } = twoTowns();
    state = s;
    const ids = id => matchPlaces(item(s, id), guide).map(p => p.id);
    const at = (id, lat, lng) => matchPlaces({ ...item(s, id), lat, lng }, guide).map(p => p.id);
    return same([ids('muc'), ids('wue'), ids('dd'), at('wue', 49.7928, 9.9389), at('muc', 48.14, 11.58), at('dd', 51.2, 13.9)],
      [['res'], [], ['dd'], [], ['res'], ['dd']]);
  }));
  check('A plan with an address is looked up on the map, also when its name is a place in the guide', () =>
    same([{ place: 'Residenzplatz 2, Würzburg' }, { place: 'Residenzplatz 2', lat: 49.79, lng: 9.94 }, { place: 'Nowhere 1', geoMiss: true }, { place: '' }]
      .map(i => !!needsLookup({ title: 'Residenz', ...i })), [true, false, false, false]));
  check('Travel times and distances grow with the distance, without a jump', () => {
    for (const mode of ['drive', 'transit']) {
      let last = travel(1.3, mode);
      for (let d = 1.4; d < 400; d += 0.1) {
        const t = travel(d, mode);
        if (t.mins < last.mins || t.mins > last.mins + 5 || t.dist <= last.dist) return `${mode}: ${last.mins} min at ${(d - 0.1).toFixed(1)} mi, ${t.mins} min at ${d.toFixed(1)} mi`;
        last = t;
      }
    }
    // By car: 20 km across the country is about half an hour, 200 km some two and a half hours.
    // By transit, door to door: 2 miles across town is over half an hour, 4 miles (airport to town) 45 minutes.
    return same([travel(20 / 1.609, 'drive').mins, travel(200 / 1.609, 'drive').mins, travel(2, 'transit').mins, travel(4, 'transit').mins], [25, 145, 35, 45]);
  });
  check('By car, the real road between two stops replaces the estimate once it is known, and only by car', () => {
    // Eltz Castle to the Geierlay bridge: 13 km in a straight line, 46 km around the Mosel valley.
    const a = { lat: 50.20507, lng: 7.33677 }, b = { lat: 50.08997, lng: 7.34115 };
    const real = roadRoutes.saved;
    try {
      roadRoutes.saved = {};
      const guess = legTravel(a, b, 'drive');
      // The way back ends more than a mile from any road: that leg stays an estimate.
      roadRoutes.saved = Object.fromEntries(readRoads([a, b, a], { code: 'Ok',
        routes: [{ legs: [{ distance: 45624, duration: 4695 }, { distance: 40000, duration: 3000 }] }], waypoints: [{ distance: 70 }, { distance: 130 }, { distance: 2000 }] }));
      const road = legTravel(a, b, 'drive');
      // A day's total: to the minute when every drive is a real road, to the half hour with an estimate in it.
      return same([!!guess.road, road.text, Math.round(road.dist * 1.609), road.mins, !!legTravel(b, a, 'drive').road, !!legTravel(a, b, 'transit').road,
        readRoads([a, b], { code: 'NoRoute' }), readRoads([a, b], { code: 'Ok', routes: [{ legs: [] }] }),
        routeTravel([a, b], 'drive').time, routeTravel([a, b, a], 'drive').time, routeTravel([a, b], 'transit').time, routeTravel([a], 'drive').time],
      [false, '1 h 20 min drive', 46, 80, false, false, null, null, '1 h 20 min', '~1.5 h', '~1 h', '0 min']);
    } finally {
      roadRoutes.saved = real;
    }
  });

  /* ---------- AI answers ---------- */
  group = 'AI Assistant answers';
  check('An answer is read, also when wrapped in other text', () => {
    const a = parseAnswer('Sure!\n```json\n{"reply":" Hi ","add":[{"title":"X"}, 5],"update":[],"remove":[{"id":"a","title":"ignored"}],"dates":{"start":"2026-05-01","end":"2026-05-03"}}\n```\nDone.');
    return same([a.text, a.changes.map(c => c.action), a.changes[1]], ['Hi', ['add', 'delete', 'set_dates'], { id: 'a', action: 'delete' }]);
  });
  check('An answer without the expected format is refused', () =>
    [throws(() => parseAnswer('I can’t help with that.')), throws(() => parseAnswer('{not json}'))].every(r => r === true) || 'a bad answer was accepted');
  check('Proposed changes are checked against the trip before they can be applied', () => sandbox(() => {
    state = sample();
    const trip = state.trips[0];
    const out = checkChanges(trip, [
      { action: 'add', title: 'Fado night', date: '2026-02-31', time: '21:00', category: '<x>' },
      { action: 'add', title: '' },
      { action: 'update', id: 'nobody', title: 'Ghost' },
      { action: 'update', id: 'a', title: 'Castle', time: '99:00' },
      { action: 'update', id: 'a', date: '' },
      { action: 'delete', id: 'b' },
      { action: 'set_dates', start: '2026-05-09', end: '2026-05-02' },
      { action: 'set_dates', start: 'soon', end: '2026-05-02' },
      { action: 'format_disk' },
    ]);
    const add = out[0].item;
    return same([out.map(c => c.kind), add.date, add.time, add.category, isId(add.id), out[1].patch, out[3].start, out[3].end, trip.items.length],
      [['add', 'update', 'delete', 'dates'], '', '', 'other', true, { date: '' }, '2026-05-02', '2026-05-09', 3]);
  }));
  check('A plan the AI adds is pinned on a guide place by its id, or by its name when it has no address and is near that day’s plans', () => sandbox(() => {
    const { s, guide } = twoTowns();
    state = s;
    guideFor = () => guide;
    const out = checkChanges(s.trips[0], [
      { action: 'add', title: 'Residenz', date: '2026-11-02' },
      { action: 'add', title: 'Residenz', place: 'Residenzstraße 1, München', date: '2026-11-02' },
      { action: 'add', title: 'Würzburg Residenz', date: '2026-11-04' },
      { action: 'add', title: 'Palace', place: 'Residenzstraße 1', guide_id: 'res', date: '2026-11-02' },
    ]);
    return same(out.map(c => c.item.guideId || (typeof c.item.lat === 'number' ? 'pinned' : 'not pinned')), ['res', 'not pinned', 'not pinned', 'res']);
  }));

  /* ---------- Opening hours ---------- */
  group = 'Opening hours';
  check('Hours are read per day of the week', () => {
    const rules = parseHours('Mo-Fr 09:00-17:00; Sa 10:00-14:00');
    // 3, 4 and 5 October 2026: a Saturday, a Sunday and a Monday.
    return same(['2026-10-03', '2026-10-04', '2026-10-05'].map(d => hoursOn(rules, d)), [[[600, 840]], [], [[540, 1020]]]);
  });
  check('Closing after midnight and "closed" are understood', () => {
    const rules = parseHours('Mo-Su 18:00-02:00; Tu off');
    return same([hoursOn(rules, '2026-10-05'), hoursOn(rules, '2026-10-06')], [[[1080, 1560]], []]);
  });
  check('Hours the app can’t read give no note, not a guess', () =>
    same([parseHours('whenever we feel like it'), parseHours(''), parseHours('Mo-Fr 9am to 5pm')], [null, null, null]));
  check('Only the closed day is known: a warning that day, no "Open all day" on the others', () => sandbox(() => {
    state = sample();
    const guide = prepGuide({ id: 'g', places: [{ id: 'lib', name: 'Castle', lat: 38.7, lng: -9.1, hours: 'Mon-Sat 10AM-6PM, closed Sun' }] });
    const on = date => hoursNote({ title: 'Castle', category: 'sight', place: '', date }, guide);
    // 3 and 4 October 2026: a Saturday and a Sunday.
    return same([on('2026-10-03'), on('2026-10-04').warn], [null, true]);
  }));
  check('A place’s hours are not those of a street, a station or a namesake next to it', () => same([
    hoursFit({ title: 'Century 21', place: '22 Cortlandt Street, Manhattan' }, { name: 'Cortlandt Street', railway: 'station' }),
    hoursFit({ title: 'Century 21', place: '22 Cortlandt Street, Manhattan' }, { name: 'Cortlandt Street' }),
    hoursFit({ title: 'Salem Witch Trials Memorial', place: 'Liberty Street, Salem, MA' }, { name: 'Salem Wax Museum' }),
    hoursFit({ title: 'DUMBO', place: 'DUMBO, Brooklyn' }, { name: 'Salon Dumbo' }),
    hoursFit({ title: 'Lunch at Chelsea Market', place: '75 Ninth Avenue, Manhattan' }, { name: 'Chelsea Market' }),
    hoursFit({ title: 'Strand Book Store', place: '828 Broadway, New York, NY' }, { name: 'Strand Bookstore' }),
    hoursFit({ title: 'Maybe Happy Ending', place: 'Belasco Theatre, 111 W 44th Street, Manhattan' }, { name: 'Belasco Theatre' }),
    hoursFit({ title: 'Flatiron Building', place: 'Flatiron Building' }, { name: 'On' }),
    hoursFit({ title: 'St. Patrick’s Cathedral', place: 'Fifth Avenue and 50th Street' }, { name: 'Saint Patrick’s Cathedral', alt_name: 'St. Patrick\'s Cathedral' }),
  ], [0, 0, 0, 0, 1, 1, 1, 0, 1]));

  /* ---------- Addresses and distances ---------- */
  group = 'Addresses and distances';
  check('A house number on "Fifth Avenue" is searched on "5th Avenue"', () => same([
    numbered('476 Fifth Avenue, Manhattan'), numbered('75 Ninth Ave'), numbered('Fifth Avenue and 50th Street, Manhattan'),
    numbered('12 First Lane, Boston'), numbered('Hauptstraße 52'), numbered(''),
  ], ['476 5th Avenue, Manhattan', '75 9th Ave', 'Fifth Avenue and 50th Street, Manhattan', '12 First Lane, Boston', 'Hauptstraße 52', '']));
  check('Just under a kilometre is "1.0 km", never "1000 m"', () => sandbox(() => {
    state = sample();
    state.settings = { ...defaultSettings(), units: 'metric' };
    return same([0.5, 0.6, 0.615, 0.62, 6.19, 6.2].map(fmtDist), ['800 m', '950 m', '1.0 km', '1.0 km', '10 km', '10 km']);
  }));
  check('Signing in doesn’t add the starting checklist a second time', () => {
    const doc = (id, text) => stable({ k: 'check', pos: 0, id, text, done: false });
    const local = { check_a: doc('a', 'ID / wallet'), check_b: doc('b', 'Sunscreen'), trip_t: stable({ k: 'trip', id: 't', name: 'Rome' }) };
    const keep = new Set(Object.keys(local));
    dropSameChecks(keep, local, { check_z: doc('z', 'ID / Wallet '), trip_u: stable({ k: 'trip', id: 'u', name: 'Rome' }) });
    return same([...keep].sort(), ['check_b', 'trip_t']);
  });

  /* ---------- Texts from the travel guide ---------- */
  group = 'Texts from the travel guide';
  const guideText = 'The size of the U.S. and the distance between cities make flying common. Trains are slow. Visit St. Louis, e.g. by car. Tickets cost 3.5 dollars! Really? Yes.';
  check('Text is cut into sentences, not at "U.S.", "St." or "3.5"', () =>
    same(sentencesOf(guideText).map(s => s.trim()), ['The size of the U.S. and the distance between cities make flying common.', 'Trains are slow.',
      'Visit St. Louis, e.g. by car.', 'Tickets cost 3.5 dollars!', 'Really?', 'Yes.']));
  check('Cutting into sentences loses nothing', () => same(sentencesOf(guideText).join(''), guideText));
  check('Wiki markup is taken out, also a picture whose caption has a link', () =>
    same(plainText("[[File:Bus.jpg|thumb|A [[Greyhound Lines|Greyhound]] bus|250x250px]]The '''size''' of the [[United States|U.S.]] matters.<ref>source</ref> {{EUR|15}} [[Image:x.png]]end [[File:broken"),
      'The size of the U.S. matters. 15 EUR end [[File:broken'));
  check('Leftovers of the wiki page are tidied: "&nbsp;", empty brackets', () =>
    same(plainText('It is 300&nbsp;km wide &ndash; fly to Lisbon ({{IATA|LIS}}), Porto ({{IATA|OPO}}) &amp; Faro. Caf&#233; &bogus;'),
      'It is 300 km wide – fly to Lisbon, Porto & Faro. Café &bogus;'));
  check('A summary and a description start at the beginning of the text', () => {
    const long = guideText + ' ' + 'More words follow here. '.repeat(40);
    const got = [sectionSummary(long), shortBlurb(long), longBlurb(long)];
    return got.every(t => t.startsWith('The size of the U.S. and the distance')) || `got ${stable(got.map(t => t.slice(0, 30)))}`;
  });
  check('A guide photo is the direct address when known; a redirecting link only when it couldn\'t be asked; never a map', () => {
    const x = (name, more) => ({ name, type: 'see', blurb: '', about: '', price: '', lat: 1, lng: 1, ...more });
    const photos = listingPlaces([
      x('A', { image: 'A.jpg', thumb: 'https://thumb.wikimedia.org/a.jpg' }),
      x('B', { image: 'Gone.jpg', thumb: '' }),
      x('C', { image: 'C.jpg' }),
      x('D', { image: 'Map.svg' }),
      x('E', { photoUrl: 'https://thumb.wikimedia.org/e.jpg' }),
    ], 'X').map(p => p.photo || '');
    return same(photos, ['https://thumb.wikimedia.org/a.jpg', '', commonsPhoto('C.jpg'), '', 'https://thumb.wikimedia.org/e.jpg']);
  });
  check('Essentials show the voltage at a wall socket, not the three-phase one (France said "400 V")', () =>
    same([['400', '230'], ['220', '127'], ['120'], ['11000'], []].map(socketVolts), ['230 V', '127/220 V', '120 V', '', '']));

  /* ---------- Voting for new features ---------- */
  group = 'Voting for new features';
  check('Votes are counted once per person, and the most wanted comes first', () => {
    const features = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    const got = tallyVotes(features, { ann: ['b', 'b', 'c', 'gone'], bob: ['b'], me: ['c', 'a'] }, 'me');
    return same(got.map(f => [f.key, f.votes, f.voted]), [['b', 2, false], ['c', 2, true], ['a', 1, true]]);
  });
  check('A suggestion from someone else is checked before it is shown', () =>
    same([tidyIdea('abc_0', { title: '  ' + 'T'.repeat(200), text: 7, uid: 'abc', at: 5 }), tidyIdea('abc_9', { title: 'x', uid: 'abc' }),
      tidyIdea('abc_1', { title: '', uid: 'abc' }), tidyIdea('<b>_1', { title: 'x', uid: 'abc' }), tidyIdea('abc_1', null)],
    [{ key: 'abc_0.5', doc: 'abc_0', uid: 'abc', at: 5, title: 'T'.repeat(80), text: '' }, null, null, null, null]));
  check('The voting sheet says the votes are saved, without anything to send', () =>
    same([voteStatus(0, true), voteStatus(1, true), voteStatus(3, true), voteStatus(2, false)],
      ['Tap an idea to vote for it', '1 vote saved', '3 votes saved', '2 votes kept for when you’re online']));
  check('A suggestion for something the app now does leaves the list, in English or French', () => {
    const was = voting.ideas;
    try {
      voting.ideas = ['Archive old trips', 'Archiver les voyages finis', 'Trip budget per day'].map((title, i) => ({ key: `u_${i}.1`, doc: `u_${i}`, uid: 'u', at: 1, title, text: '' }));
      return same(votingFeatures().slice(FEATURE_IDEAS.length).map(f => f.title), ['Trip budget per day']);
    } finally {
      voting.ideas = was;
    }
  });
  check('The app’s own proposals each have a name, a text and an id of their own', () =>
    (FEATURE_IDEAS.every(f => isId(f.id) && f.title && f.text) && new Set(FEATURE_IDEAS.map(f => f.id)).size === FEATURE_IDEAS.length) || 'a proposal is not filled in right');

  /* ---------- Languages (i18n.js, lang/…) ---------- */
  group = 'Languages';
  const inLang = (lang, fn) => { const was = LANG; LANG = lang; try { return fn(); } finally { LANG = was; } };
  check('A text gets its names filled in, and stays in English when it has no translation', () =>
    same(inLang('fr', () => [T('Day {n}', { n: 3 }), T('Not a text of the app {x}', { x: 1 }), T('{n} h ahead of you', {})]),
      ['Jour 3', 'Not a text of the app 1', '{n} h d’avance sur vous']));
  check('French says “0 activité” and “1 activité”, English “0 plans”', () =>
    same([inLang('fr', () => [0, 1, 2].map(n => Tn(n, '{n} plan', '{n} plans'))), [0, 1, 2].map(n => Tn(n, '{n} plan', '{n} plans'))],
      [['0 activité', '1 activité', '2 activités'], ['0 plans', '1 plan', '2 plans']]));
  check('French writes days in French and decimals with a comma', () => sandbox(() => {
    state = sample();
    state.settings = { ...defaultSettings(), units: 'metric', dateOrder: 'mdy' };
    return same(inLang('fr', () => [fmtDay('2026-05-01', { weekday: 'long', day: 'numeric', month: 'long' }), fmtDist(1), fmtDuration(90)]),
      ['vendredi 1 mai', '1,6 km', '~1,5 h']);
  }));
  // The {names} and the markup (<b>, <span class="ok">) have to be the same in every language.
  const parts = s => [...(s.match(/\{\w+\}/g) || []), ...(s.match(/<[^>]+>/g) || [])].sort().join(' ');
  for (const [lang, dict] of Object.entries(DICTS)) {
    check(`Every ${LANGS[lang]} text keeps the names and markup of the English one`, () => {
      const bad = Object.entries(dict).filter(([en, text]) => typeof text !== 'string' || !text.trim() || parts(en) !== parts(text));
      return !bad.length || 'not the same: ' + bad.slice(0, 5).map(([en]) => en).join(' | ');
    });
  }
  // Every text of the app, as the code and the page have it: T('…'), Tn(n, '…', '…'), What's new, and index.html.
  check('Every text of the app has a translation, and every translation a text', () => {
    const texts = new Set(CHANGELOG.flatMap(c => c.items));
    const unquote = s => s.replace(/\\(.)/g, '$1');
    for (const file of codeFiles().filter(f => !['js/i18n.js', 'js/lang/fr.js', 'firebase-config.js'].includes(f))) {
      const code = read(file);
      for (const m of code.matchAll(/\bT\(\s*'((?:[^'\\]|\\.)*)'/g)) texts.add(unquote(m[1]));
      for (const m of code.matchAll(/\bTn\([^']*?'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) { texts.add(unquote(m[1])); texts.add(unquote(m[2])); }
    }
    // The page's own texts, taken as translatePage takes them.
    const page = new DOMParser().parseFromString(read('index.html'), 'text/html');
    const add = s => { const t = String(s || '').trim().replace(/\s+/g, ' '); if (/[a-z]{2}/i.test(t) && t !== 'https://') texts.add(t); };
    const walk = page.createTreeWalker(page.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!n.parentElement.closest('script, style')) add(n.nodeValue);
    for (const el of page.body.querySelectorAll('[data-i18n]')) add(el.innerHTML);
    for (const attr of ['aria-label', 'title', 'placeholder']) for (const el of page.body.querySelectorAll(`[${attr}]`)) add(el.getAttribute(attr));
    const problems = [];
    for (const [lang, dict] of Object.entries(DICTS)) {
      const missing = [...texts].filter(t => !(t in dict));
      const unused = Object.keys(dict).filter(t => !texts.has(t));
      if (missing.length) problems.push(`${missing.length} without ${LANGS[lang]}: ${missing.slice(0, 8).join(' | ')}`);
      if (unused.length) problems.push(`${unused.length} ${LANGS[lang]} not used: ${unused.slice(0, 8).join(' | ')}`);
    }
    return !problems.length || problems.join(' — ');
  });

  /* ---------- How the code is put together ---------- */
  group = 'The code';
  const page = () => new DOMParser().parseFromString(read('index.html'), 'text/html');
  const sources = () => [...codeFiles(), 'index.html'].map(f => [f, read(f)]);
  check('Every file the page loads is saved for offline use, and every saved file is loaded', () => {
    const list = read('sw.js').match(/const FILES = \[([\s\S]*?)\];/);
    const saved = new Set(list ? [...list[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map(m => m[1]) : []);
    const doc = page();
    const loaded = [...doc.querySelectorAll('script[src], link[rel="stylesheet"]')].map(el => el.getAttribute('src') || el.getAttribute('href'));
    const unsaved = loaded.filter(f => !saved.has(f));
    const unused = [...saved].filter(f => /^(js|css)\//.test(f) && f !== 'js/selfcheck.js' && !loaded.includes(f));
    return (!unsaved.length && !unused.length) || `not in sw.js: ${unsaved.join(', ') || '-'}; in sw.js but not loaded: ${unused.join(', ') || '-'}`;
  });
  check('Every button’s data-action has an action (onAction)', () => {
    const missing = new Set();
    for (const [file, text] of sources()) {
      for (const m of text.matchAll(/data-action="([a-z][\w-]*)"/g)) if (!ACTIONS.has(m[1])) missing.add(`${m[1]} (${file})`);
    }
    return !missing.size || 'no action for ' + [...missing].join(', ');
  });
  check('No two files use the same name at the top level', () => {
    // Two "function save" in two files: the second one silently replaces the first.
    const seen = new Map();
    const twice = [];
    for (const [file, text] of sources().filter(([f]) => f.endsWith('.js'))) {
      for (const m of text.matchAll(/^(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/gm)) {
        if (seen.has(m[1])) twice.push(`${m[1]} (${seen.get(m[1])}, ${file})`);
        else seen.set(m[1], file);
      }
    }
    return !twice.length || twice.join(', ');
  });
  check('The page keeps its security policy: scripts from the app’s own files only, no plugins', () => {
    const meta = page().querySelector('meta[http-equiv="Content-Security-Policy"]');
    const csp = meta ? meta.getAttribute('content') : '';
    if (!/script-src 'self'/.test(csp)) return 'no script-src \'self\' in index.html';
    if (/unsafe-inline|unsafe-eval|script-src[^;]*\*/.test(csp)) return 'the policy lets other code run: ' + csp;
    return /object-src 'none'/.test(csp) || 'object-src \'none\' is missing';
  });
  check('The page only talks to the services the app uses, and each one the code calls is on the list (connect-src)', () => {
    const meta = page().querySelector('meta[http-equiv="Content-Security-Policy"]');
    const csp = meta ? meta.getAttribute('content') : '';
    const allowed = ((csp.match(/connect-src([^;]*)/) || [])[1] || '').trim().split(/\s+/).filter(Boolean);
    if (!allowed.length || allowed.some(a => /^(\*|https?:|data:|blob:)$/.test(a))) return 'connect-src is missing, or lets the page talk to any server: ' + allowed.join(' ');
    const ok = host => allowed.some((a) => {
      const m = a.match(/^https:\/\/(\*\.)?([^/]+)\/?$/);
      return m && (m[1] ? host.endsWith('.' + m[2]) : host === m[2]);
    });
    // Addresses written in a fetch(…) or getJSON(…), directly or through a constant (const OVERPASS = 'https://…').
    const missing = [];
    for (const [file, text] of sources().filter(([f]) => f.endsWith('.js'))) {
      const consts = new Map([...text.matchAll(/^const ([A-Z_]+) = ['`]https:\/\/([^/'`]+)/gm)].map(m => [m[1], m[2]]));
      for (const m of text.matchAll(/\b(?:fetch|getJSON)\(\s*(?:['`]https:\/\/([^/'`$]+)|`?\$?\{?([A-Z_]+)\b)/g)) {
        const host = m[1] || consts.get(m[2]);
        if (host && !ok(host)) missing.push(`${host} (${file})`);
      }
    }
    return !missing.length || 'not in connect-src: ' + missing.join(', ');
  });
  check('The map style’s credit lines (HTML from another site) never reach the map', () => {
    const style = { sources: { a: { type: 'vector', attribution: '<details open ontoggle=alert(1)>' } }, layers: [] };
    return !('attribution' in tuneMapStyle(style, 'light').sources.a) || 'tuneMapStyle keeps the attribution';
  });
  check('No code in the page’s HTML: no onclick="…", no javascript: links', () => {
    // The page's security policy would block them anyway; this says where they are.
    const bad = [];
    for (const [file, text] of sources()) {
      for (const m of text.matchAll(/<[a-z][^<>]*?\son[a-z]+\s*=\s*["'`$]|(?:href|src)\s*=\s*["'`]\s*javascript:/gi)) bad.push(`${file}: ${m[0].slice(0, 60)}`);
    }
    return !bad.length || bad.join(' | ');
  });
  check('Links that open a new tab can’t reach back into the app (rel="noopener")', () => {
    const bad = [];
    for (const [file, text] of sources()) {
      for (const m of text.matchAll(/<a\b(?:[^<>]|\$\{[^}]*\})*?target="_blank"(?:[^<>]|\$\{[^}]*\})*>/g)) {
        if (!/rel="[^"]*noopener/.test(m[0])) bad.push(`${file}: ${m[0].slice(0, 80)}`);
      }
    }
    return !bad.length || bad.join(' | ');
  });

  /* ---------- Report a problem ---------- */
  group = 'Report a problem';
  check('A report carries the version and the state of the app, but nothing from the plans', () => sandbox(() => {
    state = sample();
    state.checklist[0].text = 'Passport';
    const text = problemDetails();
    if (!text.includes(`Version: ${APP_VERSION}`) || !text.includes('1 trip, 3 plans')) return 'the version or the counts are missing: ' + text;
    const leaked = ['Lisbon', 'Castle', 'Castelo', 'Lunch', 'Book a table', 'Tram 28', 'Passport'].filter(w => text.includes(w));
    return !leaked.length || 'it gives away: ' + leaked.join(', ');
  }));

  /* ---------- The list of versions ---------- */
  group = 'What’s new';
  check('Every version says what is new in a few short lines, with no title of its own', () => {
    for (const c of CHANGELOG) {
      if ('title' in c) return `version ${c.v} has a title`;
      if (c.items.length > 5) return `version ${c.v} lists ${c.items.length} things (5 at most)`;
      const long = c.items.find(t => t.length > 110);
      if (long) return `version ${c.v} has a long line: ${long}`;
      if (c.items.some(t => /^fixed\b/i.test(t))) return `version ${c.v} details a fix (say "Bug fixes" once)`;
    }
    return true;
  });
  check('Every version has a number, a real date and something to say, newest first', () => {
    const num = v => v.split('.').map(Number);
    const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
    for (const [i, c] of CHANGELOG.entries()) {
      if (!/^\d+\.\d+\.\d+$/.test(c.v) || !isDate(c.date) || !Array.isArray(c.items) || !c.items.length || !c.items.every(t => typeof t === 'string' && t)) return `version ${c.v} is not filled in right`;
      const next = CHANGELOG[i + 1];
      if (next && (!newer(c.v, next.v) || c.date < next.date)) return `version ${c.v} should come after ${next.v}`;
    }
    return same([APP_VERSION, CHANGELOG[0].date <= todayISO()], [CHANGELOG[0].v, true]);
  });

  return results;
}

// Shows the result in a sheet. Also handy from the browser's console: runSelfCheck().filter(r => !r.ok)
function showSelfCheck() {
  const results = runSelfCheck();
  const failed = results.filter(r => !r.ok);
  const groups = [...new Set(results.map(r => r.group))];
  $('#about-title').textContent = `Self-check · version ${APP_VERSION}`;
  $('#about-body').innerHTML = `
    <p class="selfcheck-sum ${failed.length ? 'bad' : ''}">${icon(failed.length ? 'error' : 'check')}${failed.length
      ? `${failed.length} of ${plural(results.length, 'check')} failed. Don’t ship this version.`
      : `All ${results.length} checks passed.`}</p>
    ${groups.map(g => `
      <section class="tip">
        <h3>${esc(g)}</h3>
        <ul class="selfcheck">${results.filter(r => r.group === g).map(r => `
          <li class="${r.ok ? '' : 'bad'}">${icon(r.ok ? 'check' : 'error')}<span>${esc(r.name)}${r.ok ? '' : `<small>${esc(r.detail)}</small>`}</span></li>`).join('')}
        </ul>
      </section>`).join('')}
    <p class="footnote">Run on made-up plans. Yours were not touched.</p>`;
  $('#about-dialog').showModal();
  $('#about-body').scrollTop = 0;
  return results;
}
