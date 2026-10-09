'use strict';

/* =========================================================
   AI assistant: chat about the trip, and let it draft changes.
   - Built in: Google's Gemini, through the Firebase project (Firebase AI Logic,
     free tier, no billing). Gemini 3.8 Flash first; when its free daily
     allowance is used up, Gemini 3.5 Flash-Lite until the next day.
     Firebase App Check (reCAPTCHA Enterprise) proves requests come from this app.
   - Or copy the request to another AI app (a chatbot), and paste the answer back.
   Nothing changes until "Apply" is tapped on the assistant's proposal, and Apply can be undone.
   Functions here use helpers from app.js, which is loaded after this file.
   ========================================================= */

const AI_KEY = 'tripPlanner.assistant';
const AI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
];
const AI_HISTORY = 12;      // messages sent along as the conversation so far
const AI_KEEP = 40;         // messages kept per trip on this phone

const ai = {
  saved: (() => { try { return JSON.parse(localStorage.getItem(AI_KEY)) || {}; } catch { return {}; } })(),
  busy: false,
  error: '',
  appCheck: null,           // promise of the App Check instance
  paste: false,             // the "use another AI app" panel is open
};
ai.saved.chats = ai.saved.chats || {};

function saveAI() {
  for (const id of Object.keys(ai.saved.chats)) {
    if (!state.trips.some(t => t.id === id)) delete ai.saved.chats[id];
    else {
      const list = ai.saved.chats[id];           // trimmed in place: open chats keep using the same list
      if (list.length > AI_KEEP) list.splice(0, list.length - AI_KEEP);
    }
  }
  try { localStorage.setItem(AI_KEY, JSON.stringify(ai.saved)); } catch { /* storage full */ }
}
const chatOf = trip => (ai.saved.chats[trip.id] = ai.saved.chats[trip.id] || []);
const aiReady = () => !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);

/* ---------- What the assistant knows about the trip ---------- */

function tripContext(trip) {
  const guide = guideFor(trip);
  const days = tripDays(trip);
  const lines = [];
  lines.push(`Today is ${todayISO()} (${fmtDay(todayISO(), { weekday: 'long' })}).`);
  lines.push(`Trip: "${trip.name}"${trip.place ? ` — ${trip.place.label} (${trip.place.kind})` : ''}.`);
  lines.push(trip.start && trip.end
    ? `Dates: ${trip.start} to ${trip.end}. Days: ${days.map(d => `${d} (${fmtDay(d, { weekday: 'short' })})`).join(', ')}.`
    : 'The trip has no dates yet. Plans can still be saved as ideas (date "").');
  const own = Object.entries(trip.dayTravel || {}).map(([d, m]) => `${d}: ${TRAVEL_MODES[m].label}`);
  const base = baseFor(trip, null);
  if (base) lines.push(`Home base: "stay" plans with an address are where days start and end (now: ${base.item.title}, ${base.item.place}). Prefer places near it.`);
  const stays = trip.items.filter(i => startsStay(i, trip, guide));
  if (stays.length > 1) {
    lines.push(`Stays: ${stays.map(i => `${i.title} from ${i.date}${stayUntil(i) ? ` to ${i.until} (check-out day)` : ''}`).join('; ')}. The day a stay begins starts at the stay before it (check out) and ends at the new one (check in).`);
  }
  lines.push(`Getting around: ${TRAVEL_MODES[trip.travel || 'transit'].label} (short distances on foot)`
    + `${own.length ? `, except ${own.join('; ')}` : ''}. Plan travel times for that.`);
  lines.push(`Use ${imperial() ? 'miles and °F' : 'kilometres and °C'} when you mention distances or temperatures.`);

  const plans = trip.items.map((i) => {
    const note = hoursNote(i, guide);
    return {
      id: i.id, title: i.title, category: i.category, date: i.date, time: i.time, place: i.place,
      ...(i.notes ? { notes: i.notes.slice(0, 200) } : {}),
      ...(stayUntil(i) ? { check_out: i.until } : {}),
      ...(i.done ? { done: true } : {}),
      ...(note ? { hours: note.text } : {}),
    };
  });
  lines.push(`Plans and ideas (an empty date means an idea, not scheduled yet):\n${JSON.stringify(plans)}`);

  const weatherDays = days.map((d) => {
    const w = dayWeather(trip, d);
    return w && `${d}: ${w.text}, ${temp(w.lo)}–${temp(w.hi)}, rain ${w.rain}%`;
  }).filter(Boolean);
  if (weatherDays.length) lines.push(`Forecast:\n${weatherDays.join('\n')}`);

  if (guide) {
    const places = guide.places.slice(0, 90).map(p => ({
      id: p.id, name: p.name, cat: p.cat, area: p.area || undefined, mins: p.mins,
      when: p.when !== 'any' ? p.when : undefined, tags: p.tags.length ? p.tags : undefined,
      hours: p.hours || undefined, about: (p.about || p.blurb || '').slice(0, 140),
    }));
    lines.push(`Travel guide for ${guide.city} (use guide_id when adding one of these):\n${JSON.stringify(places)}`);
  }
  return lines.join('\n\n');
}

