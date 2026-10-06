'use strict';

/* =========================================================
   Account & sync between phones (Firebase).
   Every phone signed in with the same email and password shares one copy
   of the trips, plans and checklist. Appearance settings stay per phone.
   The app keeps working offline; changes are sent once back online.

   How it works: the plans are stored as small documents in the account
   ("trip_…", "item_…", "check_…"). After every change the app compares its
   plans with what the account has and sends only the differences. When
   another phone changes something, the account tells this phone right away.
   Functions here use helpers from app.js, which is loaded after this file.
   ========================================================= */

const SYNC_KEY = 'tripPlanner.sync';
const FIREBASE_FILES = ['app', 'auth', 'firestore'].map(p => `vendor/firebase/firebase-${p}-compat.js`);

const sync = {
  configured: !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey),
  auth: null,
  db: null,
  col: null,          // this account's documents
  unsubscribe: null,
  // Saved on the phone: who is signed in, and the last copy of the account's
  // documents this phone knows about ("base"), to spot changes made offline.
  saved: readSyncInfo(),
  known: null,        // what the account has now, including our writes on the way
  inflight: new Map(),// document → number of writes not confirmed yet
  firstSnap: null,    // first answer after signing in, waiting for the merge question
  asking: false,
  status: 'off',      // off | connecting | synced | sending | error
  error: '',
};

function readSyncInfo() {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_KEY));
    if (s && s.uid) return { base: {}, linked: false, ...s };
  } catch { /* fall through */ }
  return null;
}
function writeSyncInfo() {
  try {
    if (sync.saved) localStorage.setItem(SYNC_KEY, JSON.stringify(sync.saved));
    else localStorage.removeItem(SYNC_KEY);
  } catch { /* storage full: sync still works, it just re-checks more next time */ }
}

function setSyncStatus(status, error = '') {
  if (sync.status === status && sync.error === error) return;
  sync.status = status;
  sync.error = error;
  if (ui.view === 'more') render();
}

/* ---------- Plans ⇄ documents ---------- */

// JSON with keys in a fixed order (and no empty fields), so equal data gives equal text.
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort()
      .map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

const docKey = (kind, id) => `${kind}_${encodeURIComponent(id)}`;

function stateDocs(s) {
  const out = {};
  s.trips.forEach((t, pos) => {
    const { items, ...trip } = t;
    out[docKey('trip', t.id)] = stable({ k: 'trip', pos, ...trip });
    items.forEach((it, i) => { out[docKey('item', it.id)] = stable({ k: 'item', trip: t.id, pos: i, ...it }); });
  });
  s.checklist.forEach((c, pos) => { out[docKey('check', c.id)] = stable({ k: 'check', pos, ...c }); });
  return out;
}

// Rebuilds the plans from the account's documents. Keeps the same objects
// where possible, so an "Undo" that's still on screen keeps working.
function applyDocs(docs) {
  // Each document is checked first (app.js): one the app can't use is left out.
  const tidy = d => (!d ? null : d.k === 'trip' ? tidyTrip(d) : d.k === 'item' ? tidyItem(d) : d.k === 'check' ? tidyCheck(d) : null);
  const all = Object.values(docs).map(j => tidy(JSON.parse(j))).filter(Boolean);
  const byPos = (a, b) => (a.pos - b.pos) || (a.id < b.id ? -1 : 1);
  const tripDocs = all.filter(d => d.k === 'trip').sort(byPos);

  const reuse = (old, data) => {
    if (!old) return data;
    for (const k of Object.keys(old)) if (!(k in data)) delete old[k];
    return Object.assign(old, data);
  };
  const oldTrips = new Map(state.trips.map(t => [t.id, t]));
  const oldItems = new Map(state.trips.flatMap(t => t.items).map(i => [i.id, i]));
  const oldChecks = new Map(state.checklist.map(c => [c.id, c]));

  const trips = tripDocs.map(({ k, pos, ...t }) => {
    const old = oldTrips.get(t.id);
    const items = old ? old.items : [];
    items.length = 0;
    return reuse(old, { ...t, items });
  });
  const tripById = new Map(trips.map(t => [t.id, t]));
  for (const { k, trip, pos, ...it } of all.filter(d => d.k === 'item').sort(byPos)) {
    const t = tripById.get(trip);
    if (t) t.items.push(reuse(oldItems.get(it.id), it));
  }
  state.trips = trips;
  state.checklist = all.filter(d => d.k === 'check').sort(byPos).map(({ k, pos, ...c }) => reuse(oldChecks.get(c.id), c));
  if (!trips.some(t => t.id === state.activeTripId)) state.activeTripId = trips.length ? trips[0].id : null;
  return true;
}

