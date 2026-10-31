'use strict';

/* =========================================================
   About a plan: what the place is, why go, and what to know before going.
   Opened from the "i" button on a plan's card. It puts together:
   - the travel guide's entry for the place (Wikivoyage): description, hours, price, how to get there;
   - the start of its Wikipedia article and its picture, found by name among the articles
     about places within a kilometre of the plan;
   - the opening hours for the plan's day (hours.js) and your own notes.
   What Wikipedia said is saved on the device, so it shows offline afterwards.
   Functions here also use the screen's files (ui.js … app.js), which load after this one.
   ========================================================= */

const INFO_KEY = 'tripPlanner.info';
const INFO_MAX_AGE = 60 * 864e5;
const INFO_KINDS = ['sight', 'event', 'shopping', 'other'];     // a lunch or a train isn't looked up
const INFO_VERSION = 2;           // 2: a sight is no longer taken for the station named after it. Older answers are asked again.
// "Museum of Fine Arts station" is the tram stop, not the museum.
const TRANSIT_ARTICLE = /\b(station|subway|metro|light rail|railway|tram stop|bus stop)\b/i;

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
  if (had && had.v === INFO_VERSION && Date.now() - had.t < INFO_MAX_AGE) return had;
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
    // The article with the plan's very name comes first: "Statue of Liberty", not "Statue of Liberty Museum".
    const bare = s => norm(s).replace(/^the\s+/, '').trim();
    const names = [item.title, p && p.name].filter(Boolean).map(bare);
    for (const page of near.query ? near.query.geosearch : []) {
      if (TRANSIT_ARTICLE.test(page.title) && !TRANSIT_ARTICLE.test(item.title)) continue;
      const tags = { name: page.title.replace(/\s*\([^)]*\)$/, '') };
      const byName = nameScore(named, tags), byPlace = nameScore(placed, tags);
      const score = names.includes(bare(tags.name)) ? 4 : byName >= 0.6 ? 2 + byName : byPlace >= 0.6 ? byPlace : 0;
      if (score && (!best || score > best.score || (score === best.score && page.title.length > best.page.title.length))) best = { score, page };
    }
    let entry = { t: Date.now(), v: INFO_VERSION };
    if (best) {
      const data = await getJSON('https://en.wikipedia.org/w/api.php', wm({
        action: 'query', pageids: best.page.pageid, prop: 'extracts|pageimages|info', exintro: '1', explaintext: '1', exsentences: '5',
        piprop: 'thumbnail', pithumbsize: '640', inprop: 'url',
      }));
      const page = data.query.pages[0];
      if (page && page.extract) entry = { t: Date.now(), v: INFO_VERSION, title: page.title, text: page.extract.slice(0, 900), img: page.thumbnail ? page.thumbnail.source : '', url: page.fullurl || '' };
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
    else renderSoon();     // a card's photo, and the next plans to look up
  });
  return had || null;
}