const AI_RULES = `You are the trip-planning assistant inside a trip planner app. Help plan the trip described below.

How to answer:
- Answer with JSON only:
  {"reply": "...", "add": [...], "update": [...], "remove": [...], "dates": {"start": "", "end": ""}}
- "reply" is short plain text (no markdown), in the user's language. Say what you suggest and why, briefly.
  When it makes several points, put each one in its own short paragraph, with an empty line (\\n\\n) between them.
- The other fields are changes to the trip. Leave them empty for questions or advice. The user sees your
  changes as a preview and decides whether to apply them, so only change what the user asked for.
- "add": new plans. Give every field:
  {"guide_id": id of the travel guide place, or "" if it isn't one,
   "title": ..., "category": ..., "date": "YYYY-MM-DD", or "" to save it as an idea without a day,
   "time": "" unless the user gave a time (then "HH:MM", 24-hour), "place": address or place name, "notes": "" or a short tip}
- "update": changed plans. Give the plan's "id" and all its fields with their new values
  (title, category, date, time, place, notes), copying the fields that don't change exactly as they are.
- "remove": plans to delete, as {"id": ...}.
- "dates": new first and last day of the trip, or "" for both to leave them as they are.
- category is one of: sight, food, event, shopping, transport, stay, other.
- When the user asks to plan a day, give each plan that date: plans on a day, not ideas.
  Only use date "" when the user asks for ideas to keep for later.
- Times: never make up a time. Set "time" only when the user gives that time, asks you to set times
  ("with times", "a schedule"), or a booking shows it. Otherwise "time" is "", also for a whole day you plan:
  list the plans in the order to do them, and say in "reply" when something is best early or late.
  Keep the time a plan already has, unless the user asks to change or remove it ("time": "" removes it).
- For a place from the travel guide, set its guide_id and use its name as the title.
- Plan realistic days: respect opening hours and visit lengths (mins), group nearby places (same area),
  leave time for meals and travel, and prefer indoor places (tag "rainy") on rainy days.
- Never remove or move plans the user didn't ask about. Don't add a place that is already in the plans.
- Bookings: when the user pastes a confirmation (hotel, flight, train, bus, car rental, restaurant, tickets, tour),
  turn it into plans, with the booking reference in notes:
  a hotel or apartment: a "stay" plan on the check-in day at the check-in time, place = its full address,
  and a "stay" plan titled "Check out: <name>" on the check-out day at the check-out time;
  a flight, train or bus: a "transport" plan at departure time, title like "Flight TP 1234 to Lisbon",
  place = the departure airport or station, notes = route, seat, terminal and reference;
  a car rental: "transport" plans for pick-up and drop-off; a restaurant, show or tour: a plan at its time.
  If the trip has no dates yet and the bookings show them, set "dates" too.
  Only use what the confirmation says; never invent times or numbers.`;

