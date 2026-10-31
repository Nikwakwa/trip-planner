'use strict';

/* =========================================================
   Voting for what comes next (Settings → About).
   A list of features that could be built. Everyone who is signed in votes for as many as they
   like, and can send suggestions of their own (five at most, which they can remove).

   Kept in the Firebase project, outside the accounts' own plans, so that all accounts see it:
     featureVotes/{uid}      { ids: [the keys that person voted for] }
     featureIdeas/{uid}_{n}  { title, text, uid, at }   n = 0…4: that is what limits it to five
   firestore.rules lets each account write only its own. Names and emails are never stored here.
   Functions here also use sync.js and the screen's files (ui.js … app.js), which load after this one.
   ========================================================= */

// The app's own proposals. Keep an id for good once it has shipped: votes are kept by id.
// Built since, so off the list (don't use these ids again): share-trip, languages (French, 2026-10).
const FEATURE_IDEAS = [
  { id: 'offline-maps', title: T('Maps without a connection'), text: T('Download a trip’s map before leaving, for when there is no signal.') },
  { id: 'meals', title: T('Lunch and dinner ideas'), text: T('Places to eat near each day’s plans, from the travel guide.') },
  { id: 'budget', title: T('Trip budget'), text: T('Note what each plan costs, and see the total for a day and for the whole trip.') },
  { id: 'journal', title: T('Trip journal'), text: T('Add a photo and a few words to a plan once it’s done, and look back on the trip.') },
  { id: 'print', title: T('Print the plan'), text: T('A clean page of the whole trip, to print or keep as a PDF.') },
  { id: 'copy-trip', title: T('Copy a trip'), text: T('Start a new trip from one you already made.') },
  { id: 'packing-lists', title: T('Packing lists to keep'), text: T('Save your checklist and use it again for the next trip.') },
  { id: 'change-email', title: T('Change your email'), text: T('Move your account to another email address.') },
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
  suggesting: false,  // the form for a suggestion of your own is open
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

// Suggestions people sent for something the app now does: they leave the list. Only their author can delete
// them, so they're found by their title, in English or French. (A proposal of the app's own that ships is
// taken out of FEATURE_IDEAS.)
const BUILT_IDEAS = [
  /\barchiv/i,          // archiving trips (2.18.0)
  /\bhearts?\b|\bc(œ|oe)urs?\b/i,    // hearts on ideas (2.19.0)
  /\bnick ?names?\b|\bpseudo|\bsurnom/i,     // a name of your own on shared trips (2.20.0)
  // ideas on the map (2.21.0): any title with both words, whatever comes between ("Ideas on the trip map")
  /\bideas?\b.*\bmaps?\b|\bmaps?\b.*\bideas?\b|\bidées?\b.*\bcartes?\b|\bcartes?\b.*\bidées?\b/i,
];
const isBuilt = idea => BUILT_IDEAS.some(re => re.test(idea.title));

// The app's proposals, then people's suggestions, oldest first.
function votingFeatures() {
  return [
    ...FEATURE_IDEAS.map(f => ({ key: f.id, title: f.title, text: f.text })),
    ...voting.ideas.filter(i => !isBuilt(i)).sort((a, b) => a.at - b.at),
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
  Object.assign(voting, { uid: null, votes: {}, ideas: [], got: new Set(), order: [], suggesting: false, error: '', status: sync.saved ? 'loading' : 'idle' });
  renderVoting();
  if (!sync.saved) return;
  const fail = (err) => {
    console.warn('Voting', err);
    stopVoting();
    voting.status = 'error';
    // The database rules for voting aren't published yet (see README).
    voting.error = err && err.code === 'permission-denied' ? T('Voting isn’t switched on for this copy of the app yet.') : syncErrorText(err);
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

// Opens or closes the form for a suggestion of your own. While it is open, the sheet's "Done" is away:
// one button to finish at a time.
function suggesting(on) {
  voting.suggesting = on;
  voteError('');
  if (!on) $('#vote-form').reset();
  renderVoting();
  if (!on) return;
  $('#vote-form').elements.title.focus({ preventScroll: true });
  $('#vote-form').scrollIntoView({ block: 'nearest' });
}

async function suggestFeature(form) {
  const title = form.elements.title.value.trim().slice(0, 80);
  const text = form.elements.text.value.trim().slice(0, 300);
  if (voting.status !== 'ready') return;
  if (!title) {
    form.elements.title.focus();
    return voteError(T('Write your idea first. Your votes are saved already.'));
  }
  const mine = voting.ideas.filter(i => i.uid === voting.uid);
  // A suggestion of yours that is now built is out of the list: its place is freed for this one.
  const built = mine.filter(isBuilt).sort((a, b) => a.at - b.at);
  if (mine.length - built.length >= VOTE_MAX_IDEAS) return voteError(T('You have {n} suggestions in the list. Remove one to send another.', { n: VOTE_MAX_IDEAS }));
  if (isBuilt({ title })) return voteError(T('The app does that already: see “What’s new”.'));
  if (votingFeatures().some(f => norm(f.title) === norm(title))) return voteError(T('That one is in the list already. Vote for it!'));
  // Offline, the account's answer would never come, and the form would stay waiting.
  if (!navigator.onLine) return voteError(T('No connection. Try again when you’re online.'));
  voteError('');
  const taken = new Set(mine.map(i => i.doc));
  let doc = [0, 1, 2, 3, 4].map(n => `${voting.uid}_${n}`).find(d => !taken.has(d));
  const at = Date.now();
  const send = form.querySelector('[type=submit]');
  send.disabled = true;
  try {
    if (!doc) {
      doc = built[0].doc;
      await sync.db.collection('featureIdeas').doc(doc).delete();
    }
    // Sent together: the suggestion, and its author's own vote for it.
    const batch = sync.db.batch();
    batch.set(sync.db.collection('featureIdeas').doc(doc), { title, text, uid: voting.uid, at });
    batch.set(sync.db.collection('featureVotes').doc(voting.uid), { ids: [...(voting.votes[voting.uid] || []), `${doc}.${at}`].slice(-300) });
    await batch.commit();
    suggesting(false);
    snackbar(T('Suggestion sent'));
  } catch (err) {
    voteError(syncErrorText(err));
  } finally {
    send.disabled = false;
  }
}

async function removeIdea(doc) {
  const idea = voting.ideas.find(i => i.doc === doc && i.uid === voting.uid);
  if (!idea) return;
  const ok = await askConfirm({ icon: 'delete', title: T('Remove your suggestion?'), text: T('“{name}” and its votes will be gone for everyone.', { name: idea.title }), ok: T('Remove') });
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

// The line at the bottom of the sheet: a vote needs no "send", so it says the votes are in.
function voteStatus(count, online) {
  if (!count) return T('Tap an idea to vote for it');
  return online ? Tn(count, '{n} vote saved', '{n} votes saved') : Tn(count, '{n} vote kept for when you’re online', '{n} votes kept for when you’re online');
}

function renderVoting() {
  const ready = voting.status === 'ready';
  const list = tallyVotes(votingFeatures(), voting.votes, voting.uid);
  // The order is set once the votes are in (most wanted first); what arrives later goes at the end.
  if (ready && !voting.order.length) voting.order = list.map(f => f.key);
  const place = k => { const i = voting.order.indexOf(k); return i < 0 ? Infinity : i; };
  if (voting.order.length) list.sort((a, b) => place(a.key) - place(b.key) || a.pos - b.pos);

  const note = !sync.saved
    ? `<p class="vote-note">${icon('login')}<span>${T('Sign in to vote, and to suggest features of your own.')}</span>
        <button type="button" class="btn tonal ripple" data-action="vote-sign-in">${T('Sign in')}</button></p>`
    : voting.status === 'loading' ? `<p class="vote-note">${icon('sync')}<span>${T('Getting the votes…')}</span></p>`
    : voting.status === 'error' ? `<p class="vote-note bad">${icon('error')}<span>${esc(voting.error)}</span></p>`
    : !navigator.onLine ? `<p class="vote-note">${icon('cloud_off')}<span>${T('Offline — your votes are sent when you’re back online.')}</span></p>`
    : '';

  // The list is drawn again after each vote: the button that was in use keeps the keyboard's place.
  const held = document.activeElement && document.activeElement.closest('#vote-list .vote-btn');
  const heldKey = held && held.dataset.key;

  $('#vote-note').innerHTML = note;
  // The whole row votes, not only its button: people tap the words.
  $('#vote-list').innerHTML = list.map((f) => {
    const mine = f.uid && f.uid === voting.uid;
    return `
      <li class="vote-item${f.voted ? ' voted' : ''}" ${ready ? `data-action="vote" data-key="${esc(f.key)}"` : ''}>
        <button type="button" class="vote-btn ripple" data-action="vote" data-key="${esc(f.key)}" aria-pressed="${f.voted}"
          aria-label="${f.voted ? T('Take back your vote for {name}', { name: esc(f.title) }) : T('Vote for {name}', { name: esc(f.title) })}${ready ? `, ${Tn(f.votes, '{n} vote', '{n} votes')}` : ''}" ${ready ? '' : 'disabled'}>
          ${icon(f.voted ? 'check' : 'arrow_forward')}<span>${ready ? f.votes : '–'}</span>
        </button>
        <div class="vote-text">
          <span class="vote-title">${esc(f.title)}</span>
          ${f.text ? `<span class="vote-sub">${esc(f.text)}</span>` : ''}
          ${f.voted ? `<span class="vote-tag">${T('You voted for this')}</span>` : ''}
          ${f.uid ? `<span class="vote-tag">${mine ? T('Your suggestion') : T('Suggested by someone using the app')}
            ${mine ? `<button type="button" class="btn text ripple" data-action="vote-remove" data-doc="${esc(f.doc)}">${T('Remove')}</button>` : ''}</span>` : ''}
        </div>
      </li>`;
  }).join('');
  if (heldKey) {
    const again = [...document.querySelectorAll('#vote-list .vote-btn')].find(b => b.dataset.key === heldKey);
    if (again) again.focus({ preventScroll: true });
  }

  const count = list.filter(f => f.voted).length;
  $('#vote-suggest').hidden = !ready || voting.suggesting;
  $('#vote-form').hidden = !ready || !voting.suggesting;
  $('#vote-foot').hidden = !ready || voting.suggesting;
  $('#vote-status').classList.toggle('on', count > 0);
  $('#vote-status').innerHTML = `${count ? icon('check') : ''}<span>${esc(voteStatus(count, navigator.onLine))}</span>`;
}

function openVoting() {
  voteError('');
  $('#vote-form').reset();
  $('#vote-dialog').showModal();
  draftStart($('#vote-dialog'));
  $('#vote-body').scrollTop = 0;
  startVoting();
}

// These use nothing from the screen's files, so they can be set up as the file loads.
document.getElementById('vote-dialog').addEventListener('close', stopVoting);
document.getElementById('vote-form').addEventListener('submit', (e) => {
  e.preventDefault();
  suggestFeature(e.currentTarget);
});

/* ---------- Taps ---------- */

onAction('feature-votes', () => openVoting());
onAction('vote', el => toggleVote(el.dataset.key));
onAction('vote-remove', el => removeIdea(el.dataset.doc));
onAction('vote-suggest', () => suggesting(true));
onAction('vote-suggest-cancel', () => suggesting(false));
onAction('vote-sign-in', () => {
  $('#vote-dialog').close();
  openAuthForm();
});
