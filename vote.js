'use strict';

/* =========================================================
   Voting for what comes next (Settings → About).
   A list of features that could be built. Everyone who is signed in votes for as many as they
   like, and can send suggestions of their own (five at most, which they can remove).

   Kept in the Firebase project, outside the accounts' own plans, so that all accounts see it:
     featureVotes/{uid}      { ids: [the keys that person voted for] }
     featureIdeas/{uid}_{n}  { title, text, uid, at }   n = 0…4: that is what limits it to five
   firestore.rules lets each account write only its own. Names and emails are never stored here.
   Functions here use helpers from app.js and sync.js, which are loaded after this file.
   ========================================================= */

// The app's own proposals. Keep an id for good once it has shipped: votes are kept by id.
const FEATURE_IDEAS = [
  { id: 'share-trip', title: 'Plan a trip together', text: 'Invite someone to a trip. They see it and change it from their own account.' },
  { id: 'offline-maps', title: 'Maps without a connection', text: 'Download a trip’s map before leaving, for when there is no signal.' },
  { id: 'meals', title: 'Lunch and dinner ideas', text: 'Places to eat near each day’s plans, from the travel guide.' },
  { id: 'budget', title: 'Trip budget', text: 'Note what each plan costs, and see the total for a day and for the whole trip.' },
  { id: 'journal', title: 'Trip journal', text: 'Add a photo and a few words to a plan once it’s done, and look back on the trip.' },
  { id: 'print', title: 'Print the plan', text: 'A clean page of the whole trip, to print or keep as a PDF.' },
  { id: 'copy-trip', title: 'Copy a trip', text: 'Start a new trip from one you already made.' },
  { id: 'idea-hearts', title: 'Hearts on ideas', text: 'Everyone on a trip marks the ideas they like, so the group sees what to do first.' },
  { id: 'packing-lists', title: 'Packing lists to keep', text: 'Save your checklist and use it again for the next trip.' },
  { id: 'languages', title: 'The app in other languages', text: 'Today everything is in English.' },
  { id: 'change-email', title: 'Change your email', text: 'Move your account to another email address.' },
];
const VOTE_MAX_IDEAS = 5;

const voting = {
  uid: null,
  votes: {},          // account → the keys it voted for
  ideas: [],          // suggestions sent by people
  got: new Set(),     // which of the two lists have arrived
  status: 'idle',     // idle | loading | ready | error
  error: '',
  order: [],          // the order on screen: set when the sheet opens, so rows don't jump while voting
  stop: [],           // switches the listeners off
};

// A suggestion as stored in the account: other people wrote it, so it is checked first.
function tidyIdea(doc, d) {
  if (!d || typeof d.title !== 'string' || !d.title.trim() || typeof d.uid !== 'string' || !/^[\w-]{1,128}_[0-4]$/.test(doc)) return null;
  const at = typeof d.at === 'number' ? d.at : 0;
  // A new suggestion in the same slot must not inherit the old one's votes: the time is part of the key.
  return {
    key: `${doc}.${at}`, doc, uid: d.uid, at,
    title: d.title.trim().slice(0, 80),
    text: typeof d.text === 'string' ? d.text.trim().slice(0, 300) : '',
  };
}

// The app's proposals, then people's suggestions, oldest first.
function votingFeatures() {
  return [
    ...FEATURE_IDEAS.map(f => ({ key: f.id, title: f.title, text: f.text })),
    ...voting.ideas.slice().sort((a, b) => a.at - b.at),
  ];
}

// Each feature with its number of votes, most wanted first. A vote for something that is gone doesn't count.
function tallyVotes(features, votes, me) {
  const count = new Map(features.map(f => [f.key, 0]));
  for (const keys of Object.values(votes)) {
    for (const k of new Set(keys)) if (count.has(k)) count.set(k, count.get(k) + 1);
  }
  const mine = new Set(votes[me] || []);
  return features
    .map((f, pos) => ({ ...f, votes: count.get(f.key), voted: mine.has(f.key), pos }))
    .sort((a, b) => b.votes - a.votes || a.pos - b.pos);
}

