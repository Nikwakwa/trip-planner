'use strict';

/* =========================================================
   Tickets & bookings: photos and PDFs attached to a plan (boarding passes,
   hotel confirmations, museum tickets…). Kept on this phone only (in the
   browser's file storage), so they open offline. They aren't synced to other
   phones or included in backup files.
   Functions here use helpers from app.js, which is loaded after this file.
   ========================================================= */

const FILES_DB = 'tripPlannerFiles';
const MAX_FILE = 15 * 1024 * 1024;      // 15 MB per file
const MAX_IMAGE_SIDE = 2200;            // bigger photos are shrunk to this (still sharp for a QR code)
// Photos and PDFs only. Drawings (SVG) and web pages are refused: opened from here, a file like
// that could run its own code inside the app and read the plans.
const SAFE_FILE = /^(image\/(jpeg|png|webp|gif|avif|heic|heif|bmp)|application\/pdf)$/;

const tickets = {
  index: new Map(),      // plan id → [{ id, name, type, size }] (without the file itself)
  db: null,
  form: null,            // the plan form's files: { have: [...], added: [...], removed: Set }
};

function filesDB() {
  tickets.db = tickets.db || new Promise((resolve, reject) => {
    const req = indexedDB.open(FILES_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' }).createIndex('item', 'itemId');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return tickets.db;
}

async function filesStore(mode) {
  return (await filesDB()).transaction('files', mode).objectStore('files');
}
const idbDone = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

// Loads the list of files (not the files themselves) at startup. Files of plans
// that no longer exist anywhere are cleared out.
async function loadFileIndex() {
  try {
    const all = await idbDone((await filesStore('readonly')).getAll());
    const planIds = new Set(state.trips.flatMap(t => t.items.map(i => i.id)));
    const orphans = all.filter(f => !planIds.has(f.itemId));
    tickets.index.clear();
    for (const f of all) {
      if (!planIds.has(f.itemId)) continue;
      if (!tickets.index.has(f.itemId)) tickets.index.set(f.itemId, []);
      tickets.index.get(f.itemId).push({ id: f.id, name: f.name, type: f.type, size: f.size });
    }
    // Only when signed out: a plan from the other phone may simply not have arrived yet.
    if (orphans.length && !sync.saved) {
      const store = await filesStore('readwrite');
      orphans.forEach(f => store.delete(f.id));
    }
    if (tickets.index.size) renderSoon();
  } catch (e) {
    console.warn('Files unavailable', e);
  }
}

const filesOf = id => tickets.index.get(id) || [];
const fmtSize = n => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// Large photos are shrunk before saving (phone photos are often 5–10 MB).
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 2.5 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

/* ---------- In the plan form ---------- */

function openFilesInForm(itemId) {
  tickets.form = { have: itemId ? filesOf(itemId).slice() : [], added: [], removed: new Set() };
  renderFormFiles();
}

function renderFormFiles() {
  const f = tickets.form;
  const list = [...f.have.filter(x => !f.removed.has(x.id)), ...f.added];
  $('#item-files').innerHTML = list.map(x => `
    <li class="file-row">
      ${icon(x.type === 'application/pdf' ? 'picture_as_pdf' : 'image')}
      <span class="file-name">${esc(x.name)}</span><span class="file-size">${fmtSize(x.size)}</span>
      <button type="button" class="icon-btn ripple" data-file-remove="${esc(x.id)}" aria-label="Remove ${esc(x.name)}">${icon('close')}</button>
    </li>`).join('');
}

document.getElementById('file-input').addEventListener('change', async (e) => {
  const picked = [...e.target.files];
  e.target.value = '';
  for (const raw of picked) {
    if (!SAFE_FILE.test(raw.type)) { snackbar(`${raw.name}: only photos and PDFs`); continue; }
    const file = await shrinkImage(raw);
    if (file.size > MAX_FILE) { snackbar(`${raw.name} is too big (max 15 MB)`); continue; }
    tickets.form.added.push({ id: uid(), name: file.name, type: file.type, size: file.size, blob: file });
  }
  renderFormFiles();
});

document.getElementById('item-files').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-file-remove]');
  if (!btn) return;
  const id = btn.dataset.fileRemove;
  const f = tickets.form;
  f.added = f.added.filter(x => x.id !== id);
  if (f.have.some(x => x.id === id)) f.removed.add(id);
  renderFormFiles();
});

// Called when the plan is saved: stores new files, deletes removed ones.
async function saveFormFiles(itemId) {
  const f = tickets.form;
  if (!f || (!f.added.length && !f.removed.size)) return;
  try {
    const store = await filesStore('readwrite');
    for (const x of f.added) store.put({ id: x.id, itemId, name: x.name, type: x.type, size: x.size, blob: x.blob, added: Date.now() });
    for (const id of f.removed) store.delete(id);
    await new Promise((resolve, reject) => { store.transaction.oncomplete = resolve; store.transaction.onerror = () => reject(store.transaction.error); });
    tickets.index.set(itemId, [...f.have.filter(x => !f.removed.has(x.id)), ...f.added.map(({ blob, ...x }) => x)]);
    if (!tickets.index.get(itemId).length) tickets.index.delete(itemId);
    render();
  } catch (e) {
    console.warn('Could not save files', e);
    snackbar('Couldn’t save the files — the device may be out of space');
  }
}

// "Erase everything" (app.js): every file goes too.
async function eraseFiles() {
  tickets.index.clear();
  try {
    (await filesStore('readwrite')).clear();
  } catch (e) {
    console.warn('Files unavailable', e);
  }
}

/* ---------- Viewing a plan's files ---------- */

const openUrls = [];

async function openFiles(itemId) {
  const found = findItem(itemId);
  if (!found) return;
  openUrls.splice(0).forEach(u => URL.revokeObjectURL(u));
  $('#files-title').textContent = found.item.title;
  $('#files-body').innerHTML = `<p class="guide-note">${icon('attach_file')}Opening…</p>`;
  $('#files-dialog').showModal();
  try {
    const store = await filesStore('readonly');
    const list = await idbDone(store.index('item').getAll(itemId));
    $('#files-body').innerHTML = `
      ${list.filter(f => f.type.startsWith('image/') || SAFE_FILE.test(f.type)).map((f) => {
        const url = URL.createObjectURL(f.blob);
        openUrls.push(url);
        // A drawing (SVG) attached before those were refused is shown, but can't be opened on its own.
        return f.type.startsWith('image/')
          ? `<figure class="file-view"><img src="${url}" alt="${esc(f.name)}"><figcaption>${esc(f.name)}
              ${SAFE_FILE.test(f.type) ? `<a class="assist-chip ripple" href="${url}" target="_blank" rel="noopener">${icon('open_in_new')}Full screen</a>` : ''}</figcaption></figure>`
          : `<a class="file-row file-open ripple" href="${url}" target="_blank" rel="noopener">${icon('picture_as_pdf')}
              <span class="file-name">${esc(f.name)}</span><span class="file-size">${fmtSize(f.size)}</span>${icon('open_in_new')}</a>`;
      }).join('') || '<p class="supporting">No files.</p>'}
      <p class="footnote">${icon('attach_file', 'sm')}Saved on this device only, and not shared with anyone. To change them, edit the plan.</p>`;
  } catch {
    $('#files-body').innerHTML = '<p class="supporting">Couldn’t open the files.</p>';
  }
}
