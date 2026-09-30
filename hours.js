'use strict';

/* =========================================================
   Opening hours: warns when a plan is on a day or at a time the place is
   usually closed. Hours come from OpenStreetMap (asked in one go for a
   trip's plans, then saved on the phone), or from the travel guide.
   Hours change — these are hints, not guarantees.
   Functions here use helpers from app.js, which is loaded after this file.
   ========================================================= */

const HOURS_KEY = 'tripPlanner.hours';
const HOURS_MAX_AGE = 30 * 864e5;
const OVERPASS = 'https://overpass-api.de/api/interpreter';

/* ---------- Reading OpenStreetMap's opening_hours format ----------
   Handles the common cases: "Mo-Fr 09:00-17:00; Sa 10:00-14:00",
   "Tu-Su 10:00-18:00; Jan 01,Dec 25 off", "Oct-Apr 10:00-17:30; May-Sep 10:00-18:30; Mo off",
   "24/7". Anything else gives no answer rather than a wrong one. */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_RE = MONTHS.join('|');

// "Mo-We,Fr" → set of weekday numbers (0 = Sunday).
function weekdaySet(text) {
  const set = new Set();
  for (const part of text.split(',')) {
    const m = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part.trim());
    if (!m) return null;
    const a = WEEKDAYS.indexOf(m[1]), b = m[2] ? WEEKDAYS.indexOf(m[2]) : a;
    for (let d = a; ; d = (d + 1) % 7) { set.add(d); if (d === b) break; }
  }
  return set;
}

// "Oct-Apr" / "Jun,Jul" → set of month numbers; "Jan 01,May 01-May 03" → list of [month, day] ranges.
function monthSelector(text) {
  const parts = text.split(',').map(s => s.trim());
  const dated = new RegExp(`^(${MONTH_RE})\\s*(\\d{1,2})(?:\\s*-\\s*(?:(${MONTH_RE})\\s*)?(\\d{1,2}))?$`);
  const plain = new RegExp(`^(${MONTH_RE})(?:\\s*-\\s*(${MONTH_RE}))?$`);
  if (parts.every(p => dated.test(p))) {
    return {
      dates: parts.map((p) => {
        const m = dated.exec(p);
        const from = [MONTHS.indexOf(m[1]), Number(m[2])];
        const to = m[4] ? [m[3] ? MONTHS.indexOf(m[3]) : from[0], Number(m[4])] : from;
        return [from, to];
      }),
    };
  }
  if (parts.every(p => plain.test(p))) {
    const months = new Set();
    for (const p of parts) {
      const m = plain.exec(p);
      const a = MONTHS.indexOf(m[1]), b = m[2] ? MONTHS.indexOf(m[2]) : a;
      for (let k = a; ; k = (k + 1) % 12) { months.add(k); if (k === b) break; }
    }
    return { months };
  }
  return null;
}

const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// One rule, e.g. "Oct-Apr Mo-Fr 10:00-17:30". Returns null when it can't be read.
function parseRule(rule) {
  let text = rule.trim();
  if (!text) return { skip: true };
  if (text === '24/7') return { ranges: [[0, 1440]] };
  // Holiday-only rules, Easter, week numbers and years only change special days: leave them out.
  if (/^(PH|SH)\b/.test(text) || /\b(easter|week)\b|\b\d{4}\b/i.test(text)) return { skip: true };
  text = text.replace(/\s*,\s*(PH|SH)\b|\b(PH|SH)\s*,\s*/g, '');
  const timeAt = text.search(/\d{1,2}:\d{2}|\b(off|closed)\b/i);
  const selector = (timeAt < 0 ? text : text.slice(0, timeAt)).trim().replace(/:$/, '').trim();
  const times = timeAt < 0 ? '' : text.slice(timeAt).trim();
  const out = {};

  if (selector) {
    // Months or dates come first ("Oct-Apr", "Jan 01,Dec 25"), then weekdays ("Mo-Fr").
    const monthPart = new RegExp(`^(?:${MONTH_RE}|[\\d\\s,-])+`).exec(selector);
    let rest = selector;
    if (monthPart && new RegExp(MONTH_RE).test(monthPart[0])) {
      const sel = monthSelector(monthPart[0].trim().replace(/[,-]$/, '').trim());
      if (!sel) return null;
      Object.assign(out, sel);
      rest = selector.slice(monthPart[0].length).trim();
    }
    if (rest) {
      const days = weekdaySet(rest);
      if (!days) return null;
      out.days = days;
    }
  }

  if (!times) out.ranges = [[0, 1440]];
  else if (/^(off|closed)\b/i.test(times)) out.ranges = [];
  else {
    out.ranges = [];
    for (const part of times.split(',')) {
      const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\+?$|^(\d{1,2}:\d{2})\+$/.exec(part.trim());
      if (!m) return null;
      if (m[3]) { out.ranges.push([toMin(m[3]), 1440]); continue; }
      const a = toMin(m[1]);
      let b = toMin(m[2]);
      if (b <= a) b += 1440;            // past midnight
      out.ranges.push([a, b]);
    }
  }
  return out;
}

