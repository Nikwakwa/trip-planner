'use strict';

/* =========================================================
   A stand-in for Firebase, to test sign-in, sync and shared trips on this computer
   without real accounts. Never loaded by the app itself.

   In the browser's console, on a copy of the app that is not signed in:
     await loadScript('tools/fake-firebase.js');
     await fakeFirebase.signIn('ann@test.org');          // the app is now "signed in" as Ann
     const bob = fakeFirebase.as('bob@test.org');        // a database handle for someone else
     await bob.collection('shared').doc(id).update(...)  // what Bob's device would send
     fakeFirebase.dump()                                 // everything the pretend database holds

   The pretend database lives in this page's memory only. It applies the same rules as
   firestore.rules, written again in JavaScript below: keep the two in step.
   ========================================================= */

const fakeFirebase = (() => {
  const docs = new Map();          // 'users/u1/docs/trip_x' → the document
  const listeners = new Set();
  const authWatchers = new Set();
  let current = null;              // the account the app is signed in with
  const DELAY = 15;                // ms: an answer is never instant
  const options = { oldRules: false };   // true: as if the rules for shared trips were never published

  const clone = v => JSON.parse(JSON.stringify(v));
  const uidOf = email => 'u_' + email.toLowerCase().replace(/\W/g, '_');
  const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  const later = fn => new Promise((resolve, reject) => setTimeout(() => { try { resolve(fn()); } catch (e) { reject(e); } }, DELAY));

  /* ---------- What a write changes ---------- */

  class FieldPath { constructor(...parts) { this.parts = parts; } }
  const FieldValue = {
    arrayUnion: (...els) => ({ __op: 'union', els }),
    arrayRemove: (...els) => ({ __op: 'remove', els }),
    delete: () => ({ __op: 'delete' }),
  };
  function setAt(obj, parts, value) {
    let o = obj;
    for (const p of parts.slice(0, -1)) o = (o[p] && typeof o[p] === 'object') ? o[p] : (o[p] = {});
    const last = parts[parts.length - 1];
    if (value && value.__op === 'delete') delete o[last];
    else if (value && value.__op === 'union') o[last] = [...(o[last] || []), ...value.els.filter(e => !(o[last] || []).includes(e))];
    else if (value && value.__op === 'remove') o[last] = (o[last] || []).filter(e => !value.els.includes(e));
    else o[last] = clone(value);
  }
  // update(field, value, field, value…) or update({ field: value })
  function updated(old, args) {
    const out = clone(old);
    const pairs = args.length === 1 ? Object.entries(args[0]) : args.reduce((list, a, i) => (i % 2 ? list : [...list, [a, args[i + 1]]]), []);
    for (const [field, value] of pairs) setAt(out, field instanceof FieldPath ? field.parts : String(field).split('.'), value);
    return out;
  }

  /* ---------- The rules of firestore.rules, in JavaScript ---------- */

  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  function soundRoot(d) {
    return d && same(Object.keys(d), ['owner', 'trip', 'code', 'uids', 'members'])
      && typeof d.owner === 'string' && typeof d.trip === 'string' && d.trip && d.trip.length <= 100
      && typeof d.code === 'string' && d.code.length >= 12 && d.code.length <= 40
      && Array.isArray(d.uids) && d.uids.length >= 1 && d.uids.length <= 20
      && d.members && typeof d.members === 'object' && Object.keys(d.members).length === d.uids.length
      && same(Object.keys(d.members), d.uids) && d.uids.includes(d.owner);
  }
  function myEntry(d, user) {
    const m = d.members[user.uid];
    return m && Object.keys(m).every(k => ['email', 'at', 'via'].includes(k)) && m.email === user.email
      && typeof m.at === 'number' && typeof m.via === 'string' && m.via.length <= 40;
  }
  const changedKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

  // op: 'read' | 'create' | 'update' | 'delete'. old / next: the document before and after.
  function allowed(user, path, op, old, next) {
    if (!user) return false;
    const p = path.split('/');
    if (p[0] === 'users' && p[2] === 'docs') return p[1] === user.uid;
    if (p[0] === 'featureVotes' || p[0] === 'featureIdeas') return true;
    if (p[0] !== 'shared' || options.oldRules) return false;
    if (p.length === 4 && p[2] === 'docs') {
      const root = docs.get(`shared/${p[1]}`);
      return !!root && root.uids.includes(user.uid);
    }
    if (p.length !== 2) return false;
    const me = user.uid;
    if (op === 'read') return !!old && old.uids.includes(me);
    if (op === 'delete') return !!old && old.owner === me;
    if (!soundRoot(next)) return false;
    if (op === 'create') return next.owner === me && same(next.uids, [me]) && myEntry(next, user);
    if (!old || next.owner !== old.owner || next.trip !== old.trip) return false;
    const touched = changedKeys(next.members, old.members);
    const join = !old.uids.includes(me) && next.code === old.code && same(next.uids, [...old.uids, me])
      && touched.every(k => k === me) && myEntry(next, user) && next.members[me].via === old.code;
    const leave = old.uids.includes(me) && me !== old.owner && next.code === old.code
      && same(next.uids, old.uids.filter(u => u !== me)) && touched.every(k => k === me);
    const owner = me === old.owner && next.uids.every(u => old.uids.includes(u))
      && touched.every(k => !(k in next.members));
    return join || leave || owner;
  }

  /* ---------- Reading: snapshots and listeners ---------- */

  const docSnap = (handle, path) => {
    const data = docs.get(path);
    return { id: path.split('/').pop(), ref: handle.doc(path), exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)), metadata: { hasPendingWrites: false, fromCache: false } };
  };
  const listSnap = (handle, paths) => {
    const list = paths.map(p => docSnap(handle, p));
    return { docs: list, size: list.length, empty: !list.length, forEach: fn => list.forEach(fn), metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const inCollection = col => [...docs.keys()].filter(p => p.startsWith(col + '/') && !p.slice(col.length + 1).includes('/')).sort();

  // Tells every listener whose answer changed (or that lost its right to listen).
  function notify() {
    for (const l of [...listeners]) {
      setTimeout(() => {
        if (!listeners.has(l)) return;
        let answer;
        try { answer = l.read(); } catch (err) { listeners.delete(l); if (l.fail) l.fail(err); return; }
        const text = JSON.stringify(answer.docs ? answer.docs.map(d => [d.id, d.data()]) : [answer.exists, answer.data()]);
        if (text === l.last) return;
        l.last = text;
        l.next(answer);
      }, DELAY);
    }
  }
  function listen(read, next, fail) {
    const l = { read, next, fail, last: null };
    listeners.add(l);
    notify();
    return () => listeners.delete(l);
  }

  /* ---------- A database handle, as one account sees it ---------- */

  function database(getUser) {
    const write = (changes) => later(() => {
      // changes: [path, 'set' | 'update' | 'delete', data or update arguments]
      const user = getUser();
      const results = [];
      let checks = 0;
      for (const [path, kind, arg] of changes) {
        const old = docs.get(path);
        if (/^shared\/[^/]+\/docs\//.test(path)) checks++;
        if (kind === 'update' && old === undefined) throw denied();
        const next = kind === 'delete' ? undefined : kind === 'set' ? clone(arg) : updated(old, arg);
        const op = kind === 'delete' ? 'delete' : old === undefined ? 'create' : 'update';
        if (!allowed(user, path, op, old, next)) throw denied();
        results.push([path, next]);
      }
      // Firestore allows only 20 look-ups of other documents while checking one batch.
      if (checks > 20) throw denied();
      for (const [path, next] of results) { if (next === undefined) docs.delete(path); else docs.set(path, next); }
      notify();
    });

    const handle = {
      doc(path) {
        return {
          id: path.split('/').pop(),
          path,
          collection: name => handle.collection(`${path}/${name}`),
          set: data => write([[path, 'set', data]]),
          update: (...args) => write([[path, 'update', args]]),
          delete: () => write([[path, 'delete']]),
          get: () => later(() => {
            if (!allowed(getUser(), path, 'read', docs.get(path))) throw denied();
            return docSnap(handle, path);
          }),
          onSnapshot: (next, fail) => listen(() => {
            if (!allowed(getUser(), path, 'read', docs.get(path))) throw denied();
            return docSnap(handle, path);
          }, next, fail),
        };
      },
      collection(col) {
        const readAll = (filter) => {
          const user = getUser();
          const parts = col.split('/');
          // A whole collection of shared trips can't be read: only "the ones I am on".
          if (col === 'shared' && (options.oldRules || !(filter && filter.field === 'uids' && user && filter.value === user.uid))) throw denied();
          let paths = inCollection(col);
          if (filter) paths = paths.filter(p => Array.isArray(docs.get(p)[filter.field]) && docs.get(p)[filter.field].includes(filter.value));
          if (col !== 'shared' && !allowed(user, `${col}/x`, 'read')) throw denied();
          if (parts.length === 1 && !user) throw denied();
          return listSnap(handle, paths);
        };
        const query = filter => ({
          where: (field, op, value) => query({ field, value }),
          limit: () => query(filter),
          get: () => later(() => readAll(filter)),
          onSnapshot: (next, fail) => listen(() => readAll(filter), next, fail),
        });
        return { ...query(null), doc: id => handle.doc(`${col}/${id}`) };
      },
      batch() {
        const changes = [];
        const b = {
          set: (ref, data) => { changes.push([ref.path, 'set', data]); return b; },
          update: (ref, ...args) => { changes.push([ref.path, 'update', args]); return b; },
          delete: (ref) => { changes.push([ref.path, 'delete']); return b; },
          commit: () => write(changes),
        };
        return b;
      },
      waitForPendingWrites: () => later(() => {}),
    };
    return handle;
  }

  /* ---------- Accounts ---------- */

  function userOf(email) {
    return {
      uid: uidOf(email), email, emailVerified: true,
      reload: () => later(() => {}),
      getIdTokenResult: () => later(() => ({ claims: { email } })),
      sendEmailVerification: () => later(() => {}),
      reauthenticateWithCredential: () => later(() => {}),
      updatePassword: () => later(() => {}),
      delete: () => later(() => setUser(null)),
    };
  }
  function setUser(user) {
    current = user;
    for (const fn of authWatchers) setTimeout(() => fn(current), DELAY);
    notify();
  }
  const auth = {
    get currentUser() { return current; },
    onAuthStateChanged(fn) { authWatchers.add(fn); setTimeout(() => fn(current), DELAY); return () => authWatchers.delete(fn); },
    signInWithEmailAndPassword: email => later(() => { setUser(userOf(email)); return { user: current }; }),
    createUserWithEmailAndPassword: email => later(() => { setUser(userOf(email)); return { user: current }; }),
    sendPasswordResetEmail: () => later(() => {}),
    signOut: () => later(() => setUser(null)),
  };

  // The app loads the real Firebase files before it signs in: here they are skipped.
  if (typeof loadScript === 'function') {
    const real = loadScript;
    loadScript = src => (/vendor\/firebase\//.test(src) ? Promise.resolve() : real(src));
  }
  window.firebase = {
    initializeApp: () => ({ auth: () => auth, firestore: () => database(() => current) }),
    firestore: { FieldValue, FieldPath },
    auth: { EmailAuthProvider: { credential: () => ({}) } },
  };

  return {
    // Signs the app in as that account (as the sign-in sheet would).
    async signIn(email) { await signIn(email, 'password', false); },
    uid: uidOf,
    options,
    // The database as another account's device would use it.
    as: email => database(() => userOf(email)),
    dump: () => Object.fromEntries([...docs].map(([k, v]) => [k, clone(v)])),
    paths: prefix => [...docs.keys()].filter(p => p.startsWith(prefix || '')).sort(),
    get: path => (docs.has(path) ? clone(docs.get(path)) : undefined),
    FieldValue,
    FieldPath,
  };
})();