const AI_PLAN_FIELDS = ['title', 'category', 'date', 'time', 'place', 'notes'];
const aiSchema = () => {
  const text = { type: 'string' };
  const plan = {
    title: text, category: { type: 'string', enum: Object.keys(CATEGORIES) },
    date: text, time: text, place: text, notes: text,
  };
  return {
    type: 'object',
    properties: {
      reply: text,
      add: { type: 'array', items: { type: 'object', properties: { guide_id: text, ...plan }, required: ['guide_id', ...AI_PLAN_FIELDS] } },
      update: { type: 'array', items: { type: 'object', properties: { id: text, ...plan }, required: ['id', ...AI_PLAN_FIELDS] } },
      remove: { type: 'array', items: { type: 'object', properties: { id: text }, required: ['id'] } },
      dates: { type: 'object', properties: { start: text, end: text }, required: ['start', 'end'] },
    },
    required: ['reply', 'add', 'update', 'remove', 'dates'],
  };
};

// The app keeps one list of changes; the answer format groups them by kind.
function answerOf(text, changes) {
  const pick = (c, keys) => Object.fromEntries(keys.map(k => [k, c[k] ?? '']));
  const dates = changes.find(c => c.action === 'set_dates');
  return {
    reply: text,
    add: changes.filter(c => c.action === 'add').map(c => pick(c, ['guide_id', ...AI_PLAN_FIELDS])),
    update: changes.filter(c => c.action === 'update').map(c => pick(c, ['id', ...AI_PLAN_FIELDS])),
    remove: changes.filter(c => c.action === 'delete').map(c => ({ id: c.id })),
    dates: { start: dates ? dates.start : '', end: dates ? dates.end : '' },
  };
}

/* ---------- Talking to Gemini (Firebase AI Logic) ---------- */

// App Check token: proves the request comes from this app, not someone copying its settings.
function appCheck() {
  if (!window.RECAPTCHA_SITE_KEY) return Promise.resolve(null);
  ai.appCheck = ai.appCheck || (async () => {
    await loadFirebase();
    // On a computer during development, a "debug token" stands in (it's printed in the console).
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    await loadScript('vendor/firebase/firebase-app-check-compat.js');
    const check = firebase.appCheck();
    check.activate(new firebase.appCheck.ReCaptchaEnterpriseProvider(window.RECAPTCHA_SITE_KEY), true);
    return check;
  })().catch((e) => { ai.appCheck = null; throw e; });
  return ai.appCheck;
}

class AIError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

async function callGemini(model, body) {
  const c = window.FIREBASE_CONFIG;
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': c.apiKey };
  try {
    const check = await appCheck();
    if (check) headers['X-Firebase-AppCheck'] = (await check.getToken(false)).token;
  } catch (e) {
    throw new AIError(navigator.onLine ? 'appcheck' : 'other', e.message);
  }
  const res = await fetch(`https://firebasevertexai.googleapis.com/v1beta/projects/${c.projectId}/models/${model}:generateContent`,
    { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
    if (res.status === 429) throw new AIError(/day/i.test(msg) ? 'daily' : 'busy', msg);
    // "High demand" and other hiccups on Google's side: the lighter model usually still answers.
    if (res.status >= 500 || /high demand|overloaded|UNAVAILABLE/i.test(msg)) throw new AIError('busy', msg);
    if (/SERVICE_DISABLED|has not been used|not enabled/i.test(msg)) throw new AIError('setup', msg);
    if (/app ?check/i.test(msg) || res.status === 401) throw new AIError('appcheck', msg);
    throw new AIError('other', msg);
  }
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts.filter(p => !p.thought && p.text).map(p => p.text).join('');
  if (!text) throw new AIError('other', 'empty answer');
  return text;
}

// Gemini 3.8 Flash, or Flash-Lite once the day's free allowance is used up.
async function askGemini(trip, chat) {
  // The conversation so far has to start with something the user said.
  const recent = chat.slice(-AI_HISTORY);
  while (recent.length > 1 && recent[0].role !== 'user') recent.shift();
  const contents = recent.map(m => ({
    role: m.role,
    parts: [{ text: m.role === 'model' ? JSON.stringify(answerOf(m.text, m.changes || [])) + (m.status ? `\n(The user ${m.status === 'applied' ? 'applied' : 'did not apply'} these changes.)` : '') : m.text }],
  }));
  const body = {
    systemInstruction: { parts: [{ text: `${AI_RULES}\n\n${tripContext(trip)}` }] },
    contents,
    generationConfig: { responseMimeType: 'application/json', responseSchema: aiSchema(), temperature: 0.5 },
  };
  let first = ai.saved.liteDay === todayISO() ? 1 : 0;
  for (let k = first; k < AI_MODELS.length; k++) {
    try {
      const text = await callGemini(AI_MODELS[k].id, body);
      return { ...parseAnswer(text), model: AI_MODELS[k].label };
    } catch (e) {
      if (e.kind === 'daily' && k === 0) { ai.saved.liteDay = todayISO(); saveAI(); continue; }
      if (e.kind === 'busy' && k === 0) continue;
      throw e;
    }
  }
  throw new AIError('daily', 'all models used up');
}

// The answer's JSON, also when it comes wrapped in text or a ```json block (pasted from another app).
function parseAnswer(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  let raw = fenced ? fenced[1] : text;
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a < 0 || b < a) throw new AIError('format', 'no JSON found');
  raw = raw.slice(a, b + 1);
  let data;
  try { data = JSON.parse(raw); } catch { throw new AIError('format', 'JSON could not be read'); }
  const list = k => (Array.isArray(data[k]) ? data[k].filter(c => c && typeof c === 'object') : []);
  const changes = [
    ...list('add').map(c => ({ ...c, action: 'add' })),
    ...list('update').map(c => ({ ...c, action: 'update' })),
    ...list('remove').map(c => ({ id: c.id, action: 'delete' })),
    ...list('changes'),                                  // an older format, still accepted
  ];
  if (data.dates && data.dates.start && data.dates.end) changes.push({ action: 'set_dates', start: data.dates.start, end: data.dates.end });
  return { text: typeof data.reply === 'string' ? data.reply.trim() : '', changes };
}