/* ---------- Sending changes ---------- */

// Called after every save(): sends whatever differs from the account.
function pushChanges() {
  if (!sync.col || !sync.known) return;
  const local = stateDocs(state);
  const writes = [];
  for (const k in local) if (local[k] !== sync.known[k]) writes.push([k, local[k]]);
  for (const k in sync.known) if (!(k in local)) writes.push([k, null]);
  if (!writes.length) return;

  for (const [k, v] of writes) {
    if (v === null) delete sync.known[k]; else sync.known[k] = v;
    sync.inflight.set(k, (sync.inflight.get(k) || 0) + 1);
  }
  setSyncStatus('sending');
  // Firestore takes at most 500 changes at once.
  for (let i = 0; i < writes.length; i += 400) {
    const chunk = writes.slice(i, i + 400);
    const batch = sync.db.batch();
    for (const [k, v] of chunk) {
      if (v === null) batch.delete(sync.col.doc(k));
      else batch.set(sync.col.doc(k), JSON.parse(v));
    }
    // Resolves once the account has the changes (stays waiting while offline).
    batch.commit().then(() => {
      for (const [k, v] of chunk) {
        const left = sync.inflight.get(k) - 1;
        if (left > 0) { sync.inflight.set(k, left); continue; }
        sync.inflight.delete(k);
        if (v === null) delete sync.saved.base[k]; else sync.saved.base[k] = v;
      }
      sync.saved.at = Date.now();
      writeSyncInfo();
      if (!sync.inflight.size) setSyncStatus('synced');
    }, (err) => {
      for (const [k] of chunk) {
        const left = sync.inflight.get(k) - 1;
        if (left > 0) sync.inflight.set(k, left); else sync.inflight.delete(k);
      }
      console.warn('Sync failed', err);
      setSyncStatus('error', syncErrorText(err));
    });
  }
}

/* ---------- Receiving changes ---------- */

function onAccountSnapshot(snap) {
  // Only trust answers from the server: an empty offline cache must never wipe the plans.
  if (snap.metadata.fromCache) return;
  const remote = {};
  const pending = new Set();
  snap.forEach((d) => {
    remote[d.id] = stable(d.data());
    if (d.metadata.hasPendingWrites) pending.add(d.id);
  });

  if (!sync.saved.linked) {
    sync.firstSnap = { remote, pending };
    askHowToLink();
    return;
  }
  mergeRemote(remote, pending);
}

// Combines the account's copy with changes made on this phone that the
// account hasn't confirmed yet (for example, made while offline).
function mergeRemote(remote, pending, keepLocal) {
  const base = sync.saved.base;
  const local = stateDocs(state);
  const changedHere = keepLocal || new Set(
    [...new Set([...Object.keys(local), ...Object.keys(base)])].filter(k => local[k] !== base[k]));

  const merged = { ...remote };
  for (const k of changedHere) {
    if (k in local) merged[k] = local[k]; else delete merged[k];
  }
  // What the account has confirmed becomes the new base (except our writes still on the way).
  for (const k of new Set([...Object.keys(remote), ...Object.keys(base)])) {
    if (sync.inflight.has(k) || pending.has(k)) continue;
    if (k in remote) base[k] = remote[k]; else delete base[k];
  }
  sync.saved.at = Date.now();   // when this phone last heard from the account
  writeSyncInfo();

  const differs = Object.keys(merged).length !== Object.keys(local).length ||
    Object.keys(merged).some(k => merged[k] !== local[k]);
  if (differs && applyDocs(merged)) {
    saveLocal();
    renderSoon();
  }
  sync.known = { ...remote };
  if (!sync.inflight.size) setSyncStatus('synced');
  pushChanges();
}