function parseHours(text) {
  if (!text || text.length > 300) return null;
  const rules = text.split('||')[0].split(';').map(parseRule);
  if (rules.some(r => r === null)) return null;
  const useful = rules.filter(r => !r.skip);
  return useful.length ? useful : null;
}

const inDates = (dates, m, d) => dates.some(([[m1, d1], [m2, d2]]) => {
  const x = m * 100 + d, a = m1 * 100 + d1, b = m2 * 100 + d2;
  return a <= b ? x >= a && x <= b : x >= a || x <= b;
});

// Open times on a date: [[start, end] in minutes], [] when closed, null when unknown.
function hoursOn(rules, iso) {
  const date = parseDate(iso);
  const m = date.getMonth(), d = date.getDate(), wd = date.getDay();
  let result = [];
  let matched = false;
  for (const r of rules) {
    if (r.months && !r.months.has(m)) continue;
    if (r.dates && !inDates(r.dates, m, d)) continue;
    if (r.days && !r.days.has(wd)) continue;
    result = r.ranges;              // a later rule replaces earlier ones for the days it names
    matched = true;
  }
  return matched ? result : [];
}

/* ---------- Finding a plan's hours ---------- */

const hours = {
  saved: (() => { try { return JSON.parse(localStorage.getItem(HOURS_KEY)) || {}; } catch { return {}; } })(),
  pending: new Set(),
  busy: false,
  retryAt: 0,           // after a failed request, wait a few minutes before asking again
};