/* ---------- Which plans sell out? ----------
   Asked in the background (the lighter model, a whole trip's new plans in one request), and kept on
   this device per plan name. Only what is known to sell out counts, not every place with a ticket. */

const BOOKING_RULES = `You know which tourist sights, activities, shows and restaurants are hard to get into without booking.
For each numbered plan, say whether it is widely known to sell out, so that a traveller has to buy tickets or reserve
days or weeks ahead to get in at all (for example: the Statue of Liberty's pedestal and crown, Alcatraz, the Last Supper
in Milan, the Anne Frank House, the Sagrada Família, the Alhambra, a hit Broadway show, a restaurant that is booked out
weeks ahead).
Also answer true for an event that happens once, at a set date and time, with seats sold by ticket: a sports game or
match, a concert, a play or musical, a festival. Without a ticket bought beforehand there is no getting in, even when
the event doesn't sell out.
Answer false for anything a traveller can normally walk into or buy a ticket for on the day, even if it charges a fee,
has queues or uses timed entry: most museums, aquariums, zoos, parks, churches, streets, markets, neighborhoods, ordinary
restaurants. Answer false when you are not sure, or when you don't recognize the place.
"why" is a short reason of at most 8 words when true (like "Crown tickets sell out months ahead", or
"Game tickets are sold ahead"), and "" when false.`;
const BOOKING_VERSION = 2;      // raise it when the rules change: the answers kept on devices are asked again

ai.saved.booking = ai.saved.booking || {};
const bookingCheck = { busy: false, retryAt: 0 };
const bookingKey = (item, trip) => norm(`${item.title} | ${placeLabel(trip)}`).slice(0, 200);
const sellsOut = (item, trip) => {
  const had = ai.saved.booking[bookingKey(item, trip)];
  return had && had.v === BOOKING_VERSION ? had : null;
};

