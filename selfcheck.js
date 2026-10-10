'use strict';

/* =========================================================
   Self-check: tests the parts of the app that must not break (dates, checking data from
   outside, backups, merging the account's plans, AI answers, opening hours).
   Open the app with "?selfcheck" at the end of its address to run it, before every update
   that ships, and on a new kind of device. It is only loaded then.
   It works on made-up plans: the real ones are set aside while it runs and nothing is saved.
   ========================================================= */

function runSelfCheck() {
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

  /* ---------- Order of the plans in a day ---------- */
  group = 'Plans';
  check('Plans go by time, then by their spot on the route, then the rest', () =>
    same([{ id: 'rest' }, { id: 'noon', time: '12:30' }, { id: 'after9', slot: '09:00~01' }, { id: 'nine', time: '09:00' }, { id: 'first', slot: '00:00~01' }]
      .sort(byPlanOrder).map(i => i.id), ['first', 'nine', 'after9', 'noon', 'rest']));

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
  check('The app’s own proposals each have a name, a text and an id of their own', () =>
    (FEATURE_IDEAS.every(f => isId(f.id) && f.title && f.text) && new Set(FEATURE_IDEAS.map(f => f.id)).size === FEATURE_IDEAS.length) || 'a proposal is not filled in right');

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