// First time this phone connects to the account: combine or replace?
async function askHowToLink() {
  if (sync.asking) return;
  const { remote } = sync.firstSnap;
  const remoteTrips = Object.values(remote).map(j => JSON.parse(j)).filter(d => d.k === 'trip');
  const local = stateDocs(state);
  const phoneOnly = Object.keys(local).filter(k => !(k in remote));
  const phoneTrips = state.trips.filter(t => phoneOnly.includes(docKey('trip', t.id)));

  let keep;
  if (!remoteTrips.length) {
    keep = new Set(Object.keys(local));        // New account: it starts with this phone's plans.
  } else if (!phoneTrips.length) {
    keep = new Set();                          // Nothing new here: use the account's plans.
  } else {
    sync.asking = true;
    const names = list => list.map(t => t.name).join(', ');
    const ok = await askConfirm({
      icon: 'sync',
      title: 'Add this device’s trips?',
      text: `Your account already has ${names(remoteTrips.sort((a, b) => a.pos - b.pos))}. This device also has ${names(phoneTrips)}. ` +
        'Add them to the account? If not, this device switches to the account’s plans.',
      ok: 'Add them',
      cancel: 'Don’t add',
    });
    sync.asking = false;
    if (!sync.saved) return;                   // Signed out meanwhile.
    keep = ok ? new Set(phoneOnly) : new Set();
  }
  sync.saved.linked = true;
  sync.saved.base = {};
  const { remote: latest, pending } = sync.firstSnap;
  sync.firstSnap = null;
  mergeRemote(latest, pending, keep);
  snackbar(`Signed in — plans sync with ${sync.saved.email}`);
}

// Redraw after changes from another phone, but not while typing in the page.
let renderQueued = false;
function renderSoon() {
  if (renderQueued) return;
  renderQueued = true;
  const run = () => {
    renderQueued = false;
    render();
    if (mapShown()) refreshMap();
  };
  const el = document.activeElement;
  if (el && $('#main').contains(el) && /^(INPUT|TEXTAREA)$/.test(el.tagName)) {
    el.addEventListener('blur', () => setTimeout(run, 0), { once: true });
  } else {
    requestAnimationFrame(run);
  }
}

/* ---------- Starting up, signing in and out ---------- */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load ' + src));
    document.head.append(s);
  });
}

let firebaseLoading = null;
function loadFirebase() {
  firebaseLoading = firebaseLoading || (async () => {
    for (const f of FIREBASE_FILES) await loadScript(f);
    const app = firebase.initializeApp(window.FIREBASE_CONFIG);
    sync.auth = app.auth();
    sync.db = app.firestore();
    sync.auth.onAuthStateChanged(onUser);
  })().catch((e) => { firebaseLoading = null; throw e; });
  return firebaseLoading;
}

function startSync() {
  if (!sync.configured) return;
  if (sync.saved) setSyncStatus('connecting');
  // Only load Firebase right away if this phone is signed in.
  if (sync.saved) loadFirebase().catch(() => setSyncStatus('error', 'Couldn’t load sync. Check your connection.'));
}

function onUser(user) {
  if (sync.unsubscribe) { sync.unsubscribe(); sync.unsubscribe = null; }
  sync.col = null;
  sync.known = null;
  sync.inflight.clear();
  if (!user) {
    if (sync.saved) { sync.saved = null; writeSyncInfo(); }
    setSyncStatus('off');
    return;
  }
  if (!sync.saved || sync.saved.uid !== user.uid) {
    sync.saved = { uid: user.uid, email: user.email, base: {}, linked: false };
    writeSyncInfo();
  }
  setSyncStatus('connecting');
  sync.col = sync.db.collection('users').doc(user.uid).collection('docs');
  sync.unsubscribe = sync.col.onSnapshot(onAccountSnapshot, (err) => {
    console.warn('Sync stopped', err);
    setSyncStatus('error', syncErrorText(err));
  });
}

async function signIn(email, password, create) {
  await loadFirebase();
  if (create) await sync.auth.createUserWithEmailAndPassword(email, password);
  else await sync.auth.signInWithEmailAndPassword(email, password);
}

async function resetPassword(email) {
  await loadFirebase();
  await sync.auth.sendPasswordResetEmail(email);
}

// Firebase asks for the password again before a change of password or deleting the account.
async function confirmUser(password) {
  await loadFirebase();
  // Just after loading, Firebase needs a moment to remember who is signed in.
  const user = sync.auth.currentUser || await new Promise((resolve) => {
    const off = sync.auth.onAuthStateChanged((u) => { off(); resolve(u); });
  });
  if (!user) throw { code: 'auth/user-token-expired' };
  await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
  return user;
}

// Other phones are signed out by Firebase (within the hour); this one stays signed in.
async function changePassword(current, next) {
  const user = await confirmUser(current);
  await user.updatePassword(next);
}