const hoursKey = (item, c) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}|${norm(item.title)}`;
const plainWords = s => norm(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''))
  .split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !['the', 'and', 'museum', 'museu', 'museo', 'musee', 'of', 'de', 'do', 'da', 'des', 'del'].includes(w));

// Does an OpenStreetMap place's name fit the plan? (shared words, or one name inside the other)
function nameScore(item, tags) {
  const mine = new Set(plainWords(`${item.title} ${item.place}`));
  const flat = s => norm(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''));
  let best = 0;
  for (const name of [tags.name, tags['name:en'], tags.alt_name, tags.official_name].filter(Boolean)) {
    if (flat(`${item.title} ${item.place}`).includes(flat(name))) return 1;
    const words = plainWords(name);
    if (!words.length) continue;
    best = Math.max(best, words.filter(w => mine.has(w)).length / words.length);
  }
  return best;
}

// Looks up hours for plans that have a day and a map position, in one request.
function lookupHours(trip, items) {
  if (!state.settings.lookup || !navigator.onLine || hours.busy || Date.now() < hours.retryAt) return;
  const guide = guideFor(trip);
  const todo = [];
  for (const item of items) {
    const c = coordsOf(item, guide);
    if (!c || !item.date) continue;
    const key = hoursKey(item, c);
    const had = hours.saved[key];
    if ((had && Date.now() - had.t < HOURS_MAX_AGE) || hours.pending.has(key)) continue;
    todo.push({ item, c, key });
    if (todo.length === 20) break;
  }
  if (!todo.length) return;
  hours.busy = true;
  todo.forEach(x => hours.pending.add(x.key));
  const query = `[out:json][timeout:20];(${todo.map(x => `nwr(around:120,${x.c.lat},${x.c.lng})[name][opening_hours];`).join('')});out tags center;`;
  fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(query) })
    .then(res => (res.ok ? res.json() : Promise.reject(new Error('hours ' + res.status))))
    .then((data) => {
      const found = data.elements.map(e => ({ tags: e.tags, lat: e.lat ?? e.center.lat, lng: e.lon ?? e.center.lon }));
      for (const { item, c, key } of todo) {
        let best = null;
        for (const f of found) {
          const d = miles(c, f);
          if (d > 0.08) continue;
          const score = nameScore(item, f.tags);
          if (score < 0.5) continue;
          if (!best || score > best.score || (score === best.score && d < best.d)) best = { score, d, f };
        }
        hours.saved[key] = best ? { oh: best.f.tags.opening_hours, name: best.f.tags.name, t: Date.now() } : { t: Date.now() };
      }
      const keys = Object.keys(hours.saved).sort((a, b) => hours.saved[b].t - hours.saved[a].t);
      for (const old of keys.slice(400)) delete hours.saved[old];
      try { localStorage.setItem(HOURS_KEY, JSON.stringify(hours.saved)); } catch { /* storage full */ }
      renderSoon();
    })
    .catch((err) => {
      console.warn('No opening hours', err);
      hours.retryAt = Date.now() + 5 * 60e3;
    })
    .finally(() => {
      todo.forEach(x => hours.pending.delete(x.key));
      hours.busy = false;
    });
}

// The travel guide's own hours text, e.g. "Tu-Su 10:00-18:00" or "10AM-6PM, closed Mondays".
const DAY_WORDS = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
function guideHours(text) {
  const rules = parseHours(text);
  if (rules) return rules;
  const closed = [...String(text || '').toLowerCase().matchAll(/closed\s+(?:on\s+)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*/g)]
    .map(m => DAY_WORDS[m[1]]);
  if (!closed.length) return null;
  // Only the closed days are known: every other day counts as open all day.
  return [{ ranges: [[0, 1440]] }, { days: new Set(closed), ranges: [] }];
}

function itemHours(item, guide) {
  const c = coordsOf(item, guide);
  const had = c && hours.saved[hoursKey(item, c)];
  const osm = had && had.oh && parseHours(had.oh);
  if (osm) return osm;
  const p = matchPlaces(item, guide)[0];
  return p && p.hours ? guideHours(p.hours) : null;
}

const fmtMins = m => (m > 0 && m % 1440 === 0 ? 'midnight' : fmtTime(`${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`));
const rangeText = rs => rs.map(([a, b]) => (a === 0 && b >= 1440 ? 'all day' : `${fmtMins(a)} – ${fmtMins(b)}`)).join(', ');

// A short line for a plan's card: a warning when closed, otherwise that day's hours.
function hoursNote(item, guide) {
  if (!item.date) return null;
  const rules = itemHours(item, guide);
  if (!rules) return null;
  const open = hoursOn(rules, item.date);
  if (!open.length) {
    const addDays = (k) => { const d = parseDate(item.date); d.setDate(d.getDate() + k); return toISO(d); };
    const closed = k => !hoursOn(rules, addDays(k)).length;
    let text = 'Closed on this date — likely a holiday';
    if ([1, 2, 3, 4, 5, 6].every(closed)) text = 'Looks closed around this date';
    else if ([-14, -7, 7, 14].filter(closed).length >= 3) text = `Usually closed on ${fmtDay(item.date, { weekday: 'long' })}s`;
    return { warn: true, text };
  }
  if (item.time) {
    const t = toMin(item.time);
    const ok = open.some(([a, b]) => (t >= a && t < b) || (t + 1440 >= a && t + 1440 < b));
    if (!ok) {
      const later = open.find(([a]) => a > t);
      return { warn: true, text: later ? `Closed at ${fmtTime(item.time)} — opens ${fmtMins(later[0])}` : `Closed by ${fmtTime(item.time)} — open ${rangeText(open)}` };
    }
  }
  return { warn: false, text: `Open ${rangeText(open)}` };
}
