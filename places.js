'use strict';

/* =========================================================
   Finding a trip's place, and a guide of things to do there.
   - Place search: Photon (OpenStreetMap data), made for search-as-you-type.
   - Guide: the Wikivoyage travel guide for that place (sights, food, drink,
     shopping — or, for a country or region, its main cities and destinations).
     Places without a Wikivoyage page fall back to famous spots from Wikipedia.
   Guides are saved on the phone, so they keep working offline.
   Functions here use helpers from app.js, which is loaded after this file.
   ========================================================= */

const GUIDES_KEY = 'tripPlanner.guides';
const GUIDE_VERSION = 6;          // 2: full descriptions ("about") and opening hours; 3: photos; 4: price, website, photos of destinations; 5: how well known ("fame"); 6: descriptions no longer lose text at "U.S." or "3.5". Older saved guides are refreshed.
const MAX_SAVED_GUIDES = 16;
const WIKIVOYAGE = 'https://en.wikivoyage.org/w/api.php';

async function getJSON(url, params, signal) {
  const res = await fetch(url + '?' + new URLSearchParams(params), { signal });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}
// Standard parameters for Wikimedia sites (Wikivoyage, Wikipedia, Wikidata).
const wm = params => ({ format: 'json', formatversion: '2', origin: '*', ...params });

/* ---------- Place search (as you type) ---------- */

const SKIP_PLACE_TYPES = new Set(['neighbourhood', 'hamlet', 'isolated_dwelling', 'locality', 'farm', 'plot', 'quarter', 'city_block', 'square', 'house']);

function placeFromPhoton(f) {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const ext = p.extent; // [west, north, east, south]
  const bbox = ext ? [ext[0], ext[3], ext[2], ext[1]].map(v => Math.round(v * 1e4) / 1e4) : null;
  // A big area (over ~60 miles across) gets a guide of destinations, not streets.
  const wide = bbox && miles({ lat: bbox[1], lng: bbox[0] }, { lat: bbox[3], lng: bbox[2] }) > 60;
  const kind = p.type === 'country' ? 'country' : (p.type === 'state' || wide) ? 'region' : 'city';
  // A city named like its country keeps the country ("Luxembourg, Luxembourg"), so it isn't mistaken for it.
  const within = [kind === 'city' && p.country === 'United States' && p.state !== p.name ? p.state : '', kind !== 'country' ? p.country : '']
    .filter(Boolean);
  return {
    name: p.name,
    label: [p.name, ...within].join(', '),
    kind,
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(lng * 1e5) / 1e5,
    bbox,
    osm: `${p.osm_type}${p.osm_id}`,
  };
}

// Countries and cities before towns and villages that happen to share the name
// (so "Luxemburg" shows Luxembourg City before Luxemburg, Iowa). Otherwise the search's own order.
const PLACE_RANK = { country: 0, city: 1, state: 2, region: 2, province: 2, county: 3, town: 3 };

async function searchPlaces(q, signal) {
  const params = new URLSearchParams({ q, limit: '12', lang: 'en' });
  params.append('osm_tag', 'place');
  params.append('osm_tag', 'boundary:administrative');
  const res = await fetch('https://photon.komoot.io/api/?' + params, { signal });
  if (!res.ok) throw new Error('place search failed');
  const data = await res.json();
  const seen = new Set();
  // Map areas (boundaries) by their type; places by what they are (a village's "type" says city).
  const rank = ({ properties: p }) => (p.osm_key === 'boundary' ? { country: 0, state: 2, city: 3 }[p.type] : PLACE_RANK[p.osm_value]) ?? 4;
  return data.features
    .filter(f => f.properties.name && !SKIP_PLACE_TYPES.has(f.properties.osm_value))
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (rank(a.f) - rank(b.f)) || (a.i - b.i))
    .map(({ f }) => placeFromPhoton(f))
    .filter(p => !seen.has(p.label + p.kind) && seen.add(p.label + p.kind))
    .slice(0, 6);
}