/* ---------- Listening to the votes while the sheet is open ---------- */

function stopVoting() {
  voting.stop.forEach(off => off());
  voting.stop = [];
}

async function startVoting() {
  stopVoting();
  Object.assign(voting, { uid: null, votes: {}, ideas: [], got: new Set(), order: [], error: '', status: sync.saved ? 'loading' : 'idle' });
  renderVoting();
  if (!sync.saved) return;
  const fail = (err) => {
    console.warn('Voting', err);
    stopVoting();
    voting.status = 'error';
    // The database rules for voting aren't published yet (see README).
    voting.error = err && err.code === 'permission-denied' ? 'Voting isn’t switched on for this copy of the app yet.' : syncErrorText(err);
    renderVoting();
  };
  try {
    const user = await signedInUser();
    if (!$('#vote-dialog').open) return;
    voting.uid = user.uid;
    const arrived = (what) => {
      voting.got.add(what);
      if (voting.got.size === 2) voting.status = 'ready';
      renderVoting();
    };
    voting.stop = [
      sync.db.collection('featureVotes').limit(500).onSnapshot((snap) => {
        voting.votes = {};
        snap.forEach((d) => {
          const ids = d.data().ids;
          if (Array.isArray(ids)) voting.votes[d.id] = ids.filter(k => typeof k === 'string').slice(0, 300);
        });
        arrived('votes');
      }, fail),
      sync.db.collection('featureIdeas').limit(500).onSnapshot((snap) => {
        voting.ideas = [];
        snap.forEach((d) => {
          const idea = tidyIdea(d.id, d.data());
          if (idea) voting.ideas.push(idea);
        });
        arrived('ideas');
      }, fail),
    ];
  } catch (err) {
    fail(err);
  }
}

/* ---------- Voting, suggesting, removing ---------- */

function saveMyVotes(keys) {
  // The newest 300 are kept: the database refuses a longer list.
  return sync.db.collection('featureVotes').doc(voting.uid).set({ ids: [...keys].slice(-300) });
}

function toggleVote(key) {
  if (voting.status !== 'ready') return;
  const mine = new Set(voting.votes[voting.uid] || []);
  if (mine.has(key)) mine.delete(key); else mine.add(key);
  // The sheet shows the change at once; the account confirms it later (or when back online).
  saveMyVotes(mine).catch(err => snackbar(syncErrorText(err)));
}

function voteError(text) {
  $('#vote-error').textContent = text;
  $('#vote-error').hidden = !text;
}

async function suggestFeature(form) {
  const title = form.elements.title.value.trim().slice(0, 80);
  const text = form.elements.text.value.trim().slice(0, 300);
  if (voting.status !== 'ready') return;
  if (!title) return voteError('Say in a few words what you’d like.');
  const mine = voting.ideas.filter(i => i.uid === voting.uid);
  if (mine.length >= VOTE_MAX_IDEAS) return voteError(`You have ${VOTE_MAX_IDEAS} suggestions in the list. Remove one to send another.`);
  if (votingFeatures().some(f => norm(f.title) === norm(title))) return voteError('That one is in the list already. Vote for it!');
  // Offline, the account's answer would never come, and the form would stay waiting.
  if (!navigator.onLine) return voteError('No connection. Try again when you’re online.');
  voteError('');
  const taken = new Set(mine.map(i => i.doc));
  const doc = [0, 1, 2, 3, 4].map(n => `${voting.uid}_${n}`).find(d => !taken.has(d));
  const at = Date.now();
  const send = form.querySelector('[type=submit]');
  send.disabled = true;
  try {
    // Sent together: the suggestion, and its author's own vote for it.
    const batch = sync.db.batch();
    batch.set(sync.db.collection('featureIdeas').doc(doc), { title, text, uid: voting.uid, at });
    batch.set(sync.db.collection('featureVotes').doc(voting.uid), { ids: [...(voting.votes[voting.uid] || []), `${doc}.${at}`].slice(-300) });
    await batch.commit();
    form.reset();
    snackbar('Suggestion sent');
  } catch (err) {
    voteError(syncErrorText(err));
  } finally {
    send.disabled = false;
  }
}