function lookupBooking(trip) {
  if (state.settings.booking === false || !aiReady() || !navigator.onLine || bookingCheck.busy || Date.now() < bookingCheck.retryAt) return;
  const today = todayISO();
  const todo = trip.items.filter(i => !['stay', 'transport'].includes(i.category) && !i.done && !i.booked
    && !(i.date && i.date < today) && !sellsOut(i, trip)).slice(0, 40);
  if (!todo.length) return;
  bookingCheck.busy = true;
  bookingCheck.retryAt = Date.now() + 60 * 1000;         // at most one request a minute
  const text = `Plans of a trip to ${placeLabel(trip)}:\n` + todo.map((i, k) => `${k + 1}. ${i.title}${i.place && norm(i.place) !== norm(i.title) ? ` (${i.place})` : ''}`).join('\n');
  const body = {
    systemInstruction: { parts: [{ text: BOOKING_RULES }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: { plans: { type: 'array', items: {
          type: 'object',
          properties: { number: { type: 'integer' }, sells_out: { type: 'boolean' }, why: { type: 'string' } },
          required: ['number', 'sells_out', 'why'],
        } } },
        required: ['plans'],
      },
      temperature: 0,
    },
  };
  callGemini(AI_MODELS[1].id, body).then((answer) => {
    const list = JSON.parse(answer).plans;
    const said = new Map((Array.isArray(list) ? list : []).filter(a => a && typeof a === 'object').map(a => [a.number, a]));
    todo.forEach((item, k) => {
      const a = said.get(k + 1);
      // A plan left out of the answer counts as "no", so it isn't asked about again and again.
      ai.saved.booking[bookingKey(item, trip)] = { ahead: !!(a && a.sells_out === true), why: aiText(a && a.why, 70), t: Date.now(), v: BOOKING_VERSION };
    });
    // Keep the newest 400 answers.
    const keys = Object.keys(ai.saved.booking);
    if (keys.length > 400) keys.sort((x, y) => ai.saved.booking[x].t - ai.saved.booking[y].t).slice(0, keys.length - 400).forEach((k) => { delete ai.saved.booking[k]; });
    saveAI();
    renderSoon();
  }).catch((e) => {
    console.warn('Booking check', e);
    bookingCheck.retryAt = Date.now() + 15 * 60 * 1000;
  }).finally(() => { bookingCheck.busy = false; });
}

/* ---------- Turning proposed changes into real edits ---------- */

const aiIsDate = v => isDate(v);
const aiIsTime = v => isTime(v);
const aiText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Checks each proposed change against the trip; returns the ones that can be applied, with a line of text each.
function checkChanges(trip, changes) {
  const guide = guideFor(trip);
  const out = [];
  for (const c of changes) {
    if (c.action === 'add') {
      // The guide place: by its id, or else by its name in the title or place.
      const p = guide && ((c.guide_id && guide.places.find(x => x.id === c.guide_id))
        || matchPlaces({ title: aiText(c.title, 120), place: aiText(c.place, 200) }, guide)[0]) || null;
      const title = aiText(c.title, 120) || (p && p.name);
      if (!title) continue;
      const item = {
        id: uid(), title,
        category: CATEGORIES[c.category] ? c.category : p ? p.cat : 'other',
        date: aiIsDate(c.date) ? c.date : '', time: aiIsTime(c.time) ? c.time : '',
        place: aiText(c.place, 200) || (p ? p.place || p.name : ''), link: '', notes: aiText(c.notes, 2000), done: false,
        ...(p ? { lat: p.lat, lng: p.lng, guideId: p.id } : {}),
      };
      if (!item.date) item.time = '';
      out.push({ kind: 'add', item, icon: 'add', text: `${whenText(item)}${title}` });
    } else if (c.action === 'update' || c.action === 'delete') {
      const item = trip.items.find(i => i.id === c.id);
      if (!item) continue;
      if (c.action === 'delete') { out.push({ kind: 'delete', item, icon: 'delete', text: `Remove: ${item.title}` }); continue; }
      const patch = {};
      if ('title' in c && aiText(c.title, 120)) patch.title = aiText(c.title, 120);
      if ('category' in c && CATEGORIES[c.category]) patch.category = c.category;
      if ('date' in c && (c.date === '' || aiIsDate(c.date))) patch.date = c.date;
      if ('time' in c && (c.time === '' || aiIsTime(c.time))) patch.time = c.time;
      // An empty place or notes means "not given" (the model may skip copying them), not "erase".
      if (aiText(c.place, 200)) patch.place = aiText(c.place, 200);
      if (aiText(c.notes, 2000)) patch.notes = aiText(c.notes, 2000);
      for (const k of Object.keys(patch)) if (patch[k] === item[k]) delete patch[k];
      if (!Object.keys(patch).length) continue;
      const after = { ...item, ...patch };
      if (!after.date) after.time = '';
      const moved = 'date' in patch || 'time' in patch;
      out.push({
        kind: 'update', item, patch, icon: moved ? 'schedule' : 'edit',
        text: moved ? `Move: ${item.title} → ${after.date ? whenText(after).replace(/ · $/, '') : 'ideas'}` : `Change: ${after.title}`,
      });
    } else if (c.action === 'set_dates' && aiIsDate(c.start) && aiIsDate(c.end)) {
      const [start, end] = c.start <= c.end ? [c.start, c.end] : [c.end, c.start];
      if (start === trip.start && end === trip.end) continue;
      out.push({ kind: 'dates', start, end, icon: 'calendar_month', text: `Trip dates: ${fmtDay(start)} – ${fmtDay(end)}` });
    }
  }
  return out;
}

