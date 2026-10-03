'use strict';

/* =========================================================
   Trip essentials: the practical things to know on arrival.
   - Facts about the country (Wikidata): emergency number, language, currency,
     plugs, which side cars drive on, calling code.
   - Local time (the time zone comes from Open-Meteo).
   - Short summaries from the Wikivoyage guide: getting around, staying safe,
     language, customs, staying connected.
   Fetched once per place while online and saved on the phone, so it works offline.
   Functions here use helpers from app.js, which is loaded after this file.
   ========================================================= */

const ESSENTIALS_KEY = 'tripPlanner.essentials';
const ESSENTIALS_MAX_AGE = 60 * 864e5;

const ESSENTIAL_SECTIONS = [
  { key: 'around', title: 'Getting around', icon: 'directions_bus', heads: ['Get around'] },
  { key: 'safe', title: 'Staying safe', icon: 'health_and_safety', heads: ['Stay safe', 'Stay healthy'] },
  { key: 'talk', title: 'Language', icon: 'translate', heads: ['Talk'] },
  { key: 'respect', title: 'Customs', icon: 'handshake', heads: ['Respect'] },
  { key: 'connect', title: 'Staying connected', icon: 'wifi', heads: ['Connect'] },
];

// Wikidata's names for plug standards → the letters printed on travel adapters.
const PLUG_LETTERS = {
  'nema 1-15': 'A', 'nema 5-15': 'B', europlug: 'C', 'bs 546': 'D', 'cee 7/5': 'E', schuko: 'F',
  'bs 1363': 'G', 'si 32': 'H', 'as/nzs 3112': 'I', 'sev 1011': 'J', 'afsnit 107-2-d1': 'K', 'cei 23-50': 'L',
  'iec 60906-1': 'N', 'tis 166-2549': 'O',
};

const essentials = {
  saved: (() => { try { return JSON.parse(localStorage.getItem(ESSENTIALS_KEY)) || {}; } catch { return {}; } })(),
  status: new Map(),     // place key → 'loading' | 'failed'
  tripId: null,          // the trip shown in the sheet
};

function essentialsFor(trip) {
  if (!trip.place) return null;
  const key = placeKey(trip.place);
  const had = essentials.saved[key];
  if (!had || Date.now() - had.t > ESSENTIALS_MAX_AGE) loadEssentials(trip.place);
  return had || null;
}

/* ---------- Fetching ---------- */

async function countryFacts(qid) {
  // Names are in English, or in Wikidata's "mul" (same in every language, e.g. "euro").
  const query = `SELECT ?country ?prop ?val ?label ?mul WHERE {
    wd:${qid} wdt:P17 ?country .
    VALUES ?prop { wdt:P2852 wdt:P37 wdt:P38 wdt:P2853 wdt:P1622 wdt:P2884 wdt:P474 }
    ?country ?prop ?val .
    OPTIONAL { ?val rdfs:label ?label . FILTER(LANG(?label) = "en") }
    OPTIONAL { ?val rdfs:label ?mul . FILTER(LANG(?mul) = "mul") }
  }`;
  const data = await getJSON('https://query.wikidata.org/sparql', { format: 'json', query });
  // A place can list more than one country (e.g. a historic one): use the best-described.
  const byCountry = new Map();
  for (const b of data.results.bindings) {
    const id = b.country.value.split('/').pop();
    if (!byCountry.has(id)) byCountry.set(id, []);
    byCountry.get(id).push({ prop: b.prop.value.split('/').pop(), value: (b.label || b.mul || b.val).value });
  }
  const [country, rows] = [...byCountry].sort((a, b) => b[1].length - a[1].length)[0] || [];
  if (!country) return null;
  const all = prop => [...new Set(rows.filter(r => r.prop === prop).map(r => r.value))].filter(v => !/^https?:/.test(v));
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const plugs = all('P2853').map((name) => {
    const letter = PLUG_LETTERS[name.toLowerCase()];
    return letter ? `Type ${letter} (${name})` : name;
  }).sort();
  return {
    country,
    emergency: all('P2852').filter(n => /^[\d\s-]{2,8}$/.test(n)).slice(0, 3),
    languages: all('P37').map(cap).slice(0, 4),
    currency: all('P38').map(cap).slice(0, 2),
    plugs: plugs.slice(0, 4),
    voltage: all('P2884')[0] ? `${Math.round(Number(all('P2884')[0]))} V` : '',
    driving: all('P1622')[0] || '',
    calling: all('P474')[0] || '',
  };
}

