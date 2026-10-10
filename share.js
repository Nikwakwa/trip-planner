'use strict';

/* =========================================================
   Planning a trip together: one trip, several accounts.

   A trip becomes shared when someone invites people to it. From then on it is kept outside
   that person's account, in a place of its own in the Firebase project:
     shared/{id}            who is on it: { owner, trip, code, uids: [account…],
                            members: { account: { email, at, via } } }
     shared/{id}/docs/…     the trip and its plans, in the same form as an account's own
   firestore.rules lets only the accounts in "uids" read and change them. An invitation is a
   link that carries the id and the code: joining adds the account to the list, and the rules
   check the code. The owner (who started it) can take people off, which changes the code,
   and can delete the trip for everyone. The others can leave.

   In the app such a trip is marked `trip.shared = id`. sync.js keeps its documents apart from
   the account's own and syncs them the same way. The checklist, and all that is kept per
   device (tickets, AI chats, settings), are never shared.
   Functions here use helpers from app.js and sync.js, which are loaded after this file.
   ========================================================= */

const SHARE_MAX = 20;        // people on one trip (firestore.rules says the same)
// Changes sent in one go to a shared trip. The database checks each of them against the list of
// people on the trip, and allows only a few such checks at once.
const SHARED_BATCH = 10;
const CODE_LETTERS = 'abcdefghijkmnpqrstuvwxyz23456789';     // 32 of them: no "l" or "o", which read like 1 and 0
const INVITE = /\b([a-z2-9]{20})\.([a-z2-9]{12})\b/;
const SHARE_OFF = 'Planning together isn’t switched on for this copy of the app yet.';

const sharing = {
  uid: null,            // the account signed in
  roots: {},            // the shared trips it is on: id → { id, owner, trip, code, members: [{ uid, email, at }] }
  ready: false,         // that list has arrived
  off: false,           // the database's rules are older than this version of the app
  stop: null,           // switches the listening off
  listed: new Set(),    // every trip that list has named since signing in
  holding: new Set(),   // being started or joined on this device: not opened before that is done
  quiet: new Set(),     // being left on purpose: no "no longer shared with you"
  invite: null,         // an invitation waiting for the sign-in, or for the account to answer
  show: null,           // a trip just joined: opened as soon as it arrives
  busy: false,
};

function randomCode(n) {
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), b => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
}

// An invitation is the shared trip's id and its code. In a link they come after the "#", the part
// of an address that browsers keep to themselves: the app's host never sees it.
const inviteLink = root => `${location.origin}${location.pathname}#join=${root.id}.${root.code}`;
function readInvite(text) {
  const m = INVITE.exec(String(text || ''));
  return m ? { id: m[1], code: m[2] } : null;
}

// Who is on a shared trip, as the database has it. Other people wrote parts of it: checked first.
function tidyRoot(id, d) {
  if (!d || !isId(id) || typeof d.owner !== 'string' || !isId(d.trip) || !Array.isArray(d.uids)) return null;
  const details = d.members && typeof d.members === 'object' ? d.members : {};
  const members = d.uids.filter(u => typeof u === 'string' && u).slice(0, SHARE_MAX).map((u) => {
    const m = details[u] && typeof details[u] === 'object' ? details[u] : {};
    return { uid: u, email: typeof m.email === 'string' ? m.email.slice(0, 200) : '', at: typeof m.at === 'number' ? m.at : 0 };
  });
  // The owner first, then the others in the order they joined.
  members.sort((a, b) => (b.uid === d.owner) - (a.uid === d.owner) || a.at - b.at);
  return { id, owner: d.owner, trip: d.trip, code: typeof d.code === 'string' && /^[a-z2-9]{12,40}$/.test(d.code) ? d.code : '', members };
}

// The people on a trip, when it is shared and this device is signed in. Otherwise null.
const shareOf = trip => (trip && trip.shared && sync.saved && sharing.roots[trip.shared]) || null;
const ownsShare = root => !!root && root.owner === sharing.uid;

/* ---------- Following the shared trips of the account ---------- */