function whenText(item) {
  if (!item.date) return 'Idea: ';
  return `${fmtDay(item.date)}${item.time ? ' ' + fmtTime(item.time) : ''} · `;
}

function applyProposal(trip, msg) {
  const checked = checkChanges(trip, msg.changes || []);
  if (!checked.length) return;
  const before = { start: trip.start, end: trip.end, items: trip.items.map(i => ({ ...i })) };
  for (const c of checked) {
    if (c.kind === 'add') trip.items.push(c.item);
    if (c.kind === 'delete') trip.items = trip.items.filter(i => i.id !== c.item.id);
    if (c.kind === 'update') {
      Object.assign(c.item, c.patch);
      if (!c.item.date) c.item.time = '';
      // A new day or time: the plan no longer keeps an old Optimize route spot.
      if ('date' in c.patch || 'time' in c.patch) delete c.item.slot;
      if ('place' in c.patch) { delete c.item.lat; delete c.item.lng; delete c.item.geoMiss; delete c.item.guideId; }
    }
    if (c.kind === 'dates') { trip.start = c.start; trip.end = c.end; }
  }
  msg.status = 'applied';
  saveAI();
  save();
  render();
  renderChat();
  snackbar(`Applied ${plural(checked.length, 'change')}`, 'Undo', () => {
    trip.start = before.start;
    trip.end = before.end;
    trip.items = before.items;
    msg.status = 'undone';
    saveAI();
    save();
    render();
    renderChat();
  });
}

/* ---------- The chat sheet ---------- */

const AI_STARTERS = [
  'Plan my first day',
  'Fill my free days with ideas from the guide',
  'What should I not miss?',
  'Make a rainy-day plan',
];

function aiErrorText(e) {
  if (!navigator.onLine) return 'You’re offline. The assistant needs a connection.';
  return {
    setup: 'The assistant isn’t switched on in Firebase yet — see “AI assistant” in the README.',
    appcheck: 'Firebase couldn’t confirm this is your app (App Check). Check the reCAPTCHA key in firebase-config.js.',
    daily: 'Today’s free Gemini allowance is used up. Try again tomorrow, or use another AI app below.',
    busy: 'Gemini is busy right now. Wait a minute and try again.',
    format: 'The answer couldn’t be read. Try asking again in other words.',
  }[e && e.kind] || 'Something went wrong. Try again in a moment.';
}

function messageHTML(trip, m, index) {
  if (m.role === 'user') return `<div class="msg user"><p>${esc(m.text)}</p></div>`;
  const checked = m.changes && m.changes.length ? checkChanges(trip, m.changes) : [];
  const pending = checked.length && !m.status;
  return `
    <div class="msg ai">
      ${m.text ? `<p>${esc(m.text)}</p>` : ''}
      ${m.changes && m.changes.length ? `
        <div class="proposal ${m.status || ''}">
          <p class="proposal-head">${icon('auto_awesome')}${m.status === 'applied' ? 'Applied' : m.status === 'dismissed' ? 'Not applied' : m.status === 'undone' ? 'Undone' : `${plural(checked.length, 'change')} to your plan`}</p>
          ${checked.length || m.status ? `<ul>${(checked.length ? checked : m.changes.map(c => ({ icon: 'edit', text: c.title || c.action }))).map(c => `<li>${icon(c.icon)}<span>${esc(c.text)}</span></li>`).join('')}</ul>`
            : '<p class="proposal-none">These changes no longer fit the trip.</p>'}
          ${pending ? `
            <div class="proposal-actions">
              <button type="button" class="btn text ripple" data-action="ai-dismiss" data-msg="${index}">No thanks</button>
              <button type="button" class="btn filled ripple" data-action="ai-apply" data-msg="${index}">${icon('check')}Apply</button>
            </div>` : ''}
        </div>` : ''}
      ${m.model ? `<p class="msg-model">${esc(m.model)}</p>` : ''}
    </div>`;
}