// The best match for a name, or null. Gives up after a few seconds.
async function findPlace(name) {
  if (!navigator.onLine) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    return (await searchPlaces(name, ctl.signal))[0] || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const KIND_LABEL = { city: 'City', region: 'Region', country: 'Country' };

/* ---------- Reading Wikivoyage pages (wikitext) ---------- */

// Splits "{{see | name=... | lat=... }}" style templates, respecting nested {{ }} and [[ ]].
function findTemplates(text, test) {
  const out = [];
  let i = 0;
  while ((i = text.indexOf('{{', i)) !== -1) {
    let depth = 0, j = i;
    for (; j < text.length - 1; j++) {
      const two = text.substr(j, 2);
      if (two === '{{' || two === '[[') { depth++; j++; }
      else if (two === '}}' || two === ']]') { depth--; j++; if (!depth) break; }
    }
    const body = text.slice(i + 2, j - 1);
    const name = body.split('|')[0].trim().toLowerCase();
    if (test(name)) {
      out.push({ name, params: templateParams(body), end: j + 1 });
      i = j + 1;
    } else {
      i += 2;
    }
  }
  return out;
}

function templateParams(body) {
  const parts = [];
  let depth = 0, start = 0;
  for (let j = 0; j < body.length; j++) {
    const two = body.substr(j, 2);
    if (two === '{{' || two === '[[') { depth++; j++; }
    else if (two === '}}' || two === ']]') { depth--; j++; }
    else if (body[j] === '|' && !depth) { parts.push(body.slice(start, j)); start = j + 1; }
  }
  parts.push(body.slice(start));
  const params = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return params;
}

// Takes out pictures: [[File:…]] and [[Image:…]], whose caption can hold links of its own.
function dropFileLinks(t) {
  const opener = /\[\[(?:File|Image):/gi;
  let out = '';
  let pos = 0;
  let m;
  while ((m = opener.exec(t))) {
    let depth = 0;
    let end = -1;
    for (let i = m.index; i < t.length - 1; i++) {
      if (t.startsWith('[[', i)) { depth++; i++; }
      else if (t.startsWith(']]', i)) { depth--; i++; if (!depth) { end = i + 1; break; } }
    }
    if (end < 0) break;                 // never closed: leave the rest as it is
    out += t.slice(pos, m.index);
    pos = opener.lastIndex = end;
  }
  return out + t.slice(pos);
}

// Wiki markup → plain text.
function plainText(s) {
  let t = String(s || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<[^>]+>/g, '');
  // Innermost templates first: {{UNESCO}}, {{EUR|15}}, {{lang|pt|text}}…
  for (let k = 0; k < 5 && t.includes('{{'); k++) {
    t = t.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => {
      const [name, ...args] = inner.split('|').map(x => x.trim());
      const lower = name.toLowerCase();
      if (lower === 'unesco') return 'UNESCO World Heritage Site';
      if (/^[A-Z]{3}$/.test(name) && args.length) return `${args[0]} ${name}`;
      if (lower === 'lang' || lower === 'nowrap') return args[args.length - 1] || '';
      return '';
    });
  }
  return dropFileLinks(t)
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, wikiEntity)
    .replace(/\s*\(\s*\)/g, '')            // "Lisbon ()": what was in the brackets was a template
    .replace(/\s+/g, ' ')
    .trim();
}

// "&nbsp;", "&ndash;", "&#39;"… as the characters they stand for (the page escapes them again when shown).
const WIKI_ENTITIES = { nbsp: ' ', thinsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—', hellip: '…', deg: '°', euro: '€', pound: '£', times: '×', frac12: '½' };
function wikiEntity(whole, name) {
  if (name.charAt(0) !== '#') return WIKI_ENTITIES[name.toLowerCase()] ?? whole;
  const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : Number(name.slice(1));
  try { return code === 160 ? ' ' : String.fromCodePoint(code); } catch { return whole; }
}

// Splits plain text into sentences, losing nothing. A period doesn't end a sentence after an
// abbreviation ("the U.S. and Canada", "St. Louis", "e.g.") or before a small letter.
const ABBREVIATION = /(?:^|[\s(“"])(?:(?:[A-Za-z]\.){2,}|[A-HJ-Z]\.)$|\b(?:Mr|Mrs|Ms|Dr|St|Mt|Ft|Ave|Blvd|Rd|Jr|Sr|vs|No|approx|est|incl|ca|cf|Inc|Ltd|Co)\.$/;
function sentencesOf(text) {
  const out = [];
  const ends = /[.!?]+["”’')\]]*\s+/g;
  let start = 0;
  let m;
  while ((m = ends.exec(text))) {
    const end = m.index + m[0].length;
    if (/[a-z]/.test(text.charAt(end))) continue;
    const mark = m[0].trim();
    if (mark.charAt(0) === '.' && !/^\.\./.test(mark) && ABBREVIATION.test(text.slice(start, m.index + 1))) continue;
    out.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

// The first sentence or two, at most ~170 characters.
function shortBlurb(s) {
  let text = plainText(s);
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (text.length <= 170) return text;
  const sentences = sentencesOf(text);
  let out = '';
  for (const sen of sentences) {
    if ((out + sen).length > 170) break;
    out += sen;
  }
  return (out || text.slice(0, 165).replace(/\s+\S*$/, '') + '…').trim();
}

// The full description for the details sheet: whole sentences, at most ~700 characters.
function longBlurb(s) {
  let text = plainText(s);
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (text.length <= 700) return text;
  const sentences = sentencesOf(text);
  let out = '';
  for (const sen of sentences) {
    if ((out + sen).length > 700) break;
    out += sen;
  }
  return (out || text.slice(0, 695).replace(/\s+\S*$/, '') + '…').trim();
}

// Text of one top-level section, e.g. "Districts" (up to the next "== … ==").
function section(text, title) {
  const m = new RegExp(`^==\\s*${title}\\s*==\\s*$`, 'mi').exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  const next = /^==[^=].*==\s*$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

async function wikivoyagePages(titles) {
  const pages = [];
  for (let i = 0; i < titles.length; i += 4) {
    const data = await getJSON(WIKIVOYAGE, wm({
      action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: titles.slice(i, i + 4).join('|'),
    }));
    for (const p of data.query.pages || []) {
      const text = p.revisions && p.revisions[0].slots.main.content;
      if (text) pages.push({ title: p.title, text });
    }
  }
  return pages;
}

/* ---------- Which Wikivoyage page is this place? ---------- */

const wikidataIds = new Map();     // asked once per place (the guide and Essentials both need it)
function wikidataIdFor(place) {
  if (!place.osm) return Promise.resolve(null);
  if (!wikidataIds.has(place.osm)) {
    wikidataIds.set(place.osm, getJSON('https://nominatim.openstreetmap.org/lookup', { osm_ids: place.osm, format: 'jsonv2', extratags: '1' })
      .then(([hit]) => {
        // Anyone can edit OpenStreetMap: only a real Wikidata id ("Q64") is passed on.
        const id = hit && hit.extratags && hit.extratags.wikidata;
        return /^Q\d+$/.test(id) ? id : null;
      })
      .catch(() => { wikidataIds.delete(place.osm); return null; }));
  }
  return wikidataIds.get(place.osm);
}

async function wikivoyageTitle(place) {
  const qid = await wikidataIdFor(place);
  if (qid) {
    const data = await getJSON('https://www.wikidata.org/w/api.php', wm({ action: 'wbgetentities', ids: qid, props: 'sitelinks', sitefilter: 'enwikivoyage' }));
    const entity = data.entities && data.entities[qid];
    const link = entity && entity.sitelinks && entity.sitelinks.enwikivoyage;
    if (link) return link.title;
  }
  // No link: search by name, and only accept a page that is actually nearby.
  const data = await getJSON(WIKIVOYAGE, wm({
    action: 'query', generator: 'search', gsrsearch: place.name, gsrlimit: '5', prop: 'coordinates', colimit: 'max',
  }));
  const reach = place.kind === 'city' ? 40 : 300;
  const pages = (data.query ? data.query.pages : []).sort((a, b) => a.index - b.index);
  const near = pages.find(p => p.coordinates && miles(place, { lat: p.coordinates[0].lat, lng: p.coordinates[0].lon }) < reach);
  return near ? near.title : null;
}

/* ---------- Building a guide ---------- */

const LISTING_CAT = { see: 'sight', do: 'event', eat: 'food', drink: 'food', buy: 'shopping' };
const LISTING_RANK = { see: 3, do: 2, eat: 1.5, drink: 1.2, buy: 1, city: 3, vicinity: 2.5 };
const RAINY = /muse|galer|gallery|aquarium|cathedral|church|basilica|mosque|synagogue|temple|palace|palác|palais|palazzo|market|mercado|mall|theat|opera|cinema|library/i;

function guessMinutes(type, name) {
  if (type === 'city') return 480;
  if (type === 'vicinity') return 360;
  if (type === 'eat') return 75;
  if (type === 'drink') return 60;
  if (type === 'buy') return 45;
  if (type === 'do') return 120;
  if (/viewpoint|miradouro|lookout|belvedere|mirador|fountain|statue|square|praça|plaza|piazza|place /i.test(name)) return 30;
  if (/muse|galer|gallery|palace|castle|castelo|château|monaster|mosteiro|zoo|aquarium/i.test(name)) return 120;
  return 60;
}

// Pulls sights, food, drink, shopping (and destinations) out of Wikivoyage pages.
function readListings(page, area) {
  const out = [];
  const listingTypes = new Set(['see', 'do', 'eat', 'drink', 'buy', 'listing', 'marker']);
  for (const t of findTemplates(page.text, n => listingTypes.has(n))) {
    const p = t.params;
    let type = t.name === 'listing' ? (p.type || '').toLowerCase() : t.name;
    if (t.name === 'marker') {
      type = (p.type || '').toLowerCase();
      if (type !== 'city' && type !== 'vicinity') continue;
    }
    if (!LISTING_RANK[type]) continue;
    const name = plainText(p.name);
    if (!name || name.length > 80) continue;
    // A marker's description follows it on the same line: "{{marker|…}} – the northern capital".
    let content = p.content || '';
    if (t.name === 'marker') {
      content = page.text.slice(t.end, page.text.indexOf('\n', t.end) >>> 0).replace(/^\s*[–—-]\s*/, '');
    }
    const lat = parseFloat(p.lat), lng = parseFloat(p.long);
    out.push({
      type, name,
      alt: plainText(p.alt),
      blurb: shortBlurb(content),
      about: longBlurb(content),
      price: plainText(p.price),
      tip: plainText(p.directions).slice(0, 200),
      url: /^https?:\/\//i.test(p.url || '') ? p.url.trim().split(/\s/)[0].slice(0, 300) : '',
      hours: plainText(p.hours).slice(0, 200),
      wikidata: /^Q\d+$/.test(p.wikidata || '') ? p.wikidata : '',
      lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
      lng: Number.isFinite(lng) && Math.abs(lng) <= 180 ? lng : null,
      notable: (p.wikidata || p.wikipedia ? 1 : 0) + (p.image ? 0.5 : 0),
      image: plainText(p.image).replace(/^(File|Image):/i, '').trim(),
      area,
    });
  }
  return out;
}

// Titles of a big city's district pages, e.g. "Lisbon/Alfama".
function districtTitles(page) {
  const text = section(page.text, 'Districts');
  const prefix = page.title + '/';
  const titles = [];
  for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
    const title = m[1].trim().replace(/_/g, ' ');
    if (title.startsWith(prefix) && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

async function fillCoordinates(list) {
  const missing = [...new Set(list.filter(x => x.lat === null && x.wikidata).map(x => x.wikidata))];
  const found = new Map();
  for (let i = 0; i < missing.length; i += 50) {
    const data = await getJSON('https://www.wikidata.org/w/api.php', wm({
      action: 'query', prop: 'coordinates', colimit: 'max', titles: missing.slice(i, i + 50).join('|'),
    }));
    for (const p of data.query.pages || []) {
      if (p.coordinates) found.set(p.title, p.coordinates[0]);
    }
  }
  for (const x of list) {
    const c = x.lat === null && found.get(x.wikidata);
    if (c) { x.lat = c.lat; x.lng = c.lon; }
  }
}

// A Wikimedia Commons photo, by its file name, at a size fit for a phone.
const commonsPhoto = file => 'https://commons.wikimedia.org/wiki/Special:FilePath/'
  + encodeURIComponent(file.trim().replace(/ /g, '_')) + '?width=480';

// Places without a photo in the guide: Wikidata's main image for them, when it has one.
async function fillPhotos(list) {
  const ids = [...new Set(list.filter(x => !x.image && x.wikidata).map(x => x.wikidata))];
  const found = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const query = `SELECT ?item ?img WHERE { VALUES ?item { ${ids.slice(i, i + 150).map(q => 'wd:' + q).join(' ')} } ?item wdt:P18 ?img }`;
    const data = await getJSON('https://query.wikidata.org/sparql', { format: 'json', query });
    for (const b of data.results.bindings) {
      const id = b.item.value.split('/').pop();
      if (!found.has(id)) found.set(id, decodeURIComponent(b.img.value.split('/').pop()));
    }
  }
  for (const x of list) if (!x.image && found.has(x.wikidata)) x.image = found.get(x.wikidata);
}

// How well known each place is: the number of Wikipedia languages with an article about it
// (a burying ground has a handful, a great museum over fifty). Saved as "fame".
async function fillFame(list) {
  const ids = [...new Set(list.filter(x => x.wikidata).map(x => x.wikidata))];
  const found = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const query = `SELECT ?item ?n WHERE { VALUES ?item { ${ids.slice(i, i + 150).map(q => 'wd:' + q).join(' ')} } ?item wikibase:sitelinks ?n }`;
    const data = await getJSON('https://query.wikidata.org/sparql', { format: 'json', query });
    for (const b of data.results.bindings) found.set(b.item.value.split('/').pop(), Number(b.n.value) || 0);
  }
  for (const x of list) if (found.has(x.wikidata)) x.fame = found.get(x.wikidata);
}

// Groups places into a few neighborhoods (for "Ideas for a day around …").
function clusterAreas(places, k) {
  let centers = places.slice(0, k).map(p => ({ lat: p.lat, lng: p.lng }));
  let groups = [];
  for (let round = 0; round < 12; round++) {
    groups = centers.map(() => []);
    for (const p of places) {
      let best = 0;
      centers.forEach((c, i) => { if (miles(c, p) < miles(centers[best], p)) best = i; });
      groups[best].push(p);
    }
    centers = groups.map((g, i) => (g.length ? { lat: avg(g.map(p => p.lat)), lng: avg(g.map(p => p.lng)) } : centers[i]));
  }
  return groups.filter(g => g.length);
}

// Names each group after its best-known sight ("Around Grote Markt"). A small town
// that's walkable end to end isn't split up at all.
function nameAreas(places, maxGroups) {
  const center = { lat: avg(places.map(p => p.lat)), lng: avg(places.map(p => p.lng)) };
  const spread = places.map(p => miles(center, p)).sort((a, b) => a - b)[Math.floor(places.length * 0.8)];
  if (!(spread > 1.5)) {
    places.forEach(p => { p.area = ''; });
    return { dayAreas: [], dayTitles: {} };
  }
  const groups = clusterAreas(places, Math.max(2, Math.min(maxGroups, Math.round(places.length / 8))));
  const dayTitles = {};
  for (const g of groups) {
    const name = (g.find(p => p.cat === 'sight') || g[0]).name.replace(/\s*\([^)]*\)/g, '');
    const label = `Around ${name}`;
    dayTitles[label] = `Ideas for a day around ${name}`;
    g.forEach(p => { p.area = label; });
  }
  return { dayAreas: groups.sort((a, b) => b.length - a.length).map(g => g[0].area), dayTitles };
}

async function wikivoyageGuide(place) {
  const title = await wikivoyageTitle(place);
  if (!title) return null;
  const [main] = await wikivoyagePages([title]);
  if (!main) return null;

  let list = readListings(main, '');
  let districts = districtTitles(main).slice(0, 12);
  let pages = [];
  if (districts.length) {
    pages = await wikivoyagePages(districts);
  } else {
    // A huge city (New York): its districts are pages of their own ("Manhattan"), split up again
    // ("Manhattan/Midtown"). They are the names in the page's list of regions, whatever its heading ("Boroughs").
    const linked = [...new Set([...main.text.matchAll(/region\d+name\s*=\s*\[\[([^\]|#:]+)/g)].map(m => m[1].trim().replace(/_/g, ' ')))];
    const parts = await wikivoyagePages(linked.slice(0, 8));
    const inner = parts.flatMap(p => districtTitles(p).slice(0, 14)).slice(0, 36);
    pages = [...parts, ...(await wikivoyagePages(inner))];
    districts = pages.map(p => p.title);
  }
  for (const page of pages) list.push(...readListings(page, page.title.slice(page.title.lastIndexOf('/') + 1)));
  await fillCoordinates(list);
  await fillPhotos(list).catch(() => {});      // photos are a bonus: the guide works without them
  await fillPhotosByName(list).catch(() => {});
  await fillFame(list).catch(() => {});

  // Keep places with a map position that really are in (or near) this place.
  const reach = place.kind === 'city' ? 30 : place.kind === 'region' ? 400 : 1500;
  list = bestListings(list.filter(x => x.lat !== null && miles(place, x) < reach), 160);
  if (list.length < 5) return null;

  const isDestinations = list.filter(x => x.type === 'city' || x.type === 'vicinity').length >= list.length * 0.6;
  const places = listingPlaces(list, place.name);

  // Neighborhoods for empty days: the city's districts, or groups of nearby places.
  let dayAreas = [];
  let dayTitles = {};
  if (!isDestinations) {
    if (districts.length) {
      // Main-page highlights go to the district they're closest to.
      const centers = new Map();
      for (const a of new Set(places.map(p => p.area).filter(Boolean))) {
        const inArea = places.filter(p => p.area === a);
        centers.set(a, { lat: avg(inArea.map(p => p.lat)), lng: avg(inArea.map(p => p.lng)) });
      }
      for (const p of places.filter(p => !p.area && centers.size)) {
        p.area = [...centers].sort((x, y) => miles(x[1], p) - miles(y[1], p))[0][0];
      }
      const score = a => places.filter(p => p.area === a && p.cat === 'sight').length;
      dayAreas = [...centers.keys()].sort((a, b) => score(b) - score(a));
    } else {
      ({ dayAreas, dayTitles } = nameAreas(places, 6));
    }
  }

  return {
    city: place.name,
    source: 'Wikivoyage',
    sourceUrl: 'https://en.wikivoyage.org/wiki/' + encodeURIComponent(main.title.replace(/ /g, '_')),
    kind: isDestinations ? 'destinations' : 'city',
    dayAreas,
    dayTitles,
    places,
  };
}

// The best-known listings, each once: the same place can be on a city's page and on its district's page.
function bestListings(list, max) {
  const byKey = new Map();
  for (const x of list) {
    const key = x.wikidata || norm(x.name);
    const had = byKey.get(key);
    if (!had) byKey.set(key, x);
    else {
      if (!had.area) had.area = x.area;
      if (!had.hours) had.hours = x.hours;
      if (!had.image) had.image = x.image;
      if (x.blurb.length > had.blurb.length) had.blurb = x.blurb;
      if (x.about.length > had.about.length) had.about = x.about;
      had.notable = Math.max(had.notable, x.notable) + 0.5;
    }
  }
  // The kind of listing first, then how well known it is (worth up to two points).
  const rank = x => LISTING_RANK[x.type] + x.notable + Math.min(2, (x.fame || 0) / 25);
  return [...byKey.values()]
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, max);
}

// Listings → the guide's places. inName: the city or country, for a destination without a description.
function listingPlaces(list, inName) {
  // Each place needs its own id: two names can come out the same once shortened to plain letters.
  const usedIds = new Set();
  const placeId = (x) => {
    const base = 'wv-' + (x.wikidata || norm(x.name).replace(/[^a-z0-9]+/g, '-')).slice(0, 50);
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);
    return id;
  };
  return list.map(x => ({
    id: placeId(x),
    name: x.name,
    aliases: x.alt && x.alt.length < 50 ? [x.alt] : [],
    cat: LISTING_CAT[x.type] || 'sight',
    area: x.area || (x.type === 'city' ? 'City' : x.type === 'vicinity' ? 'Destination' : ''),
    lat: Math.round(x.lat * 1e5) / 1e5,
    lng: Math.round(x.lng * 1e5) / 1e5,
    mins: guessMinutes(x.type, x.name),
    when: x.type === 'drink' ? 'evening' : 'any',
    tags: [
      /^\s*free\b/i.test(x.price) ? 'free' : '',
      x.type !== 'city' && RAINY.test(x.name) ? 'rainy' : '',
    ].filter(Boolean),
    blurb: x.blurb || (x.type === 'city' ? `A destination in ${inName}.` : ''),
    ...(x.image ? { photo: commonsPhoto(x.image) } : x.photoUrl ? { photo: x.photoUrl } : {}),
    ...(x.hours ? { hours: x.hours } : {}),
    ...(x.about.length > x.blurb.length ? { about: x.about } : {}),
    ...(x.price ? { price: x.price.slice(0, 200) } : {}),
    ...(x.tip ? { tip: x.tip } : {}),
    ...(x.url ? { url: x.url } : {}),
    ...(x.fame ? { fame: x.fame } : {}),
  }));
}

// Destinations (cities, parks) usually come without a photo or a Wikidata id: the picture of the
// Wikipedia article with the same name is used.
async function fillPhotosByName(list) {
  const names = [...new Set(list.filter(x => !x.image && (x.type === 'city' || x.type === 'vicinity')).map(x => x.name))];
  const found = new Map();
  for (let i = 0; i < names.length; i += 40) {
    const data = await getJSON('https://en.wikipedia.org/w/api.php', wm({
      action: 'query', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '480', pilimit: 'max', redirects: '1', titles: names.slice(i, i + 40).join('|'),
    }));
    // The answer names the article, which may differ from what was asked ("NYC" → "New York City").
    const renamed = rows => new Map((rows || []).map(r => [r.from, r.to]));
    const normalized = renamed(data.query.normalized), redirects = renamed(data.query.redirects);
    const photos = new Map((data.query.pages || []).filter(p => p.thumbnail).map(p => [p.title, p.thumbnail.source]));
    for (const name of names.slice(i, i + 40)) {
      const title = normalized.get(name) || name;
      const photo = photos.get(redirects.get(title) || title);
      if (photo) found.set(name, photo);
    }
  }
  for (const x of list) if (!x.image && found.has(x.name)) x.photoUrl = found.get(x.name);
}

/* ---------- Guides for where the plans are ----------
   A trip to a country or region gets a guide of destinations, which says nothing about the streets
   around its plans. So each group of plans also gets a guide of what is near it, read from the
   Wikivoyage pages closest to it (for New York: the pages of the neighborhoods around the plans). */

const NEAR_REACH = 6;       // miles around a group of plans

async function nearbyGuide(center) {
  const data = await getJSON(WIKIVOYAGE, wm({ action: 'query', list: 'geosearch', gscoord: `${center.lat}|${center.lng}`, gsradius: '10000', gslimit: '12' }));
  const titles = (data.query ? data.query.geosearch : []).map(p => p.title);
  if (!titles.length) return null;
  let list = [];
  // A district page ("Manhattan/Chinatown") names its area; a town's own page doesn't need one.
  for (const page of await wikivoyagePages(titles)) list.push(...readListings(page, page.title.includes('/') ? page.title.split('/').pop() : ''));
  list = list.filter(x => x.type !== 'city' && x.type !== 'vicinity');
  await fillCoordinates(list);
  await fillPhotos(list).catch(() => {});
  await fillFame(list).catch(() => {});
  list = bestListings(list.filter(x => x.lat !== null && miles(center, x) < NEAR_REACH), 120);
  if (list.length < 3) return null;
  return {
    city: titles[0].split('/')[0].replace(/\s*\([^)]*\)$/, ''),
    source: 'Wikivoyage',
    sourceUrl: 'https://en.wikivoyage.org/wiki/' + encodeURIComponent(titles[0].replace(/ /g, '_')),
    kind: 'near',
    center: { lat: Math.round(center.lat * 1e4) / 1e4, lng: Math.round(center.lng * 1e4) / 1e4 },
    dayAreas: [],
    dayTitles: {},
    places: listingPlaces(list, ''),
  };
}

// The groups of plans that need their own guide: away from the trip's own city (or anywhere, for
// a country or region), with at least two plans on the map. Biggest first, five at most.
function planGroups(trip) {
  const groups = [];
  for (const it of trip.items) {
    if (typeof it.lat !== 'number' || typeof it.lng !== 'number') continue;
    const g = groups.find(x => miles(x, it) < NEAR_REACH);
    if (g) { g.lat = (g.lat * g.n + it.lat) / (g.n + 1); g.lng = (g.lng * g.n + it.lng) / (g.n + 1); g.n++; }
    else groups.push({ lat: it.lat, lng: it.lng, n: 1 });
  }
  const city = trip.place && trip.place.kind === 'city' ? trip.place : null;
  return groups.filter(g => g.n >= 2 && (!city || miles(city, g) > 15)).sort((a, b) => b.n - a.n).slice(0, 5);
}

// The saved guides near the trip's plans. Starts fetching the missing ones.
function nearbyGuides(trip) {
  const out = [];
  for (const g of planGroups(trip)) {
    // A guide fetched for (almost) the same spot is reused: the middle of a group moves as plans are added.
    const key = Object.keys(savedGuides).find(k => savedGuides[k].kind === 'near' && miles(savedGuides[k].center, g) < 2.5);
    if (key) {
      if (!readyGuides.has(key)) {
        readyGuides.set(key, prepGuide({ ...savedGuides[key], id: key }));
        readyGuides.get(key).places.forEach((p) => { p.local = true; });      // not one of the trip's destinations
      }
      out.push(readyGuides.get(key));
      if (savedGuides[key].v !== GUIDE_VERSION) loadNearbyGuide(g, key);
    } else {
      loadNearbyGuide(g, `near:${g.lat.toFixed(3)},${g.lng.toFixed(3)}`);
    }
  }
  return out;
}

function loadNearbyGuide(center, key) {
  if (guideStatus.has(key) || !navigator.onLine) return;
  guideStatus.set(key, 'loading');
  nearbyGuide(center).then((guide) => {
    if (!guide) throw new Error('nothing nearby');
    storeGuide(key, guide);
    guideStatus.delete(key);
    readyGuides.delete(key);
    renderSoon();
  }).catch((e) => {
    console.warn('No guide near', key, e);
    guideStatus.set(key, 'failed');
  });
}

// The trip's guide with the guides near its plans added: one list of places for suggestions,
// opening hours, photos and details. Built once per set of guides.
const joinedGuides = new Map();
function withNearby(trip, main) {
  const near = nearbyGuides(trip);
  if (!near.length) return main;
  const key = [main ? main.id + (main.saved || '') : '-', ...near.map(g => g.id + g.saved)].join('|');
  if (!joinedGuides.has(key)) {
    joinedGuides.clear();
    const seen = new Set();
    const places = [...near.flatMap(g => g.places), ...(main ? main.places : [])].filter(p => !seen.has(p.id) && seen.add(p.id));
    joinedGuides.set(key, main
      ? { ...main, places, joined: true }
      : { ...near[0], id: key, kind: 'city', places, joined: true });
  }
  return joinedGuides.get(key);
}

// Fallback: the most-read Wikipedia articles about places around the center.
const NOT_A_SIGHT = /station|street|road|avenue|school|university|college|hospital|district|neighbo|parish|municipal|village|town in|city in|electoral|constituency|company|railway|metro|airport|highway|motorway|hotel|office|headquarters|building in .* used/i;

async function wikipediaGuide(place) {
  const data = await getJSON('https://en.wikipedia.org/w/api.php', wm({
    action: 'query', generator: 'geosearch', ggscoord: `${place.lat}|${place.lng}`, ggsradius: '10000', ggslimit: '80',
    prop: 'coordinates|description|pageviews|pageimages', colimit: 'max', pvipdays: '30', piprop: 'thumbnail', pithumbsize: '480', pilimit: 'max',
  }));
  const pages = (data.query ? data.query.pages : [])
    .filter(p => p.coordinates && p.description && !NOT_A_SIGHT.test(p.description) && norm(p.title) !== norm(place.name))
    .map(p => ({ p, views: Object.values(p.pageviews || {}).reduce((s, v) => s + (v || 0), 0) }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 40);
  if (pages.length < 3) return null;
  const places = pages.map(({ p }) => {
    const d = p.description;
    const cat = /restaurant|café|cafe|bakery|brewery|bar\b|pub\b/i.test(d) ? 'food'
      : /theat|stadium|arena|concert|opera|venue/i.test(d) ? 'event'
      : /market|mall|shopping|store|shop\b/i.test(d) ? 'shopping' : 'sight';
    return {
      id: 'wp-' + p.pageid,
      name: p.title.replace(/\s*\([^)]*\)$/, ''),
      aliases: [],
      cat,
      area: '',
      lat: Math.round(p.coordinates[0].lat * 1e5) / 1e5,
      lng: Math.round(p.coordinates[0].lon * 1e5) / 1e5,
      mins: guessMinutes(cat === 'food' ? 'eat' : 'see', p.title),
      when: 'any',
      tags: RAINY.test(p.title + ' ' + d) ? ['rainy'] : [],
      blurb: d.charAt(0).toUpperCase() + d.slice(1) + '.',
      ...(p.thumbnail ? { photo: p.thumbnail.source } : {}),
    };
  });
  const { dayAreas, dayTitles } = nameAreas(places, 4);
  return {
    city: place.name,
    source: 'Wikipedia',
    sourceUrl: '',
    kind: 'city',
    dayAreas,
    dayTitles,
    places,
  };
}

/* ---------- Saved guides & loading ---------- */

function readSavedGuides() {
  try { return JSON.parse(localStorage.getItem(GUIDES_KEY)) || {}; } catch { return {}; }
}
const savedGuides = readSavedGuides();
const readyGuides = new Map();    // place key → guide ready to use (with name patterns)
const guideStatus = new Map();    // place key → 'loading' | 'failed'

const placeKey = place => place.osm || `${place.lat},${place.lng}`;

function storeGuide(key, guide) {
  savedGuides[key] = { ...guide, v: GUIDE_VERSION, saved: Date.now() };
  const keys = Object.keys(savedGuides).sort((a, b) => savedGuides[b].saved - savedGuides[a].saved);
  for (const old of keys.slice(MAX_SAVED_GUIDES)) delete savedGuides[old];
  for (;;) {
    try {
      localStorage.setItem(GUIDES_KEY, JSON.stringify(savedGuides));
      return;
    } catch {
      // Storage full: drop the oldest saved guide and try again.
      const rest = Object.keys(savedGuides).filter(k => k !== key);
      if (!rest.length) return;
      delete savedGuides[rest.sort((a, b) => savedGuides[a].saved - savedGuides[b].saved)[0]];
    }
  }
}

// The guide for a trip's place, if it's been fetched. Starts fetching it if not.
function placeGuide(trip) {
  const place = trip.place;
  if (!place) return null;
  const key = placeKey(place);
  if (readyGuides.has(key)) return readyGuides.get(key);
  if (savedGuides[key]) {
    const guide = prepGuide({ ...savedGuides[key], id: key });
    readyGuides.set(key, guide);
    // Saved by an older version: keep using it, and quietly fetch the newer kind.
    if (savedGuides[key].v !== GUIDE_VERSION) loadGuide(place, { quiet: true });
    return guide;
  }
  loadGuide(place);
  return null;
}

function loadGuide(place, { retry = false, quiet = false } = {}) {
  const key = placeKey(place);
  const status = guideStatus.get(key);
  if (status === 'loading' || (status === 'failed' && !retry) || !navigator.onLine) return;
  guideStatus.set(key, 'loading');
  (async () => {
    try {
      const guide = (await wikivoyageGuide(place).catch(() => null)) || (await wikipediaGuide(place));
      if (!guide) throw new Error('nothing found');
      storeGuide(key, guide);
      guideStatus.delete(key);
      onGuideReady(place, guide, quiet);
    } catch (e) {
      console.warn('No guide for', place.label, e);
      guideStatus.set(key, 'failed');
      if (!quiet) render();
    }
  })();
  // Called while the screen is being drawn: redraw (with "Finding ideas…") right after.
  if (!quiet) setTimeout(render, 0);
}

function guideState(trip) {
  return trip.place ? guideStatus.get(placeKey(trip.place)) || null : null;
}