// A photo for a plan's card: the guide's, else the Wikipedia article's (looked up a few at a time).
function planPhoto(item, guide) {
  const p = matchPlaces(item, guide)[0];
  if (p && p.photo) return p.photo;
  const c = INFO_KINDS.includes(item.category) && coordsOf(item, guide);
  if (!c) return '';
  const had = planInfo.saved[infoKey(item, c)];
  // An answer from an older version still shows (offline it is all there is), and is asked again.
  if ((!had || had.v !== INFO_VERSION) && planInfo.loading.size < 3) wikiAbout(item, c, p || null);
  return had ? had.img || '' : '';
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
  // A destination's words may come from the same Wikipedia article as "What it is": said once.
  const said = text => norm(text || '').slice(0, 60);
  const why = p && (!wiki || !wiki.text || said(p.about || p.blurb) !== said(wiki.text)) ? (p.about || p.blurb) : '';
  const site = safeUrl((p && p.url) || item.link);
  const facts = factsHTML([
    [T('Usual hours'), p && p.hours],
    [T('Price'), p && p.price],
    [T('Getting there'), p && p.tip],
    [T('Time to allow'), p && p.mins < 360 ? fmtDuration(p.mins) : ''],
    [T('Your notes'), item.notes],
  ]);
  const photos = [p && p.photo, wiki && wiki.img].filter((src, k, all) => src && all.indexOf(src) === k);

  $('#place-body').innerHTML = `
    ${photos.map(src => `<figure class="pi-figure">${photoImg({ photo: src }, 'pi-photo').replace(' loading="lazy"', '')}<figcaption>${T('Photo: Wikimedia Commons')}</figcaption></figure>`).join('')}
    <div class="pi-head">
      <span class="avatar" style="--h:${cat.hue}">${icon(cat.icon + '-fill')}</span>
      <div class="pi-heading">
        <p class="overline">${esc(over)}</p>
        <h2 tabindex="-1" autofocus>${esc(item.title)}</h2>
      </div>
      <button type="button" class="icon-btn ripple" data-close aria-label="${T('Close')}">${icon('close')}</button>
    </div>
    ${item.place && norm(item.place) !== norm(item.title) ? `<p class="pi-hours">${icon('location_on')}<span>${esc(item.place)}</span></p>` : ''}
    ${note ? `<p class="pi-hours ${note.warn ? 'warn' : ''}">${icon(note.warn ? 'event_busy' : 'schedule')}<span>${esc(note.text)}${item.date ? ` ${T('on {day}', { day: esc(fmtDay(item.date, { weekday: 'long' })) })}` : ''}</span></p>` : ''}
    ${wiki && wiki.text ? `
      <section class="tip">
        <h3>${icon('info')}${T('What it is')}</h3>
        <p>${esc(wiki.text)}</p>
        <div class="tip-links">${safeUrl(wiki.url) ? `<a class="assist-chip ripple" href="${esc(safeUrl(wiki.url))}" target="_blank" rel="noopener">${icon('open_in_new')}${T('Wikipedia: {title}', { title: esc(wiki.title) })}</a>` : ''}</div>
      </section>` : ''}
    ${why ? `
      <section class="tip">
        <h3>${icon('auto_awesome')}${T('Why go')}</h3>
        <p>${esc(why)}</p>
        <div class="tip-links">${guide.sourceUrl && !p.local ? `<a class="assist-chip ripple" href="${esc(guide.sourceUrl)}" target="_blank" rel="noopener">${icon('open_in_new')}${T('{source} travel guide', { source: esc(guide.source) })}</a>` : ''}</div>
      </section>` : ''}
    ${facts ? `
      <section class="tip">
        <h3>${icon('schedule')}${T('Know before you go')}</h3>
        ${facts}
        <p class="pi-small">${T('Hours and prices change — check before you go.')}</p>
      </section>` : ''}
    ${looking ? `<p class="guide-note" role="status">${icon('travel_explore')}${T('Looking it up…')}</p>` : ''}
    ${!looking && !(wiki && wiki.text) && !why && !facts ? `<p class="supporting">${navigator.onLine
      ? T('Nothing found about this place. A fuller name or address on the plan can help.')
      : T('You’re offline. Open this once while online, and it is saved for later.')}</p>` : ''}
    <div class="pi-links">
      ${item.place ? `<a class="assist-chip ripple" href="${esc(mapsUrl(item.place, trip, c, item.title))}" target="_blank" rel="noopener">${icon('location_on')}${T('Directions')}</a>` : ''}
      ${site ? `<a class="assist-chip ripple" href="${esc(site)}" target="_blank" rel="noopener">${icon('link')}${esc(hostLabel(site))}</a>` : ''}
    </div>
    <div class="sheet-actions" data-id="${esc(item.id)}">
      ${item.date ? '' : ideaActionsHTML(item, trip)}
      <span class="spacer"></span>
      <button type="button" class="btn tonal ripple" data-action="plan-edit">${icon('edit')}${item.date ? T('Edit plan') : T('Edit')}</button>
    </div>`;
}

// An idea's sheet also gives it a heart (on a trip planned together) and puts it on a day.
function ideaActionsHTML(item, trip) {
  const hearts = heartsOn(trip) ? heartsFor(trip, item.id) : null;
  const liked = !!hearts && hearts.includes(sync.saved.uid);
  return `
    ${hearts ? `<button type="button" class="btn tonal ripple heart-btn" data-action="heart" aria-pressed="${liked}" aria-label="${T('Like {name}', { name: esc(item.title) })}">
      ${icon(liked ? 'favorite-fill' : 'favorite')}${hearts.length ? hearts.length : T('Like')}</button>` : ''}
    ${tripDays(trip).length ? `<button type="button" class="btn filled ripple" data-action="info-pick-day">${icon('calendar_add_on')}${T('Add to a day')}</button>` : ''}`;
}

function openPlanInfo(id) {
  planInfo.itemId = id;
  renderPlanInfo();
  const dlg = $('#place-dialog');
  if (findItem(id) && !dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

onAction('plan-info', el => openPlanInfo(idOf(el)));
// "Add to a day" in an idea's sheet: back to the list, where the idea's buttons have turned into the trip's days.
onAction('info-pick-day', (el) => {
  ui.pickDay = idOf(el);
  $('#place-dialog').close();
  render();
});
// "Edit plan" in the sheet.
onAction('plan-edit', () => {
  const found = findItem(planInfo.itemId);
  $('#place-dialog').close();
  if (found) openItemForm(found.item);
});