function renderChat() {
  const dlg = $('#ai-dialog');
  if (!dlg.open) return;
  const trip = activeTrip();
  if (!trip) { dlg.close(); return; }
  const chat = chatOf(trip);
  const lite = ai.saved.liteDay === todayISO();
  $('#ai-sub').textContent = !aiReady() ? 'Use another AI app (below)'
    : lite ? 'Gemini · lighter model until tomorrow (today’s free allowance is used up)'
    : 'Gemini · free';

  const body = $('#ai-body');
  body.innerHTML = `
    ${aiReady() ? `<p class="ai-notice">${icon('info')}<span>This chat uses Google Gemini’s free service. Google may use what you send, including your trip details, to improve its AI, so leave out anything private.</span></p>` : ''}
    ${chat.length ? '' : `
      <div class="ai-intro">
        <p>Ask me to plan days, suggest places, or change your plans in ${esc(trip.name)}. I’ll show you the changes first — nothing changes until you tap <b>Apply</b>.</p>
        <div class="ai-starters">${AI_STARTERS.map(s => `<button type="button" class="filter-chip ripple" data-action="ai-starter">${esc(s)}</button>`).join('')}
          <button type="button" class="filter-chip ripple" data-action="ai-booking">${icon('confirmation_number')}Add from a booking email</button></div>
      </div>`}
    ${chat.map((m, i) => messageHTML(trip, m, i)).join('')}
    ${ai.busy ? `<div class="msg ai thinking"><p>${icon('auto_awesome')}Thinking…</p></div>` : ''}
    ${ai.error ? `<p class="ai-error" role="alert">${icon('error')}<span>${esc(ai.error)}</span></p>` : ''}
    <div class="ai-paste" ${ai.paste ? '' : 'hidden'}>
      <p class="ai-paste-title">${icon('content_copy')}Use another AI app</p>
      <ol>
        <li>Type your request below, then
          <button type="button" class="btn tonal sm ripple" data-action="ai-copy">${icon('content_copy')}Copy request</button></li>
        <li>Paste it into your AI app (any chatbot), and copy its whole answer.</li>
        <li>Paste the answer here:
          <textarea id="ai-answer" rows="3" placeholder="Paste the answer…"></textarea>
          <button type="button" class="btn tonal sm ripple" data-action="ai-read">${icon('check')}Read answer</button></li>
      </ol>
    </div>
    <div class="ai-bottom">
      <button type="button" class="btn text ripple ai-paste-toggle" data-action="ai-paste">${ai.paste ? 'Hide' : 'Use another AI app instead'}</button>
    </div>`;
  $('#ai-send').disabled = ai.busy || !aiReady() || !navigator.onLine;
  requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
}

function openAssistant() {
  ai.error = '';
  ai.paste = ai.paste || !aiReady();
  $('#ai-dialog').showModal();
  renderChat();
}

async function sendToAssistant(text) {
  const trip = activeTrip();
  text = text.trim();
  if (!trip || !text || ai.busy) return;
  const chat = chatOf(trip);
  const asked = { role: 'user', text };
  chat.push(asked);
  $('#ai-input').value = '';
  ai.busy = true;
  ai.error = '';
  saveAI();
  renderChat();
  try {
    const answer = await askGemini(trip, chat);
    chat.push({ role: 'model', text: answer.text, changes: answer.changes, model: answer.model });
  } catch (e) {
    console.warn('Assistant', e);
    ai.error = aiErrorText(e);
    // Keep the request so it can be sent again or copied to another app.
    if (chat.includes(asked)) chat.splice(chat.indexOf(asked), 1);
    $('#ai-input').value = text;
    if (e.kind === 'daily') ai.paste = true;
  } finally {
    ai.busy = false;
    saveAI();
    renderChat();
  }
}