// Deletes the account's documents, then the login itself. The plans stay on this phone.
async function deleteAccount(password) {
  const user = await confirmUser(password);
  const col = sync.db.collection('users').doc(user.uid).collection('docs');
  // Stop listening first: the emptied account would empty this phone too.
  if (sync.unsubscribe) { sync.unsubscribe(); sync.unsubscribe = null; }
  sync.col = null;
  sync.known = null;
  sync.inflight.clear();
  // If it fails halfway, the phone connects again like a new one and puts its plans back.
  if (sync.saved) { sync.saved.linked = false; sync.saved.base = {}; writeSyncInfo(); }
  try {
    await sync.db.waitForPendingWrites();   // or a change still on its way would come back afterwards
    const snap = await col.get({ source: 'server' });
    const refs = snap.docs.map(d => d.ref);
    for (let i = 0; i < refs.length; i += 400) {
      const batch = sync.db.batch();
      refs.slice(i, i + 400).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
    await user.delete();
  } catch (err) {
    onUser(sync.auth.currentUser);
    throw err;
  }
  sync.saved = null;
  writeSyncInfo();
  setSyncStatus('off');
}

async function signOut() {
  // Firebase remembers the sign-in by itself: it has to be loaded to make it forget.
  if (!sync.auth) await loadFirebase().catch(() => {});
  if (sync.auth) await sync.auth.signOut();
  sync.saved = null;
  writeSyncInfo();
  setSyncStatus('off');
}

function syncErrorText(err) {
  const code = (err && err.code) || '';
  const texts = {
    'auth/invalid-credential': 'Email or password is wrong.',
    'auth/wrong-password': 'Email or password is wrong.',
    'auth/user-not-found': 'Email or password is wrong.',
    'auth/invalid-login-credentials': 'Email or password is wrong.',
    'auth/email-already-in-use': 'There’s already an account with this email. Sign in instead.',
    'auth/weak-password': 'Use at least 6 characters for the password.',
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/missing-password': 'Enter the password.',
    'auth/network-request-failed': 'No connection. Try again when you’re online.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.',
    'auth/user-token-expired': 'This device was signed out. Sign in again first.',
    'auth/requires-recent-login': 'Sign out, sign in again, then retry.',
    'auth/operation-not-allowed': 'Email sign-in isn’t turned on in Firebase yet (see README).',
    'permission-denied': 'The account’s database won’t allow this. Check the Firestore rules (see README).',
    'unavailable': 'Can’t reach the account right now. Changes will be sent later.',
  };
  if (code.startsWith('auth/api-key-not-valid') || code === 'auth/invalid-api-key') {
    return 'The Firebase settings in firebase-config.js look wrong (see README).';
  }
  return texts[code] || (err && err.message) || 'Something went wrong.';
}

// How many changes made on this phone the account hasn't confirmed yet (counted per trip, plan or checklist item).
function waitingCount() {
  if (!sync.saved || !sync.saved.linked) return 0;
  const local = stateDocs(state);
  const base = sync.saved.base;
  let n = 0;
  for (const k in local) if (local[k] !== base[k]) n++;
  for (const k in base) if (!(k in local)) n++;
  return n;
}

// "today at 14:30" or "on 3 Oct": a clock time, so it isn't wrong a minute later.
function lastSyncText() {
  const at = sync.saved && sync.saved.at;
  if (!at) return '';
  const d = new Date(at);
  const day = toISO(d);
  return day === todayISO() ? `today at ${fmtClock(d)}` : `on ${fmtDay(day, { month: 'short', day: 'numeric' })}`;
}

function syncStatusText() {
  const n = waitingCount();
  const waiting = `${plural(n, 'change')} waiting`;
  const last = lastSyncText();
  if (!navigator.onLine) {
    if (n) return `${waiting} — sent when you’re back online`;
    return last ? `Offline — everything was saved ${last}` : 'Offline — changes will sync when you’re back online';
  }
  switch (sync.status) {
    case 'connecting': return n ? `Connecting… ${waiting}` : 'Connecting…';
    case 'sending': return n ? `Sending ${plural(n, 'change')}…` : 'Sending changes…';
    case 'synced': return `<span class="ok">All changes saved</span>${last ? ` · last synced ${last}` : ''}`;
    case 'error': return esc(sync.error) + (n ? ` · ${waiting}` : '');
    default: return '';
  }
}