async function removeIdea(doc) {
  const idea = voting.ideas.find(i => i.doc === doc && i.uid === voting.uid);
  if (!idea) return;
  const ok = await askConfirm({ icon: 'delete', title: 'Remove your suggestion?', text: `“${idea.title}” and its votes will be gone for everyone.`, ok: 'Remove' });
  if (!ok) return;
  sync.db.collection('featureIdeas').doc(doc).delete().catch(err => snackbar(syncErrorText(err)));
}

// Deleting the account (sync.js) also takes its votes and suggestions away.
async function eraseVoting(uid) {
  const batch = sync.db.batch();
  batch.delete(sync.db.collection('featureVotes').doc(uid));
  const mine = await sync.db.collection('featureIdeas').where('uid', '==', uid).get();
  mine.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

/* ---------- The sheet ---------- */

function renderVoting() {
  const ready = voting.status === 'ready';
  const list = tallyVotes(votingFeatures(), voting.votes, voting.uid);
  // The order is set once the votes are in (most wanted first); what arrives later goes at the end.
  if (ready && !voting.order.length) voting.order = list.map(f => f.key);
  const place = k => { const i = voting.order.indexOf(k); return i < 0 ? Infinity : i; };
  if (voting.order.length) list.sort((a, b) => place(a.key) - place(b.key) || a.pos - b.pos);

  const note = !sync.saved
    ? `<p class="vote-note">${icon('login')}<span>Sign in to vote, and to suggest features of your own.</span>
        <button type="button" class="btn tonal ripple" data-action="vote-sign-in">Sign in</button></p>`
    : voting.status === 'loading' ? `<p class="vote-note">${icon('sync')}<span>Getting the votes…</span></p>`
    : voting.status === 'error' ? `<p class="vote-note bad">${icon('error')}<span>${esc(voting.error)}</span></p>`
    : !navigator.onLine ? `<p class="vote-note">${icon('cloud_off')}<span>Offline — your votes are sent when you’re back online.</span></p>`
    : '';

  $('#vote-note').innerHTML = note;
  $('#vote-list').innerHTML = list.map((f) => {
    const mine = f.uid && f.uid === voting.uid;
    return `
      <li class="vote-item">
        <button type="button" class="vote-btn ripple" data-action="vote" data-key="${esc(f.key)}" aria-pressed="${f.voted}"
          aria-label="${f.voted ? 'Take back your vote for' : 'Vote for'} ${esc(f.title)}${ready ? `, ${plural(f.votes, 'vote')}` : ''}" ${ready ? '' : 'disabled'}>
          ${icon('arrow_forward')}<span>${ready ? f.votes : '–'}</span>
        </button>
        <div class="vote-text">
          <span class="vote-title">${esc(f.title)}</span>
          ${f.text ? `<span class="vote-sub">${esc(f.text)}</span>` : ''}
          ${f.uid ? `<span class="vote-tag">${mine ? 'Your suggestion' : 'Suggested by someone using the app'}
            ${mine ? `<button type="button" class="btn text ripple" data-action="vote-remove" data-doc="${esc(f.doc)}">Remove</button>` : ''}</span>` : ''}
        </div>
      </li>`;
  }).join('');
  $('#vote-form').hidden = !ready;
}

function openVoting() {
  voteError('');
  $('#vote-form').reset();
  $('#vote-dialog').showModal();
  $('#vote-body').scrollTop = 0;
  startVoting();
}

// These use nothing from app.js, so they can be set up as the file loads.
document.getElementById('vote-dialog').addEventListener('close', stopVoting);
document.getElementById('vote-form').addEventListener('submit', (e) => {
  e.preventDefault();
  suggestFeature(e.currentTarget);
});