function startSharing(user) {
  sharing.uid = user.uid;
  // The trips this device already knows start right away; the account's list confirms them next.
  for (const id of Object.keys(sync.saved.shared)) attachShare(id);
  sharing.stop = sync.db.collection('shared').where('uids', 'array-contains', user.uid).onSnapshot(onRoots, (err) => {
    console.warn('Shared trips', err);
    sharing.off = !!err && err.code === 'permission-denied';
    if (sharing.invite && sharing.off) {
      sharing.invite = null;
      snackbar(SHARE_OFF);
    }
    refreshShare();
  });
}

function stopSharing() {
  if (sharing.stop) sharing.stop();
  for (const id of Object.keys(sync.shared)) detachShare(id);
  Object.assign(sharing, { uid: null, roots: {}, ready: false, off: false, stop: null, show: null });
  sharing.listed.clear();
  sharing.holding.clear();
  sharing.quiet.clear();
}

// The account's list of shared trips has arrived, or has changed.
function onRoots(snap) {
  if (snap.metadata.fromCache || !sync.saved) return;
  const roots = {};
  snap.forEach((d) => {
    const root = tidyRoot(d.id, d.data());
    if (root) roots[root.id] = root;
  });
  sharing.roots = roots;
  sharing.ready = true;
  sharing.off = false;

  for (const id of Object.keys(roots)) {
    sharing.listed.add(id);
    if (sync.saved.shared[id]) sync.saved.shared[id].seen = true;
    if (sharing.holding.has(id)) continue;
    if (sync.shared[id] && sync.shared[id].dead) detachShare(id);
    attachShare(id);
  }
  // Trips the account is no longer on: left on another device, taken off by the owner, or deleted.
  // So are trips marked as shared that this account was never on (another account used this device).
  const known = new Set([...Object.keys(sync.saved.shared), ...state.trips.map(t => t.shared).filter(Boolean)]);
  for (const id of known) {
    if (roots[id] || sharing.holding.has(id)) continue;
    const rec = sync.saved.shared[id];
    // Started or joined here a moment ago, and never named by the list: it may not have caught up yet.
    if (rec && !rec.seen && Date.now() - (rec.at || 0) < 60000) continue;
    const trip = dropShare(id);
    if (trip && rec && !sharing.quiet.has(id)) snackbar(`“${trip.name}” is no longer shared with you`);
  }
  writeSyncInfo();
  refreshShare();
  resumeInvite();
}

// Starts following one shared trip's documents.
function attachShare(id) {
  if (sync.shared[id]) return;
  if (!sync.saved.shared[id]) {
    const root = sharing.roots[id];
    if (!root) return;
    // New on this device: what the trip holds comes from the account, never from here (fresh).
    // seen: the account's list has named it. Until then, its absence from the list means nothing.
    sync.saved.shared[id] = { trip: root.trip, base: {}, fresh: true, seen: sharing.listed.has(id), at: Date.now() };
    writeSyncInfo();
  }
  const sp = sync.shared[id] = newSpace();
  sp.col = sync.db.collection('shared').doc(id).collection('docs');
  sp.stop = sp.col.onSnapshot(snap => onSharedSnapshot(snap, id), (err) => {
    // Taken off the trip (the account's list says so next), or the rules are out of date.
    console.warn('Shared trip stopped', err);
    sp.dead = true;
  });
}

function detachShare(id) {
  const sp = sync.shared[id];
  if (!sp) return;
  if (sp.stop) sp.stop();
  delete sync.shared[id];
}

// The trip goes away from this device (its documents in the database are not touched).
function dropShare(id) {
  detachShare(id);
  delete sharing.roots[id];
  if (sync.saved && sync.saved.shared[id]) {
    delete sync.saved.shared[id];
    writeSyncInfo();
  }
  const trip = state.trips.find(t => t.shared === id);
  if (trip) {
    state.trips = state.trips.filter(t => t !== trip);
    if (state.activeTripId === trip.id) {
      state.activeTripId = state.trips.length ? state.trips[0].id : null;
      scrollAt = {};
    }
    saveLocal();
    renderSoon();
  }
  // A change the trip refused, because we were already off it, is no longer an error.
  if (sync.status === 'error' && sync.own.known && !sendingNow()) setSyncStatus('synced');
  return trip;
}

