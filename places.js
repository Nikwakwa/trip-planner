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
const MAX_SAVED_GUIDES = 10;
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
  const within = [kind === 'city' && p.country === 'United States' ? p.state : '', kind !== 'country' ? p.country : '']
    .filter(v => v && v !== p.name);
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

async function searchPlaces(q, signal) {
  const params = new URLSearchParams({ q, limit: '8', lang: 'en' });
  params.append('osm_tag', 'place');
  params.append('osm_tag', 'boundary:administrative');
  const res = await fetch('https://photon.komoot.io/api/?' + params, { signal });
  if (!res.ok) throw new Error('place search failed');
  const data = await res.json();
  const seen = new Set();
  return data.features
    .filter(f => f.properties.name && !SKIP_PLACE_TYPES.has(f.properties.osm_value))
    .map(placeFromPhoton)
    .filter(p => !seen.has(p.label) && seen.add(p.label))
    .slice(0, 5);
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
  return t
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The first sentence or two, at most ~170 characters.
function shortBlurb(s) {
  let text = plainText(s);
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (text.length <= 170) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
  let out = '';
  for (const sen of sentences) {
    if ((out + sen).length > 170) break;
    out += sen;
  }
  return (out || text.slice(0, 165).replace(/\s+\S*$/, '') + '…').trim();
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

async function wikidataIdFor(place) {
  if (!place.osm) return null;
  try {
    const [hit] = await getJSON('https://nominatim.openstreetmap.org/lookup', { osm_ids: place.osm, format: 'jsonv2', extratags: '1' });
    return (hit && hit.extratags && hit.extratags.wikidata) || null;
  } catch { return null; }
}

async function wikivoyageTitle(place) {
  const qid = await wikidataIdFor(place);
  if (qid) {
    const data = await getJSON('https://www.wikidata.org/w/api.php', wm({ action: 'wbgetentities', ids: qid, props: 'sitelinks', sitefilter: 'enwikivoyage' }));
    const link = data.entities && data.entities[qid] && data.entities[qid].sitelinks.enwikivoyage;
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
      price: plainText(p.price),
      wikidata: /^Q\d+$/.test(p.wikidata || '') ? p.wikidata : '',
      lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
      lng: Number.isFinite(lng) && Math.abs(lng) <= 180 ? lng : null,
      notable: (p.wikidata || p.wikipedia ? 1 : 0) + (p.image ? 0.5 : 0),
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
  const districts = districtTitles(main).slice(0, 12);
  const areaName = t => t.slice(main.title.length + 1);
  if (districts.length) {
    for (const page of await wikivoyagePages(districts)) list.push(...readListings(page, areaName(page.title)));
  }
  await fillCoordinates(list);

  // Keep places with a map position that really are in (or near) this place.
  const reach = place.kind === 'city' ? 30 : place.kind === 'region' ? 400 : 1500;
  list = list.filter(x => x.lat !== null && miles(place, x) < reach);

  // The same place can be listed on the main page and on its district page.
  const byKey = new Map();
  for (const x of list) {
    const key = x.wikidata || norm(x.name);
    const had = byKey.get(key);
    if (!had) byKey.set(key, x);
    else {
      if (!had.area) had.area = x.area;
      if (x.blurb.length > had.blurb.length) had.blurb = x.blurb;
      had.notable = Math.max(had.notable, x.notable) + 0.5;
    }
  }
  list = [...byKey.values()]
    .sort((a, b) => (LISTING_RANK[b.type] + b.notable) - (LISTING_RANK[a.type] + a.notable))
    .slice(0, 160);
  if (list.length < 5) return null;

  const isDestinations = list.filter(x => x.type === 'city' || x.type === 'vicinity').length >= list.length * 0.6;
  const places = list.map(x => ({
    id: 'wv-' + (x.wikidata || norm(x.name).replace(/[^a-z0-9]+/g, '-')).slice(0, 50),
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
    blurb: x.blurb || (x.type === 'city' ? `A destination in ${place.name}.` : ''),
  }));

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

// Fallback: the most-read Wikipedia articles about places around the center.
const NOT_A_SIGHT = /station|street|road|avenue|school|university|college|hospital|district|neighbo|parish|municipal|village|town in|city in|electoral|constituency|company|railway|metro|airport|highway|motorway|hotel|office|headquarters|building in .* used/i;

async function wikipediaGuide(place) {
  const data = await getJSON('https://en.wikipedia.org/w/api.php', wm({
    action: 'query', generator: 'geosearch', ggscoord: `${place.lat}|${place.lng}`, ggsradius: '10000', ggslimit: '80',
    prop: 'coordinates|description|pageviews', colimit: 'max', pvipdays: '30',
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
  savedGuides[key] = { ...guide, saved: Date.now() };
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
    return guide;
  }
  loadGuide(place);
  return null;
}

function loadGuide(place, { retry = false } = {}) {
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
      onGuideReady(place, guide);
    } catch (e) {
      console.warn('No guide for', place.label, e);
      guideStatus.set(key, 'failed');
      render();
    }
  })();
  // Called while the screen is being drawn: redraw (with "Finding ideas…") right after.
  setTimeout(render, 0);
}

function guideState(trip) {
  return trip.place ? guideStatus.get(placeKey(trip.place)) || null : null;
}
