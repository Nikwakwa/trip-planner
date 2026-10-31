'use strict';

/* account.js — signing in or creating an account (for sync between devices), changing the password,
   deleting the account. The work with Firebase is in sync.js. */

const authDialog = $('#auth-dialog');
const authForm = $('#auth-form');

let authCreate = false;   // the sheet is creating an account, not signing in

function openAuthForm() {
  authForm.reset();
  setAuthMode(false);
  authDialog.showModal();
  authForm.elements.email.focus();
}

// The same sheet signs in or creates an account. What was typed stays when switching.
function setAuthMode(create) {
  authCreate = create;
  $('#auth-title').textContent = create ? T('Create account') : T('Sign in to sync');
  $('#auth-text').textContent = create
    ? T('Choose an email and a password. You’ll use them on each of your devices, to see your trips there too.')
    : T('Use the same email and password on each of your devices: they all show the same trips.');
  $('#auth-repeat-field').hidden = !create;
  authForm.elements.password.autocomplete = create ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = create ? T('Create account') : T('Sign in');
  $('#auth-switch').textContent = create ? T('I have an account') : T('Create account');
  $('#auth-forgot').hidden = create;
  authError('');
}

function authError(text) {
  $('#auth-error').textContent = text;
  $('#auth-error').hidden = !text;
}

async function runAuth() {
  const create = authCreate;
  const f = authForm.elements;
  const email = f.email.value.trim();
  const password = f.password.value;
  if (!email || !password) return authError(T('Enter the email and password.'));
  if (create && password.length < 6) return authError(T('Use at least 6 characters for the password.'));
  if (create && password !== f.repeat.value) return authError(T('The two passwords don’t match.'));
  authError('');
  authForm.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    await signIn(email, password, create);
    authDialog.close();
    snackbar(create ? T('Account created — we emailed you a link to confirm your address') : T('Signed in — connecting…'));
  } catch (err) {
    authError(syncErrorText(err));
  } finally {
    authForm.querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
}

authForm.addEventListener('submit', (e) => { e.preventDefault(); runAuth(); });
$('#auth-switch').addEventListener('click', () => {
  setAuthMode(!authCreate);
  const f = authForm.elements;
  (!f.email.value ? f.email : !f.password.value ? f.password : authCreate ? f.repeat : f.password).focus();
});
$('#auth-forgot').addEventListener('click', async () => {
  const email = authForm.elements.email.value.trim();
  if (!email) return authError(T('Enter your email first, then tap “Forgot password?” again.'));
  try {
    await resetPassword(email);
    authError('');
    snackbar(T('If {email} has an account, a reset link is on its way', { email }));
  } catch (err) {
    authError(syncErrorText(err));
  }
});
$('#auth-show').addEventListener('click', (e) => {
  const f = authForm.elements;
  const show = f.password.type === 'password';
  f.password.type = f.repeat.type = show ? 'text' : 'password';
  e.currentTarget.setAttribute('aria-pressed', String(show));
  e.currentTarget.querySelector('use').setAttribute('href', `${SPRITE}#${show ? 'visibility_off' : 'visibility'}`);
});

/* ---------- Account: change the password, delete the account ---------- */

const accountDialog = $('#account-dialog');
const accountForm = $('#account-form');
let accountMode = 'password';   // or 'delete'

function openAccountForm(mode) {
  accountMode = mode;
  const del = mode === 'delete';
  accountForm.reset();
  $('#account-title').textContent = del ? T('Delete account?') : T('Change password');
  $('#account-text').textContent = del
    ? T('This deletes the account {email} and the trips stored in it, for good. Other devices signed in lose their copy.', { email: sync.saved.email }) + ' ' +
      (Object.values(sharing.roots).some(r => ownsShare(r) && r.members.length > 1) ? T('The people you invited to a trip lose that trip too.') + ' ' : '') +
      T('The trips stay on this device. Enter your password to confirm.')
    : T('Other devices signed in to this account will have to sign in again with the new password.');
  accountForm.querySelectorAll('[data-new-password]').forEach((el) => { el.hidden = del; });
  $('#account-submit').textContent = del ? T('Delete account') : T('Change password');
  $('#account-submit').classList.toggle('danger', del);
  accountError('');
  accountDialog.showModal();
  accountForm.elements.current.focus();
}

function accountError(text) {
  $('#account-error').textContent = text;
  $('#account-error').hidden = !text;
}

accountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = accountForm.elements;
  const current = f.current.value;
  const next = f.next.value;
  if (!current) return accountError(T('Enter your current password.'));
  if (accountMode === 'password') {
    if (next.length < 6) return accountError(T('Use at least 6 characters for the new password.'));
    if (next !== f.repeat.value) return accountError(T('The two new passwords don’t match.'));
    if (next === current) return accountError(T('That’s the password you already have.'));
  }
  if (!navigator.onLine) return accountError(T('No connection. Try again when you’re online.'));
  accountError('');
  accountForm.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    if (accountMode === 'password') {
      await changePassword(current, next);
      accountDialog.close();
      snackbar(T('Password changed'));
    } else {
      await deleteAccount(current);
      accountDialog.close();
      render();
      snackbar(T('Account deleted — your trips are still on this device'));
    }
  } catch (err) {
    const wrong = /wrong-password|invalid-credential|invalid-login-credentials/.test((err && err.code) || '');
    accountError(wrong ? T('The current password is wrong.') : syncErrorText(err));
  } finally {
    accountForm.querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
});

/* ---------- The name shown to the people you plan trips with (share.js) ---------- */

function openNameForm() {
  const form = $('#name-form');
  form.reset();
  form.elements.name.value = (state.profile || {}).name || '';
  $('#name-dialog').showModal();
  form.elements.name.focus();
}

$('#name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = tidyName(e.currentTarget.elements.name.value);
  const before = (state.profile || {}).name || '';
  $('#name-dialog').close();
  if (name === before) return;
  if (name) state.profile = { name }; else delete state.profile;
  save();
  render();
  renderShare();      // it may be open underneath
  snackbar(name ? T('People on your trips now see “{name}”', { name }) : T('Name removed'));
});

/* ---------- Taps in Settings → Account ---------- */

onAction('sign-in', () => openAuthForm());
onAction('edit-name', () => openNameForm());
onAction('change-password', () => openAccountForm('password'));
onAction('delete-account', () => openAccountForm('delete'));
onAction('verify-email', async () => {
  if (!navigator.onLine) { snackbar(T('No connection. Try again when you’re online.')); return; }
  try {
    const done = await verifyEmail();
    snackbar(done ? T('Email confirmed') : T('Link sent to {email} — look in your spam folder too', { email: sync.saved.email }));
  } catch (err) {
    snackbar(syncErrorText(err));
  }
});
onAction('sign-out', async () => {
  const ok = await askConfirm({
    icon: 'logout',
    title: T('Sign out?'),
    text: T('Your plans stay on this device, but changes will no longer sync with other devices until you sign in again.'),
    ok: T('Sign out'),
  });
  if (!ok) return;
  await signOut();
  render();
  snackbar(T('Signed out'));
});
