'use strict';

/* money.js — what was spent on a trip and who owes whom, like a shared-expenses app (the Expenses tab is
   view-money.js). Amounts are whole cents (or whatever the currency's smallest unit is), never decimals,
   so totals always add up to the cent.

   A trip has:
     currency   what its totals and balances are in (EUR when missing)
     people     [{ id, name }]: who shares the costs. On a trip planned together each person on it is one,
                with the id "m_<their account>"; anyone can also add a guest by name (no account needed).
                On a trip of your own, you are "me".
     costs      [{ id, title, amount, cur, rate, paidBy, split, how, date, kind, at }]
                amount   in `cur`'s smallest unit; rate: how much 1 `cur` is in the trip's currency (saved
                         with it, so a cost never changes later); paidBy: a person; split: person → their part
                         (how "equal": 1 each; "shares": how many shares each, 1 for one, 3 for another;
                         "amounts": in `cur`'s smallest unit);
                kind "transfer": money given back (paidBy gave it to the one person in split).
   people and costs are documents of their own when synced (person_…, cost_…): two people adding a cost at
   the same moment never undo each other's. */

const RATES_KEY = 'tripPlanner.rates';
const RATES_MAX_AGE = 12 * 3600e3;          // rates are fetched again after 12 hours (they change once a day)
const MONEY_MAX = 1e12;                     // the largest amount the app takes, in a currency's smallest unit
// A short list for a device that can't list every currency (older browsers).
const SOME_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD', 'CNY', 'HKD', 'SGD', 'THB', 'INR', 'MXN', 'BRL',
  'ZAR', 'MAD', 'TRY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'ISK', 'KRW', 'IDR', 'VND', 'MUR', 'AED', 'EGP', 'ILS'];

const rates = {
  saved: (() => { try { return JSON.parse(localStorage.getItem(RATES_KEY)) || null; } catch { return null; } })(),
  loading: null,
  failedAt: 0,
};

/* ---------- Currencies ---------- */

const isCurrency = v => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
const tripCurrency = trip => (trip && isCurrency(trip.currency) ? trip.currency : 'EUR');

// How many decimals a currency has (JPY none, EUR two, KWD three).
const curDigitsKnown = new Map();
function curDigits(cur) {
  if (!curDigitsKnown.has(cur)) {
    let d = 2;
    try { d = new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits; } catch { /* unknown: 2 */ }
    curDigitsKnown.set(cur, d);
  }
  return curDigitsKnown.get(cur);
}

// "€12.50", "12,50 €", "¥1,200": in the app's language.
const moneyFormats = new Map();
function fmtMoney(minor, cur) {
  const key = `${dateLocale()}|${cur}`;
  if (!moneyFormats.has(key)) {
    try {
      moneyFormats.set(key, new Intl.NumberFormat(dateLocale(), { style: 'currency', currency: cur }));
    } catch {
      moneyFormats.set(key, { format: v => `${fmtNum(v)} ${cur}` });
    }
  }
  return moneyFormats.get(key).format(minor / 10 ** curDigits(cur));
}

// What was typed ("12,5", "1 200.00", "€8") → the amount in the currency's smallest unit, or null.
function parseAmount(text, cur) {
  const s = String(text || '').replace(/[\s\u00a0\u202f'’]/g, '').replace(/[^\d.,-]/g, '');
  if (!s || s.includes('-')) return null;
  const digits = curDigits(cur);
  let whole = s, frac = '';
  // The last "." or "," is the decimal point, unless 3 digits follow it in a currency with fewer decimals:
  // then "1,200" or "1.200" is a thousand and two hundred.
  const at = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (at >= 0 && !(s.length - at - 1 === 3 && digits < 3)) { whole = s.slice(0, at); frac = s.slice(at + 1); }
  whole = whole.replace(/[.,]/g, '');
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac) || (!whole && !frac) || frac.length > digits) return null;
  const minor = Number(whole || 0) * 10 ** digits + Number((frac + '000').slice(0, digits) || 0);
  return Number.isSafeInteger(minor) && minor > 0 && minor <= MONEY_MAX ? minor : null;
}

// The amount as it goes back into a field: "12.50", "12,50", "1200".
const amountText = (minor, cur) => {
  const d = curDigits(cur);
  const s = (minor / 10 ** d).toFixed(d);
  return LANG === 'fr' ? s.replace('.', ',') : s;
};

// "Japanese Yen", "yen japonais".
const currencyNames = new Map();
function currencyName(cur) {
  if (!currencyNames.has(LANG + cur)) {
    let name = cur;
    try { name = new Intl.DisplayNames([LANG], { type: 'currency' }).of(cur) || cur; } catch { /* no names on this device */ }
    currencyNames.set(LANG + cur, name.charAt(0).toUpperCase() + name.slice(1));
  }
  return currencyNames.get(LANG + cur);
}