function onSharedSnapshot(snap, id) {
  const got = readSnapshot(snap);
  const rec = sync.saved && sync.saved.shared[id];
  if (!got || !rec || !sync.shared[id]) return;
  // New on this device, or the trip isn't here: take what the database has. Otherwise the usual merge,
  // which keeps what was changed here and not sent yet.
  const fresh = rec.fresh || !Object.keys(stateDocs(state, id)).length;
  delete rec.fresh;
  mergeRemote(got.remote, got.pending, fresh ? new Set() : undefined, id);

  const trip = state.trips.find(t => t.shared === id);
  if (trip && sharing.show === id) {
    sharing.show = null;
    state.activeTripId = trip.id;
    saveLocal();
    scrollAt = {};
    showView('plan', { top: true });
    snackbar(`You’re on ${trip.name} now`);
  }
  // Ours, a day old and with nothing in it: what an "Invite" or a "Delete" that was cut short left behind.
  const root = sharing.roots[id];
  const mine = root && root.members.find(m => m.uid === sharing.uid);
  if (ownsShare(root) && mine && !Object.keys(got.remote).length && !got.pending.size && Date.now() - mine.at > 864e5) {
    sync.db.collection('shared').doc(id).delete().catch(() => {});
  }
}

/* ---------- Changing who is on a trip (all of these need a connection) ---------- */

// The address as the database knows it: the rules compare the two.
async function tokenEmail(user) {
  const token = await user.getIdTokenResult();
  return (token.claims && token.claims.email) || user.email;
}

// Sends documents to a shared trip, a few at a time, the trip's own document last: until it is
// there, the others' devices show nothing of the trip, so nobody sees half of it.
async function writeDocs(col, docs) {
  const keys = Object.keys(docs).sort((a, b) => a.startsWith('trip_') - b.startsWith('trip_'));
  const batches = [];
  for (let i = 0; i < keys.length; i += SHARED_BATCH) {
    const batch = sync.db.batch();
    for (const k of keys.slice(i, i + SHARED_BATCH)) batch.set(col.doc(k), JSON.parse(docs[k]));
    batches.push(batch);
  }
  const last = batches.pop();
  await Promise.all(batches.map(b => b.commit()));
  if (last) await last.commit();
}

// Makes a trip of this account a shared one, with only its owner on it so far.
async function startShare(trip) {
  const user = await signedInUser();
  const email = await tokenEmail(user);
  const id = randomCode(20);
  const code = randomCode(12);
  const ref = sync.db.collection('shared').doc(id);
  const root = { owner: user.uid, trip: trip.id, code, uids: [user.uid], members: { [user.uid]: { email, at: Date.now(), via: code } } };
  let docs;
  sharing.holding.add(id);
  try {
    await ref.set(root);
    docs = stateDocs({ trips: [{ ...trip, shared: id }], checklist: [] }, id);
    await writeDocs(ref.collection('docs'), docs);
    // Deleted here while it was being sent, or signed out: take it back.
    if (!state.trips.includes(trip) || trip.shared || !sync.saved || sync.saved.uid !== user.uid) throw new Error('The trip changed meanwhile. Try again.');
  } catch (err) {
    deleteSharedRemote({ id, members: [] }, user.uid).catch(() => {});
    throw err;
  } finally {
    sharing.holding.delete(id);
  }
  // From here on the trip is kept in its own place: its documents leave the account at this save.
  sync.saved.shared[id] = { trip: trip.id, base: { ...docs }, seen: sharing.listed.has(id), at: Date.now() };
  trip.shared = id;
  sharing.roots[id] = tidyRoot(id, root);
  attachShare(id);
  save();
  render();
}