async function wikivoyageTitleOf(qid) {
  const data = await getJSON('https://www.wikidata.org/w/api.php', wm({ action: 'wbgetentities', ids: qid, props: 'sitelinks', sitefilter: 'enwikivoyage' }));
  const link = data.entities && data.entities[qid] && data.entities[qid].sitelinks.enwikivoyage;
  return link ? link.title : null;
}

// A section's first few sentences, as plain text (at most ~450 characters).
function sectionSummary(text) {
  const clean = plainText(text
    .replace(/^=+[^=\n]*=+\s*$/gm, '\n')         // sub-headings
    .replace(/^[*#:;]+\s*/gm, '')                 // list markers
    .replace(/\{\|[\s\S]*?\|\}/g, ''));           // tables
  if (clean.length < 40) return '';
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) || [clean];
  let out = '';
  for (const s of sentences) {
    if (out && (out + s).length > 450) break;
    out += s;
    if (out.length > 300) break;
  }
  return out.trim().slice(0, 600);
}

const wikivoyageUrl = (title, head) =>
  'https://en.wikivoyage.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')) + (head ? '#' + encodeURIComponent(head.replace(/ /g, '_')) : '');

function loadEssentials(place) {
  const key = placeKey(place);
  // After a failure, only "Try again" asks again.
  if (essentials.status.has(key) || !navigator.onLine) return;
  essentials.status.set(key, 'loading');
  (async () => {
    const qid = await wikidataIdFor(place);
    const [facts, tz, ownTitle] = await Promise.all([
      qid ? countryFacts(qid).catch(() => null) : null,
      getJSON('https://api.open-meteo.com/v1/forecast', { latitude: place.lat, longitude: place.lng, timezone: 'auto', forecast_days: '1', daily: 'weather_code' })
        .then(d => d.timezone).catch(() => ''),
      wikivoyageTitle(place).catch(() => null),
    ]);
    // The place's own guide page first, then its country's page for what the first one lacks.
    const countryTitle = facts && facts.country !== qid ? await wikivoyageTitleOf(facts.country).catch(() => null) : null;
    const titles = [...new Set([ownTitle, countryTitle].filter(Boolean))];
    const texts = titles.length ? await wikivoyagePages(titles) : [];
    const ordered = titles.map(t => texts.find(p => p.title === t)).filter(Boolean);

    const sections = [];
    for (const s of ESSENTIAL_SECTIONS) {
      let found = null;
      for (const page of ordered) {
        for (const head of s.heads) {
          const summary = sectionSummary(section(page.text, head));
          if (summary) { found = { key: s.key, text: summary, url: wikivoyageUrl(page.title, head), from: page.title }; break; }
        }
        if (found) break;
      }
      if (s.key === 'talk') {
        const book = ordered.map(p => /\[\[([^\]|#]*phrasebook)/i.exec(section(p.text, 'Talk'))).find(Boolean);
        if (book) {
          found = found || { key: s.key, text: '', url: '', from: '' };
          found.phrasebook = { title: book[1].trim(), url: wikivoyageUrl(book[1].trim()) };
        }
      }
      if (found) sections.push(found);
    }

    if (!facts && !sections.length && !tz) throw new Error('nothing found');
    essentials.saved[key] = { t: Date.now(), facts, tz, sections, name: place.name };
    const keys = Object.keys(essentials.saved).sort((a, b) => essentials.saved[b].t - essentials.saved[a].t);
    for (const old of keys.slice(10)) delete essentials.saved[old];
    try { localStorage.setItem(ESSENTIALS_KEY, JSON.stringify(essentials.saved)); } catch { /* storage full */ }
    essentials.status.delete(key);
  })()
    .catch((err) => {
      console.warn('No essentials for', place.label, err);
      essentials.status.set(key, 'failed');
    })
    .finally(() => { if ($('#info-dialog').open) renderEssentials(); });
}

/* ---------- The Essentials sheet ---------- */

function localTime(tz) {
  try {
    const now = new Date();
    const time = fmtClock(now, tz);
    const wall = zone => new Date(now.toLocaleString('en-US', zone ? { timeZone: zone } : {}));
    const diff = Math.round((wall(tz) - wall()) / 18e5) / 2;
    const rel = !diff ? 'same time as you' : `${Math.abs(diff)} h ${diff > 0 ? 'ahead of' : 'behind'} you`;
    return { time, rel };
  } catch { return null; }
}

function factTile(ic, label, value, href) {
  if (!value) return '';
  const inner = `<span class="fact-icon">${icon(ic)}</span><span class="fact-text"><span class="fact-label">${label}</span><span class="fact-value">${esc(value)}</span></span>`;
  return href
    ? `<a class="fact ripple" href="${esc(href)}">${inner}</a>`
    : `<div class="fact">${inner}</div>`;
}

function renderEssentials() {
  const trip = state.trips.find(t => t.id === essentials.tripId);
  const body = $('#info-body');
  if (!trip) return;
  $('#info-title').textContent = `Essentials · ${trip.place ? trip.place.name : trip.name}`;
  const e = essentialsFor(trip);
  const key = trip.place && placeKey(trip.place);
  const status = key && essentials.status.get(key);

  if (!e) {
    body.innerHTML = !trip.place
      ? emptyState('location_off', 'No place picked yet', 'Edit the trip and pick the city or country from the list to see its essentials.')
      : status === 'loading'
        ? emptyState('info', `Getting the essentials for ${esc(trip.place.name)}…`, 'Emergency number, plugs, local time and tips from the travel guide.')
        : !navigator.onLine
          ? emptyState('cloud_off', 'Needs a connection once', 'Open this while online, and the essentials are saved on your device for the trip.')
          : emptyState('info', 'Nothing found', 'The travel guide may not cover this place, or the connection dropped.',
              `<button type="button" class="btn tonal ripple" data-action="retry-essentials">${icon('restart_alt')}Try again</button>`);
    return;
  }

  const f = e.facts || {};
  const t = e.tz && localTime(e.tz);
  const emergency = (f.emergency || [])[0];
  const tiles = [
    factTile('emergency', 'Emergency', (f.emergency || []).join(' · '), emergency && `tel:${emergency.replace(/\D/g, '')}`),
    t && factTile('schedule', 'Local time', `${t.time} · ${t.rel}`),
    factTile('translate', (f.languages || []).length > 1 ? 'Languages' : 'Language', (f.languages || []).join(', ')),
    factTile('payments', 'Currency', (f.currency || []).join(', ')),
    factTile('power', 'Plugs', [(f.plugs || []).join(', '), f.voltage].filter(Boolean).join(' · ')),
    factTile('directions_car', 'Driving', f.driving ? `On the ${f.driving}` : ''),
    factTile('call', 'Calling code', f.calling),
  ].filter(Boolean).join('');

  const sections = e.sections.map((s) => {
    const def = ESSENTIAL_SECTIONS.find(x => x.key === s.key);
    return `
      <section class="tip">
        <h3>${icon(def.icon)}${def.title}</h3>
        ${s.text ? `<p>${esc(s.text)}</p>` : ''}
        <div class="tip-links">
          ${s.url ? `<a class="assist-chip ripple" href="${esc(s.url)}" target="_blank" rel="noopener">${icon('open_in_new')}More on Wikivoyage</a>` : ''}
          ${s.phrasebook ? `<a class="assist-chip ripple" href="${esc(s.phrasebook.url)}" target="_blank" rel="noopener">${icon('translate')}${esc(s.phrasebook.title)}</a>` : ''}
        </div>
      </section>`;
  }).join('');

  body.innerHTML = `
    ${tiles ? `<div class="facts">${tiles}</div>` : ''}
    ${sections}
    <p class="footnote">Facts: Wikidata. Tips: Wikivoyage, CC BY-SA. Saved on your device ${esc(new Date(e.t).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' }))}.</p>`;
}

function openEssentials(trip) {
  essentials.tripId = trip.id;
  renderEssentials();
  $('#info-dialog').showModal();
  $('#info-body').scrollTop = 0;
}