// The same request, as text for another AI app.
function requestForOtherApp(trip, text) {
  const chat = chatOf(trip).slice(-AI_HISTORY);
  const convo = chat.map(m => (m.role === 'user' ? `User: ${m.text}` : `Assistant: ${m.text}`)).join('\n');
  return `${AI_RULES}\n- Answer with one \`\`\`json code block containing only that JSON object.\n\n${tripContext(trip)}`
    + `${convo ? `\n\nConversation so far:\n${convo}` : ''}\n\nUser: ${text}`;
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action^="ai-"]');
  if (!el) return;
  const trip = activeTrip();
  if (!trip) return;
  const chat = chatOf(trip);
  switch (el.dataset.action) {
    case 'ai-booking': {
      // The user pastes the confirmation after this line, then sends.
      const input = $('#ai-input');
      input.value = 'Add this booking to my trip:\n\n';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      snackbar('Now paste the confirmation email, then send');
      break;
    }
    case 'ai-starter':
      sendToAssistant(el.textContent);
      break;
    case 'ai-apply':
      applyProposal(trip, chat[Number(el.dataset.msg)]);
      break;
    case 'ai-dismiss':
      chat[Number(el.dataset.msg)].status = 'dismissed';
      saveAI();
      renderChat();
      break;
    case 'ai-paste':
      ai.paste = !ai.paste;
      renderChat();
      break;
    case 'ai-copy': {
      const text = $('#ai-input').value.trim();
      if (!text) { ai.error = 'Type your request in the box below first.'; renderChat(); $('#ai-input').focus(); break; }
      try {
        await navigator.clipboard.writeText(requestForOtherApp(trip, text));
        ai.pending = text;
        ai.error = '';
        snackbar('Request copied — paste it into your AI app');
      } catch {
        ai.error = 'Couldn’t copy. Try again.';
      }
      renderChat();
      break;
    }
    case 'ai-read': {
      const pasted = $('#ai-answer').value;
      if (!pasted.trim()) break;
      try {
        const answer = parseAnswer(pasted);
        const asked = ai.pending || $('#ai-input').value.trim();
        if (asked) chat.push({ role: 'user', text: asked });
        chat.push({ role: 'model', text: answer.text, changes: answer.changes, model: 'From another AI app' });
        ai.pending = '';
        ai.error = '';
        $('#ai-input').value = '';
      } catch (err) {
        ai.error = 'That doesn’t look like the answer. Copy the whole answer, including the part between ``` marks.';
      }
      saveAI();
      renderChat();
      break;
    }
  }
});

document.getElementById('ai-form').addEventListener('submit', (e) => {
  e.preventDefault();
  sendToAssistant($('#ai-input').value);
});
// Enter sends; Shift+Enter makes a new line.
document.getElementById('ai-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendToAssistant($('#ai-input').value);
  }
});

/* ---------- Speaking instead of typing (the phone's own speech recognition) ---------- */

const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
const voice = { rec: null, before: '' };
if (Speech) document.getElementById('ai-mic').hidden = false;

function stopVoice() {
  if (voice.rec) voice.rec.stop();
}

document.getElementById('ai-mic').addEventListener('click', () => {
  if (voice.rec) { stopVoice(); return; }
  const input = document.getElementById('ai-input');
  const mic = document.getElementById('ai-mic');
  const rec = new Speech();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  voice.rec = rec;
  voice.before = input.value.trim() ? input.value.trim() + ' ' : '';
  mic.classList.add('listening');
  mic.setAttribute('aria-pressed', 'true');
  rec.onresult = (e) => {
    const said = [...e.results].map(r => r[0].transcript).join('');
    input.value = voice.before + said;
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') snackbar('Microphone is blocked for this app — allow it in Chrome’s site settings');
    else if (e.error === 'network') snackbar('Speaking needs a connection');
  };
  rec.onend = () => {
    voice.rec = null;
    mic.classList.remove('listening');
    mic.setAttribute('aria-pressed', 'false');
    input.focus();
  };
  rec.start();
});
// Stop listening when the sheet closes.
document.getElementById('ai-dialog').addEventListener('close', stopVoice);