// Joins the trip of an invitation. Returns who is on it, or null when the user changed their mind.
async function joinShare({ id, code }) {
  const F = firebase.firestore;
  const user = await signedInUser();
  const email = await tokenEmail(user);
  const ref = sync.db.collection('shared').doc(id);
  sharing.holding.add(id);
  try {
    await ref.update('uids', F.FieldValue.arrayUnion(user.uid), new F.FieldPath('members', user.uid), { email, at: Date.now(), via: code });
    const snap = await ref.get({ source: 'server' });
    const root = tidyRoot(id, snap.data());
    if (!root) throw { code: 'not-found' };
    // This device has a trip of its own with the same id: a copy from before the trip was shared.
    const copy = state.trips.find(t => t.id === root.trip && !t.shared);
    if (copy) {
      const ok = await askConfirm({
        icon: 'group',
        title: `You already have ${copy.name}`,
        text: 'This device has its own copy of this trip. Joining replaces it with the shared one: what you changed only in your copy is lost.',
        ok: 'Join',
      });
      if (!ok) {
        await leaveRemote(id, user.uid);
        return null;
      }
    }
    sharing.roots[id] = root;
    return root;
  } finally {
    sharing.holding.delete(id);
  }
}

function leaveRemote(id, uid) {
  const F = firebase.firestore;
  return sync.db.collection('shared').doc(id).update('uids', F.FieldValue.arrayRemove(uid), new F.FieldPath('members', uid), F.FieldValue.delete());
}

// The owner takes someone off. The code changes, or the old link would let them straight back in.
function removeRemote(id, uid) {
  const F = firebase.firestore;
  return sync.db.collection('shared').doc(id).update(
    'uids', F.FieldValue.arrayRemove(uid), new F.FieldPath('members', uid), F.FieldValue.delete(), 'code', randomCode(12));
}

// The owner deletes the trip for everyone. root: who is on it ({ id, members }).
async function deleteSharedRemote(root, uid) {
  const F = firebase.firestore;
  const ref = sync.db.collection('shared').doc(root.id);
  // Everyone else comes off first: from then on their devices can't send it anything.
  const others = root.members.map(m => m.uid).filter(u => u !== uid);
  if (others.length) {
    const changes = ['uids', F.FieldValue.arrayRemove(...others), 'code', randomCode(12)];
    for (const u of others) changes.push(new F.FieldPath('members', u), F.FieldValue.delete());
    await ref.update(...changes);
  }
  const snap = await ref.collection('docs').get({ source: 'server' });
  const batches = [];
  for (let i = 0; i < snap.docs.length; i += SHARED_BATCH) {
    const batch = sync.db.batch();
    snap.docs.slice(i, i + SHARED_BATCH).forEach(d => batch.delete(d.ref));
    batches.push(batch.commit());
  }
  await Promise.all(batches);
  await ref.delete();
}

// Before "Erase everything" or deleting the account: the account's own shared trips are deleted for
// everyone, and it leaves the others. keepCopies: this device keeps them all, as trips of its own.
async function quitSharing(uid, keepCopies = false) {
  let roots = [];
  try {
    const snap = await sync.db.collection('shared').where('uids', 'array-contains', uid).get({ source: 'server' });
    snap.forEach((d) => {
      const root = tidyRoot(d.id, d.data());
      if (root) roots.push(root);
    });
  } catch (err) {
    if (!err || err.code !== 'permission-denied') throw err;
    roots = [];       // sharing was never switched on: there is nothing to leave
  }
  for (const root of roots) {
    sharing.quiet.add(root.id);
    detachShare(root.id);
    if (root.owner === uid) await deleteSharedRemote(root, uid);
    else await leaveRemote(root.id, uid);
    if (!keepCopies) dropShare(root.id);
  }
  if (keepCopies) {
    for (const t of state.trips) delete t.shared;
    if (sync.saved) sync.saved.shared = {};
    saveLocal();
  }
}

/* ---------- Invitations ---------- */

