'use strict';

/* =========================================================
   About a plan: what the place is, why go, and what to know before going.
   Opened from the "i" button on a plan's card. It puts together:
   - the travel guide's entry for the place (Wikivoyage): description, hours, price, how to get there;
   - the start of its Wikipedia article and its picture, found by name among the articles
     about places within a kilometre of the plan;
   - the opening hours for the plan's day (hours.js) and your own notes.
   What Wikipedia said is saved on the device, so it shows offline afterwards.
   Functions here use helpers from app.js, which is loaded after this file.
   ========================================================= */

const INFO_KEY = 'tripPlanner.info';
const INFO_MAX_AGE = 60 * 864e5;
const INFO_KINDS = ['sight', 'event', 'shopping', 'other'];     // a lunch or a train isn't looked up

const planInfo = {
  saved: (() => { try { return JSON.parse(localStorage.getItem(INFO_KEY)) || {}; } catch { return {}; } })(),
  loading: new Set(),
  failed: new Set(),
  itemId: null,          // the plan shown in the sheet
};

const infoKey = (item, c) => `${c.lat.toFixed(3)},${c.lng.toFixed(3)}|${norm(item.title)}`;

// The Wikipedia article about a plan's place, if one was found: { title, text, img, url }.
// Starts looking for it when it hasn't been asked yet. p: the plan's guide place, if any.
function wikiAbout(item, c, p) {
  const key = infoKey(item, c);
  const had = planInfo.saved[key];
  if (had && Date.now() - had.t < INFO_MAX_AGE) return had;
  if (!navigator.onLine || planInfo.loading.has(key) || planInfo.failed.has(key)) return had || null;
  planInfo.loading.add(key);
  (async () => {
    // First the names of the articles about places around the plan, then the best match's text and picture.
    const near = await getJSON('https://en.wikipedia.org/w/api.php', wm({
      action: 'query', list: 'geosearch', gscoord: `${c.lat}|${c.lng}`, gsradius: '1500', gslimit: '50',
    }));
    // The article named like the plan (or like its guide place); failing that, like its address.
    const named = { title: `${item.title} ${p ? p.name : ''}`, place: '' };
    const placed = { title: '', place: item.place };
    let best = null;
    for (const page of near.query ? near.query.geosearch : []) {
      const tags = { name: page.title.replace(/\s*\([^)]*\)$/, '') };
      const byName = nameScore(named, tags), byPlace = nameScore(placed, tags);
      const score = byName >= 0.6 ? 2 + byName : byPlace >= 0.6 ? byPlace : 0;
      if (score && (!best || score > best.score || (score === best.score && page.title.length > best.page.title.length))) best = { score, page };
    }
    let entry = { t: Date.now() };
    if (best) {
      const data = await getJSON('https://en.wikipedia.org/w/api.php', wm({
        action: 'query', pageids: best.page.pageid, prop: 'extracts|pageimages|info', exintro: '1', explaintext: '1', exsentences: '5',
        piprop: 'thumbnail', pithumbsize: '640', inprop: 'url',
      }));
      const page = data.query.pages[0];
      if (page && page.extract) entry = { t: Date.now(), title: page.title, text: page.extract.slice(0, 900), img: page.thumbnail ? page.thumbnail.source : '', url: page.fullurl || '' };
    }
    planInfo.saved[key] = entry;
    const keys = Object.keys(planInfo.saved).sort((a, b) => planInfo.saved[b].t - planInfo.saved[a].t);
    for (const old of keys.slice(150)) delete planInfo.saved[old];
    try { localStorage.setItem(INFO_KEY, JSON.stringify(planInfo.saved)); } catch { /* storage full */ }
  })().catch((err) => {
    console.warn('No article for', item.title, err);
    planInfo.failed.add(key);
  }).finally(() => {
    planInfo.loading.delete(key);
    if ($('#place-dialog').open && planInfo.itemId === item.id) renderPlanInfo();
  });
  return had || null;
}

// Does a plan have something to tell? (decides whether its card gets the "i" button)
function hasPlanInfo(item, guide) {
  return item.category !== 'transport' && (matchPlaces(item, guide).length > 0 || (INFO_KINDS.includes(item.category) && !!coordsOf(item, guide)));
}

// A short list of facts: [[label, text], …], skipping the empty ones.
function factsHTML(rows) {
  const shown = rows.filter(r => r[1]);
  return shown.length ? `<dl class="pi-facts">${shown.map(([label, text]) => `<div><dt>${esc(label)}</dt><dd>${esc(text)}</dd></div>`).join('')}</dl>` : '';
}