// Every currency in the world, by name.
function allCurrencies() {
  let list = SOME_CURRENCIES;
  try { if (Intl.supportedValuesOf) list = Intl.supportedValuesOf('currency'); } catch { /* the short list */ }
  return [...new Set(list)].filter(isCurrency).sort((a, b) => currencyName(a).localeCompare(currencyName(b), LANG));
}

// The ones to offer first: euros, the place's own (from Essentials), the trip's, then those already used on it.
function firstCurrencies(trip) {
  const facts = trip && trip.place && essentials.saved[placeKey(trip.place)];
  const local = facts && facts.facts && Array.isArray(facts.facts.currencyCodes) ? facts.facts.currencyCodes : [];
  return [...new Set(['EUR', ...local.filter(isCurrency), tripCurrency(trip), ...(trip ? trip.costs || [] : []).map(c => c.cur)])];
}

/* ---------- Exchange rates ---------- */

// Today's rates, from a free service with no key (the European Central Bank's and others', by Fawaz Ahmed),
// with a copy on another host. Kept on the device: a cost added offline uses the last ones. Always a promise
// (of the rates, or null).
const RATES_URLS = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.min.json',
  'https://latest.currency-api.pages.dev/v1/currencies/eur.min.json',
];
function loadRates(force = false) {
  const fresh = rates.saved && Date.now() - rates.saved.t < RATES_MAX_AGE;
  if (rates.loading) return rates.loading;
  if ((fresh && !force) || !navigator.onLine || Date.now() - rates.failedAt < 60e3) return Promise.resolve(rates.saved);
  rates.loading = (async () => {
    for (const url of RATES_URLS) {
      try {
        const data = await getJSON(url);
        const list = data && data.eur && typeof data.eur === 'object' ? data.eur : null;
        const clean = list && Object.fromEntries(Object.entries(list)
          .filter(([k, v]) => /^[a-z]{3}$/.test(k) && typeof v === 'number' && v > 0 && Number.isFinite(v))
          .map(([k, v]) => [k.toUpperCase(), v]));
        if (!clean || !clean.USD) continue;
        rates.saved = { t: Date.now(), date: isDate(data.date) ? data.date : todayISO(), eur: clean };
        try { localStorage.setItem(RATES_KEY, JSON.stringify(rates.saved)); } catch { /* storage full: kept in memory */ }
        return rates.saved;
      } catch { /* the next host */ }
    }
    rates.failedAt = Date.now();
    return null;
  })().finally(() => { rates.loading = null; });
  return rates.loading;
}

// How much 1 `from` is in `to`, from the saved rates. null when they don't know one of them.
function rateFor(from, to) {
  if (from === to) return 1;
  const eur = rates.saved && rates.saved.eur;
  const a = from === 'EUR' ? 1 : eur && eur[from];
  const b = to === 'EUR' ? 1 : eur && eur[to];
  return a && b ? b / a : null;
}

/* ---------- People ---------- */

const memberId = uid => `m_${uid}`;
const memberUid = id => (typeof id === 'string' && id.startsWith('m_') ? id.slice(2) : '');
const myUid = () => (sync.saved && sync.saved.uid) || '';

// Who you are on this trip.
function myPersonId(trip) {
  if (trip.shared && myUid()) return memberId(myUid());
  const people = trip.people || [];
  // A trip that was shared before and is your own now: you were your account.
  if (!people.some(p => p.id === 'me') && myUid() && people.some(p => p.id === memberId(myUid()))) return memberId(myUid());
  return 'me';
}

// Everyone on the trip: those saved with it, plus the people on a shared trip and you, who need no adding.
// They are only saved with the trip once a cost names them (keepPeople), so drawing the tab writes nothing.
function tripPeople(trip) {
  const list = (trip.people || []).slice();
  const has = id => list.some(p => p.id === id);
  const root = shareOf(trip);
  if (root) for (const m of root.members) if (!has(memberId(m.uid))) list.push({ id: memberId(m.uid), name: personName(trip, m.uid) || '' });
  const me = myPersonId(trip);
  if (!has(me)) list.unshift({ id: me, name: myName() || '' });
  // You first, then the others in the order they came.
  return list.sort((a, b) => (b.id === me) - (a.id === me));
}