// The app was opened from an invitation link ("…#join=…"). The address is cleaned at once, so that
// a reload or the Back button doesn't ask again.
function checkInviteLink() {
  if (!/^#join=/.test(location.hash)) return;
  const invite = readInvite(location.hash);
  try { history.replaceState(history.state, '', location.pathname + location.search); } catch { /* the address keeps it */ }
  if (invite) offerInvite(invite);
  else snackbar('That invitation link isn’t complete. Ask for it again.');
}
window.addEventListener('hashchange', checkInviteLink);

async function offerInvite(invite) {
  if (!sync.configured) return snackbar('This copy of the app has no accounts, so trips can’t be shared.');
  sharing.invite = invite;
  if (!sync.saved) {
    const ok = await askConfirm({
      icon: 'group',
      title: 'You’re invited to a trip',
      text: 'Sign in to join it. No account yet? Creating one is free and takes a minute.',
      ok: 'Sign in',
    });
    if (ok) openAuthForm();
    else sharing.invite = null;
    return;
  }
  if (!navigator.onLine) {
    sharing.invite = null;
    return snackbar('You’re offline. Open the invitation again when you’re online.');
  }
  retrySharing();     // if the database still says no, that answer clears the invitation (startSharing)
  resumeInvite();
}

// Goes on with a waiting invitation once the account is ready for it (and no other question is open).
function resumeInvite() {
  const invite = sharing.invite;
  if (!invite || !sync.saved || !sync.saved.linked || sync.asking || !sharing.ready || sharing.busy) return;
  sharing.invite = null;
  acceptInvite(invite);
}

async function acceptInvite(invite) {
  if (sharing.roots[invite.id]) {
    const trip = state.trips.find(t => t.shared === invite.id);
    if (trip) {
      state.activeTripId = trip.id;
      saveLocal();
      scrollAt = {};
      showView('plan', { top: true });
    }
    return snackbar('You’re already on this trip');
  }
  sharing.busy = true;
  try {
    const ok = await askConfirm({
      icon: 'group',
      title: 'Join this trip?',
      text: 'You’ll plan it together: everyone on the trip can change its plans, and sees the email address of the others.',
      ok: 'Join',
    });
    if (!ok) return;
    const root = await joinShare(invite);
    if (!root) return;
    sharing.show = root.id;
    attachShare(root.id);
    snackbar('Joined — getting the trip…');
  } catch (err) {
    console.warn('Joining', err);
    const code = (err && err.code) || '';
    // A wrong or replaced code, a deleted trip, a full one: the database only says no.
    snackbar(code === 'permission-denied' || code === 'not-found' ? 'This invitation doesn’t work any more. Ask for a new link.' : syncErrorText(err));
  } finally {
    sharing.busy = false;
    refreshShare();
  }
}

/* ---------- The Share sheet ---------- */

// The trip card's button: the number of people, once someone else is on the trip.
function shareButtonHTML(trip) {
  const root = shareOf(trip);
  const n = root ? root.members.length : 0;
  return `<button type="button" class="hero-btn ripple" data-action="share-trip">${n > 1 ? `${icon('group')}${n} people` : `${icon('share')}Share`}</button>`;
}
// A small sign next to the name of a shared trip.
const sharedMark = trip => (trip.shared && sync.saved ? icon('group', 'sm') : '');

// What the trip form's red button does to a shared trip.
function tripEndLabel(trip) {
  const root = shareOf(trip);
  return root && !ownsShare(root) ? 'Leave trip' : 'Delete trip';
}

// The database said no to shared trips. Its rules may have been published since: ask again.
function retrySharing() {
  const user = sync.auth && sync.auth.currentUser;
  if (!sharing.off || !user || !navigator.onLine) return;
  stopSharing();
  startSharing(user);
}

function openShare() {
  if (!activeTrip()) return;
  retrySharing();
  $('#share-dialog').showModal();
  renderShare();
  $('#share-body').scrollTop = 0;
}

// Redraws what shows who is on a trip: the sheet when it is open, and the trip card behind it.
function refreshShare() {
  renderShare();
  renderSoon();
}

function renderShare() {
  if (!$('#share-dialog').open) return;
  const trip = activeTrip();
  if (!trip) return $('#share-dialog').close();
  $('#share-title').textContent = `Share ${trip.name}`;
  const root = shareOf(trip);
  const note = (ic, text, more = '', bad = false) => `<p class="vote-note ${bad ? 'bad' : ''}">${icon(ic)}<span>${text}</span>${more}</p>`;
  const intro = '<p>Invite people to this trip. They see it and change it from their own account: its days, plans and ideas, and a list for everyone in the Checklist.</p>';
  const notFiles = '<p class="share-hint">Tickets and other files you attach to a plan can’t be shared in the app: they stay on your device. Your own checklist stays yours too.</p>';

  let together;
  if (!sync.configured) {
    together = '';
  } else if (!sync.saved) {
    together = intro + note('login', 'Sign in first. Everyone joins with an account of their own.',
      '<button type="button" class="btn tonal ripple" data-action="share-sign-in">Sign in</button>');
  } else if (sharing.off) {
    together = intro + note('error', SHARE_OFF, '', true);
  } else if (!navigator.onLine) {
    together = note('cloud_off', trip.shared ? 'You’re offline. Your changes reach the others when you’re back online.' : 'You’re offline. Connect to invite people.');
  } else if (!root) {
    together = trip.shared || !sharing.ready
      ? note('sync', 'Asking your account who is on this trip…')
      : `${intro}${notFiles}<button type="button" class="btn filled ripple" data-action="share-start" ${sharing.busy ? 'disabled' : ''}>
          ${icon('person_add')}${sharing.busy ? 'Getting the link…' : 'Invite people'}</button>`;
  } else {
    const mine = ownsShare(root);
    const link = root.code ? inviteLink(root) : '';
    together = `
      <ul class="share-people">${root.members.map((m) => {
        const me = m.uid === sharing.uid;
        const role = m.uid === root.owner ? 'Started the trip' : m.at ? `Joined ${fmtDay(toISO(new Date(m.at)), { day: 'numeric', month: 'short' })}` : 'On the trip';
        return `<li>
          <span class="row-icon">${icon('person')}</span>
          <span class="row-text"><span class="row-title">${esc(m.email || 'Someone')}</span>
            <span class="row-sub">${me ? 'You · ' : ''}${esc(role)}</span></span>
          ${mine && !me ? `<button type="button" class="btn text danger ripple" data-action="share-remove" data-uid="${esc(m.uid)}">Remove</button>` : ''}
        </li>`;
      }).join('')}</ul>
      ${root.members.length >= SHARE_MAX ? `<p>A trip takes ${SHARE_MAX} people at most.</p>` : link ? `
        <p class="share-url">${esc(link)}</p>
        <div class="share-actions">
          ${navigator.share ? `<button type="button" class="btn filled ripple" data-action="share-send">${icon('send')}Send the link</button>` : ''}
          <button type="button" class="btn ${navigator.share ? 'tonal' : 'filled'} ripple" data-action="share-copy">${icon('content_copy')}Copy</button>
        </div>
        <p class="share-hint">Whoever opens this link and signs in joins the trip and can change it. They show up here${mine ? ', and you can take them off again' : ''}.</p>` : ''}
      ${notFiles}
      ${mine ? '' : `<button type="button" class="btn text danger ripple share-leave" data-action="share-leave">${icon('logout')}Leave this trip</button>`}`;
  }

  $('#share-body').innerHTML = `
    ${together ? `<section class="tip share-together">
      <h3>${icon('group')}${root && root.members.length > 1 ? 'On this trip' : 'Plan it together'}</h3>
      ${together}
    </section>` : ''}
    <section class="tip">
      <h3>${icon('send')}Just show the plan</h3>
      <p>Send the days and their plans as text, to read in any app. Nobody can change anything.</p>
      <button type="button" class="btn tonal ripple" data-action="share-text">${icon('share')}Send as text</button>
    </section>`;
}

// "Invite people": the trip becomes a shared one, and its link shows.
async function inviteToTrip() {
  const trip = activeTrip();
  if (!trip || trip.shared || sharing.busy) return;
  sharing.busy = true;
  renderShare();
  try {
    await startShare(trip);
  } catch (err) {
    console.warn('Sharing', err);
    if (err && err.code === 'permission-denied') sharing.off = true;
    snackbar(sharing.off ? SHARE_OFF : syncErrorText(err));
  } finally {
    sharing.busy = false;
    renderShare();
  }
}

// Hands the link to the device's Share menu, or copies it (copy: always).
async function sendInvite(copy) {
  const trip = activeTrip();
  const root = shareOf(trip);
  if (!root || !root.code) return;
  const url = inviteLink(root);
  try {
    if (!copy && navigator.share) {
      await navigator.share({ title: `Plan ${trip.name} with me`, text: `Join my trip to ${trip.name} in Dotted Line:`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    snackbar('Link copied — send it to the people you want on the trip');
  } catch (err) {
    if (!err || err.name !== 'AbortError') snackbar('Couldn’t copy it from here. Hold the link to select it.');
  }
}

async function removeFromTrip(uid) {
  const trip = activeTrip();
  const root = shareOf(trip);
  const who = root && root.members.find(m => m.uid === uid);
  if (!who || !ownsShare(root) || uid === root.owner) return;
  const ok = await askConfirm({
    icon: 'delete',
    title: `Take ${who.email || 'this person'} off the trip?`,
    text: `${trip.name} goes away from their devices. The invitation link changes too: the old one stops working.`,
    ok: 'Remove',
  });
  if (!ok) return;
  if (!navigator.onLine) return snackbar('No connection. Try again when you’re online.');
  removeRemote(root.id, uid).catch(err => snackbar(syncErrorText(err)));
}

// Leaving a shared trip, or (its owner) deleting it for everyone. Returns true once it is gone from here.
async function endSharedTrip(trip) {
  const root = shareOf(trip);
  if (!root || !navigator.onLine) {
    snackbar('This trip is shared: connect to the internet to leave or delete it.');
    return false;
  }
  const mine = ownsShare(root);
  const others = root.members.length - 1;
  const ok = await askConfirm(mine ? {
    icon: 'delete',
    title: others ? `Delete ${trip.name} for everyone?` : `Delete ${trip.name}?`,
    text: `This removes the trip and its ${plural(trip.items.length, 'plan')}` +
      (others ? `, also for the ${others === 1 ? 'other person' : `${others} other people`} on it.` : ' from your devices.'),
    ok: 'Delete',
  } : {
    icon: 'logout',
    title: `Leave ${trip.name}?`,
    text: 'It goes away from your devices. The others keep it, and can invite you again.',
    ok: 'Leave',
  });
  if (!ok) return false;
  const id = root.id;
  sharing.quiet.add(id);
  detachShare(id);
  try {
    if (mine) await deleteSharedRemote(root, sharing.uid);
    else await leaveRemote(id, sharing.uid);
  } catch (err) {
    console.warn('Shared trip', err);
    sharing.quiet.delete(id);
    if (sync.saved && sync.saved.shared[id]) attachShare(id);
    snackbar(syncErrorText(err));
    return false;
  }
  dropShare(id);
  render();
  snackbar(mine ? `${trip.name} deleted` : `You left ${trip.name}`);
  return true;
}

/* ---------- Joining with a link pasted by hand ---------- */

function openJoin() {
  $('#join-form').reset();
  joinError('');
  $('#join-dialog').showModal();
  $('#join-form').elements.link.focus();
}

function joinError(text) {
  $('#join-error').textContent = text;
  $('#join-error').hidden = !text;
}

// This uses nothing from app.js before it is tapped, so it can be set up as the file loads.
document.getElementById('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const invite = readInvite(e.currentTarget.elements.link.value);
  if (!invite) return joinError('That isn’t an invitation link. Paste the whole link you were sent.');
  document.getElementById('join-dialog').close();
  offerInvite(invite);
});