function renderPlanInfo() {
  const found = findItem(planInfo.itemId);
  if (!found) { $('#place-dialog').close(); return; }
  const { item, trip } = found;
  const guide = guideFor(trip);
  const p = matchPlaces(item, guide)[0] || null;
  const c = coordsOf(item, guide);
  const cat = CATEGORIES[item.category] || CATEGORIES.other;
  const wiki = c && INFO_KINDS.includes(item.category) ? wikiAbout(item, c, p) : null;
  const looking = c && planInfo.loading.has(infoKey(item, c));
  const note = hoursNote(item, guide);
  const over = [item.date && fmtDay(item.date), item.time && fmtTime(item.time), cat.label].filter(Boolean).join(' · ');
  const why = p ? (p.about || p.blurb) : '';
  const site = safeUrl((p && p.url) || item.link);
  const facts = factsHTML([
    ['Usual hours', p && p.hours],
    ['Price', p && p.price],
    ['Getting there', p && p.tip],
    ['Time to allow', p && p.mins < 360 ? fmtDuration(p.mins) : ''],
    ['Your notes', item.notes],
  ]);
  const photos = [p && p.photo, wiki && wiki.img].filter((src, k, all) => src && all.indexOf(src) === k);

  $('#place-body').innerHTML = `
    ${photos.map(src => `<figure class="pi-figure">${photoImg({ photo: src }, 'pi-photo').replace(' loading="lazy"', '')}<figcaption>Photo: Wikimedia Commons</figcaption></figure>`).join('')}
    <div class="pi-head">
      <span class="avatar" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}</span>
      <div class="pi-heading">
        <p class="overline">${esc(over)}</p>
        <h2 tabindex="-1" autofocus>${esc(item.title)}</h2>
      </div>
      <button type="button" class="icon-btn ripple" data-close aria-label="Close">${icon('close')}</button>
    </div>
    ${item.place && norm(item.place) !== norm(item.title) ? `<p class="pi-hours">${icon('location_on')}<span>${esc(item.place)}</span></p>` : ''}
    ${note ? `<p class="pi-hours ${note.warn ? 'warn' : ''}">${icon(note.warn ? 'event_busy' : 'schedule')}<span>${esc(note.text)}${item.date ? ` on ${esc(fmtDay(item.date, { weekday: 'long' }))}` : ''}</span></p>` : ''}
    ${wiki && wiki.text ? `
      <section class="tip">
        <h3>${icon('info')}What it is</h3>
        <p>${esc(wiki.text)}</p>
        <div class="tip-links">${safeUrl(wiki.url) ? `<a class="assist-chip ripple" href="${esc(safeUrl(wiki.url))}" target="_blank" rel="noopener">${icon('open_in_new')}Wikipedia: ${esc(wiki.title)}</a>` : ''}</div>
      </section>` : ''}
    ${why ? `
      <section class="tip">
        <h3>${icon('auto_awesome')}Why go</h3>
        <p>${esc(why)}</p>
        <div class="tip-links">${guide.sourceUrl && !p.local ? `<a class="assist-chip ripple" href="${esc(guide.sourceUrl)}" target="_blank" rel="noopener">${icon('open_in_new')}${esc(guide.source)} travel guide</a>` : ''}</div>
      </section>` : ''}
    ${facts ? `
      <section class="tip">
        <h3>${icon('schedule')}Know before you go</h3>
        ${facts}
        <p class="pi-small">Hours and prices change — check before you go.</p>
      </section>` : ''}
    ${looking ? `<p class="guide-note" role="status">${icon('travel_explore')}Looking it up…</p>` : ''}
    ${!looking && !(wiki && wiki.text) && !why && !facts ? `<p class="supporting">${navigator.onLine
      ? 'Nothing found about this place. A fuller name or address on the plan can help.'
      : 'You’re offline. Open this once while online, and it is saved for later.'}</p>` : ''}
    <div class="pi-links">
      ${item.place ? `<a class="assist-chip ripple" href="${esc(mapsUrl(item.place, trip))}" target="_blank" rel="noopener">${icon('location_on')}Directions</a>` : ''}
      ${site ? `<a class="assist-chip ripple" href="${esc(site)}" target="_blank" rel="noopener">${icon('link')}${esc(hostLabel(site))}</a>` : ''}
    </div>
    <div class="sheet-actions">
      <span class="spacer"></span>
      <button type="button" class="btn tonal ripple" data-action="plan-edit">${icon('edit')}Edit plan</button>
    </div>`;
}

function openPlanInfo(id) {
  planInfo.itemId = id;
  renderPlanInfo();
  const dlg = $('#place-dialog');
  if (findItem(id) && !dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action="plan-info"], [data-action="plan-edit"]');
  if (!el) return;
  if (el.dataset.action === 'plan-info') {
    openPlanInfo(el.closest('[data-id]').dataset.id);
  } else {
    const found = findItem(planInfo.itemId);
    $('#place-dialog').close();
    if (found) openItemForm(found.item);
  }
});