// A person's name: the one a member chose (it can change), else the one saved.
function personLabel(trip, id, { you = true } = {}) {
  const mine = id === myPersonId(trip);
  if (mine && you) return T('You');
  if (mine && myName()) return myName();
  const uid = memberUid(id);
  const live = uid && trip.shared ? personName(trip, uid) : '';
  const saved = (trip.people || []).find(p => p.id === id);
  return live || (saved && saved.name) || (id === 'me' ? myName() || T('Me') : T('Someone'));
}

// The people a cost names are saved with the trip (a member's name too, for when they leave it).
function keepPeople(trip, ids) {
  trip.people = trip.people || [];
  for (const id of ids) {
    if (trip.people.some(p => p.id === id)) continue;
    const name = id === myPersonId(trip) ? myName() || '' : personLabel(trip, id, { you: false });
    trip.people.push({ id, name: name === T('Someone') ? '' : name });
  }
}

// A guest: someone who shares the costs without the app.
function addGuest(trip, name) {
  const person = { id: uid(), name: tidyName(name) };
  if (!person.name) return null;
  (trip.people = trip.people || []).push(person);
  return person;
}

// Whether a person can be taken off the trip's people: not while a cost names them.
const personUsed = (trip, id) => (trip.costs || []).some(c => c.paidBy === id || id in c.split);

// A trip that starts being planned together: "me" becomes your account, in its people and its costs.
function shareMoney(trip, uidNow) {
  const to = memberId(uidNow);
  const swap = id => (id === 'me' ? to : id);
  for (const p of trip.people || []) p.id = swap(p.id);
  for (const c of trip.costs || []) {
    c.paidBy = swap(c.paidBy);
    c.split = Object.fromEntries(Object.entries(c.split).map(([k, v]) => [swap(k), v]));
  }
}

/* ---------- Adding up ---------- */

// A cost in the trip's currency, in its smallest unit.
function costInTrip(cost, trip) {
  const cur = tripCurrency(trip);
  if (cost.cur === cur) return cost.amount;
  return Math.round(cost.amount * cost.rate * 10 ** (curDigits(cur) - curDigits(cost.cur)));
}

// `total` shared out by weights, in whole units that add up to it exactly: the units left over go to the
// largest remainders (then in id order, so every device gets the same answer).
function shareOut(total, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0).sort(([a], [b]) => (a < b ? -1 : 1));
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  if (!sum) return new Map();
  const parts = entries.map(([id, w]) => {
    const exact = total * w / sum;
    return { id, n: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = total - parts.reduce((s, p) => s + p.n, 0);
  for (const p of parts.slice().sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    p.n++;
    left--;
  }
  return new Map(parts.map(p => [p.id, p.n]));
}

// What each person's part of a cost is, in the trip's currency.
const costShares = (cost, trip) => shareOut(costInTrip(cost, trip), cost.split);

// Each person's balance: what they paid minus their part. Above zero, they get money back.
function balances(trip) {
  const out = new Map(tripPeople(trip).map(p => [p.id, 0]));
  for (const c of trip.costs || []) {
    out.set(c.paidBy, (out.get(c.paidBy) || 0) + costInTrip(c, trip));
    for (const [id, n] of costShares(c, trip)) out.set(id, (out.get(id) || 0) - n);
  }
  return out;
}

// Who pays whom to settle up, in as few payments as this simple way finds: the one who owes the most pays
// the one owed the most, and so on.
function settleUp(bal) {
  const owed = [...bal].filter(([, n]) => n > 0).map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));
  const owing = [...bal].filter(([, n]) => n < 0).map(([id, n]) => ({ id, n: -n })).sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));
  const pay = [];
  let i = 0, j = 0;
  while (i < owing.length && j < owed.length) {
    const n = Math.min(owing[i].n, owed[j].n);
    if (n > 0) pay.push({ from: owing[i].id, to: owed[j].id, amount: n });
    owing[i].n -= n;
    owed[j].n -= n;
    if (!owing[i].n) i++;
    if (!owed[j].n) j++;
  }
  return pay;
}

// What the trip cost (money given back doesn't count), and your own part of it.
function spentTotals(trip) {
  const me = myPersonId(trip);
  let total = 0, mine = 0;
  for (const c of trip.costs || []) {
    if (c.kind === 'transfer') continue;
    total += costInTrip(c, trip);
    mine += costShares(c, trip).get(me) || 0;
  }
  return { total, mine };
}

// Settling a payment from the list: it goes in as money given back, today.
function addTransfer(trip, { from, to, amount }) {
  keepPeople(trip, [from, to]);
  const cost = { id: uid(), title: '', amount, cur: tripCurrency(trip), rate: 1, paidBy: from, split: { [to]: 1 }, how: 'equal', date: todayISO(), kind: 'transfer', at: Date.now() };
  (trip.costs = trip.costs || []).push(cost);
  return cost;
}
