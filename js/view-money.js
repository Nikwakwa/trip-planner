'use strict';

/* view-money.js — the Expenses tab: what was spent on the open trip, each person's balance and who pays whom
   to settle up, the sheet to add or change an expense (or money given back), and the one to add someone who
   shares the costs without the app. The adding up is in money.js. */

const costDialog = $('#cost-dialog');
const costForm = $('#cost-form');
const personDialog = $('#person-dialog');
const personForm = $('#person-form');
let editingCostId = null;
let editingPersonId = null;

// A person's round badge: their first letter, in a color of their own.
function personBadge(trip, id) {
  const name = personLabel(trip, id, { you: false });
  if (id === myPersonId(trip) && !myName()) return `<span class="person-badge" style="--h:250" aria-hidden="true">${icon('person', 'sm')}</span>`;
  let hue = 0;
  for (const ch of id) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="person-badge" style="--h:${hue}" aria-hidden="true">${esc((name.trim()[0] || '?').toUpperCase())}</span>`;
}

// "Ann paid", "You paid".
const paidText = (trip, id) => (id === myPersonId(trip) ? T('You paid') : T('{name} paid', { name: esc(personLabel(trip, id)) }));

/* ---------- The tab ---------- */

function renderMoney(trip) {
  const view = $('#view-money');
  if (!trip) {
    view.innerHTML = `
      <h1 class="headline">${T('Expenses')}</h1>
      ${emptyState('payments', T('No trip yet'), T('Pick a place first, then add what you spend there.'),
        `<button type="button" class="btn filled ripple" data-action="new-trip">${icon('search')}${T('Search a city or country')}</button>`)}`;
    return;
  }
  if (trip.place) essentialsFor(trip);      // essentials.js: the place's own currency, offered in the form
  const cur = tripCurrency(trip);
  const costs = trip.costs || [];
  const people = tripPeople(trip);
  const me = myPersonId(trip);
  const tab = ui.moneyTab === 'balances' ? 'balances' : 'costs';
  let html = `<h1 class="headline">${T('Expenses')}</h1>`;

  html += moneyToolsHTML(trip);

  if (!costs.length) {
    html += `
      <p class="supporting">${T('Add what each of you pays during the trip: the app works out who owes whom.')}</p>
      ${emptyState('receipt_long', T('No expenses yet'), people.length > 1
        ? T('Shared with {names}.', { names: esc(people.filter(p => p.id !== me).map(p => personLabel(trip, p.id)).join(', ')) })
        : T('Add the people you travel with, even without the app.'), `
        <div class="empty-actions">
          <button type="button" class="btn tonal ripple" data-action="add-person">${icon('person_add')}${T('Add someone')}</button>
        </div>`)}`;
    view.innerHTML = html;
    return;
  }

  const { total, mine } = spentTotals(trip);
  const bal = balances(trip);
  const mineNow = bal.get(me) || 0;
  html += `
    <section class="money-card">
      <p class="money-over">${T('Spent on {trip}', { trip: esc(tripName(trip)) })}</p>
      <p class="money-total">${esc(fmtMoney(total, cur))}</p>
      <div class="money-facts">
        <span>${T('Your part: {amount}', { amount: esc(fmtMoney(mine, cur)) })}</span>
        <span class="money-bal ${mineNow > 0 ? 'plus' : mineNow < 0 ? 'minus' : ''}">${mineNow > 0
          ? T('You get back {amount}', { amount: esc(fmtMoney(mineNow, cur)) })
          : mineNow < 0 ? T('You owe {amount}', { amount: esc(fmtMoney(-mineNow, cur)) }) : T('You’re all square')}</span>
      </div>
    </section>
    <div class="segmented money-tabs" role="group" aria-label="${T('Expenses view')}">
      <button type="button" class="ripple" data-action="money-tab" data-tab="costs" aria-pressed="${tab === 'costs'}">${icon('receipt_long')}${T('Expenses')} (${costs.length})</button>
      <button type="button" class="ripple" data-action="money-tab" data-tab="balances" aria-pressed="${tab === 'balances'}">${icon('handshake')}${T('Balances')}</button>
    </div>`;
  html += tab === 'costs' ? costListHTML(trip) : balancesHTML(trip, bal);
  view.innerHTML = html;
}

// Who shares the costs, and what the totals are in: each opens its sheet.
function moneyToolsHTML(trip) {
  const n = tripPeople(trip).length;
  const cur = tripCurrency(trip);
  return `
    <div class="money-tools">
      <button type="button" class="assist-chip ripple" data-action="money-people">${icon('group')}${Tn(n, '{n} person', '{n} people')}</button>
      <button type="button" class="assist-chip ripple" data-action="money-currency" aria-label="${T('Currency of the totals: {cur}', { cur: esc(currencyName(cur)) })}">${icon('currency_exchange')}${T('Totals in {cur}', { cur })}</button>
    </div>`;
}

// Every currency for a <select>: euros and the place's own first, then the others by name.
function currencyOptions(trip, cur) {
  const first = firstCurrencies(trip);
  if (!first.includes(cur)) first.push(cur);
  const option = c => `<option value="${c}">${c} · ${esc(currencyName(c))}</option>`;
  return first.map(option).join('') + '<option disabled>──────────</option>' + allCurrencies().filter(c => !first.includes(c)).map(option).join('');
}

// The expenses, newest day first.
function costListHTML(trip) {
  const cur = tripCurrency(trip);
  const costs = (trip.costs || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.at - a.at);
  const days = [];
  for (const c of costs) {
    const last = days[days.length - 1];
    if (last && last.day === c.date) last.costs.push(c); else days.push({ day: c.date, costs: [c] });
  }
  return days.map(({ day, costs: list }) => {
    const spent = list.filter(c => c.kind !== 'transfer').reduce((s, c) => s + costInTrip(c, trip), 0);
    return `
      <div class="label-row money-day">
        <h2 class="group-label">${day ? esc(fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric' })) : T('No day')}</h2>
        ${spent ? `<span class="money-day-total">${esc(fmtMoney(spent, cur))}</span>` : ''}
      </div>
      <ul class="group costs">${list.map(c => costRowHTML(trip, c)).join('')}</ul>`;
  }).join('');
}

function costRowHTML(trip, c) {
  const cur = tripCurrency(trip);
  const transfer = c.kind === 'transfer';
  const to = Object.keys(c.split)[0];
  const n = Object.keys(c.split).length;
  const everyone = n === tripPeople(trip).length && n > 1;
  const title = transfer
    ? T('{from} → {to}', { from: esc(personLabel(trip, c.paidBy)), to: esc(personLabel(trip, to)) })
    : esc(c.title || T('Expense'));
  const sub = transfer ? T('Money given back')
    : [paidText(trip, c.paidBy), everyone ? T('for everyone') : n === 1 && Object.keys(c.split)[0] === c.paidBy ? T('for themselves')
      : Tn(n, 'for {n} person', 'for {n} people')].join(' · ');
  return `
    <li><button type="button" class="cost-row ripple" data-action="edit-cost" data-id="${esc(c.id)}">
      <span class="row-icon${transfer ? ' transfer' : ''}">${icon(transfer ? 'handshake' : 'receipt_long')}</span>
      <span class="row-text"><span class="row-title">${title}</span><span class="row-sub">${sub}</span></span>
      <span class="cost-amount"><b>${esc(fmtMoney(c.amount, c.cur))}</b>${c.cur !== cur ? `<small>${esc(fmtMoney(costInTrip(c, trip), cur))}</small>` : ''}</span>
    </button></li>`;
}

// Each person's balance, then the payments that settle them.
function balancesHTML(trip, bal) {
  const cur = tripCurrency(trip);
  const people = tripPeople(trip);
  const largest = Math.max(1, ...[...bal.values()].map(Math.abs));
  const paid = new Map();
  for (const c of trip.costs || []) if (c.kind !== 'transfer') paid.set(c.paidBy, (paid.get(c.paidBy) || 0) + costInTrip(c, trip));
  const guest = id => !memberUid(id) && id !== myPersonId(trip);
  const rows = people.map((p) => {
    const n = bal.get(p.id) || 0;
    const inner = `
      ${personBadge(trip, p.id)}
      <span class="row-text"><span class="row-title">${esc(personLabel(trip, p.id))}</span>
        <span class="row-sub">${T('Paid {amount}', { amount: esc(fmtMoney(paid.get(p.id) || 0, cur)) })}</span></span>
      <span class="bal-amount ${n > 0 ? 'plus' : n < 0 ? 'minus' : ''}">${n > 0 ? '+' : n < 0 ? '−' : ''}${esc(fmtMoney(Math.abs(n), cur))}
        <i class="bal-bar" style="--w:${Math.round(Math.abs(n) / largest * 100)}%"></i></span>`;
    return `<li>${guest(p.id)
      ? `<button type="button" class="bal-row ripple" data-action="edit-person" data-id="${esc(p.id)}" aria-label="${T('Edit {name}', { name: esc(personLabel(trip, p.id)) })}">${inner}</button>`
      : `<div class="bal-row">${inner}</div>`}</li>`;
  }).join('');
  const pay = settleUp(bal);
  const me = myPersonId(trip);
  return `
    <ul class="group balances">${rows}</ul>
    <button type="button" class="btn text ripple add-person" data-action="add-person">${icon('person_add')}${T('Add someone')}</button>
    <h2 class="group-label">${T('How to settle up')}</h2>
    ${pay.length ? `
      <ul class="group settle">${pay.map(p => `
        <li class="settle-row">
          <span class="row-text"><span class="row-title">${p.from === me ? T('You pay {name}', { name: esc(personLabel(trip, p.to)) })
            : p.to === me ? T('{name} pays you', { name: esc(personLabel(trip, p.from)) })
            : T('{from} pays {to}', { from: esc(personLabel(trip, p.from)), to: esc(personLabel(trip, p.to)) })}</span>
            <span class="row-sub">${esc(fmtMoney(p.amount, cur))}</span></span>
          <button type="button" class="btn tonal sm ripple" data-action="settle" data-from="${esc(p.from)}" data-to="${esc(p.to)}" data-amount="${p.amount}">${icon('check')}${T('Paid')}</button>
        </li>`).join('')}
      </ul>
      <p class="supporting">${T('Tap Paid once the money is given: it goes in the list, and the balances go back to zero.')}</p>`
    : `<p class="supporting">${icon('check', 'sm')} ${T('Everyone is square.')}</p>`}`;
}

/* ---------- The expense sheet ---------- */

const costFields = () => costForm.elements;
const formKind = () => costFields().kind.value;
const formHow = () => costFields().how.value;
const formCur = () => costFields().cur.value;

// The rate field says how much 1 of the trip's currency is in the expense's ("1 EUR = 162.4 JPY": how
// travellers think of it). The expense keeps the other way round: what 1 JPY is in euros. null when not a number.
function readRate(text) {
  const n = Number(String(text || '').replace(/\s/g, '').replace(',', '.'));
  return n > 0 && Number.isFinite(n) ? 1 / n : null;
}
const rateText = r => {
  const s = String(Number(r.toPrecision(6)));
  return LANG === 'fr' ? s.replace('.', ',') : s;
};

function openCostForm(cost, preset = {}) {
  const trip = activeTrip();
  if (!trip) return;
  editingCostId = cost ? cost.id : null;
  const f = costFields();
  const me = myPersonId(trip);
  const kind = cost ? cost.kind : preset.kind || 'cost';
  const lastCur = (trip.costs || []).slice().sort((a, b) => b.at - a.at).map(c => c.cur)[0];
  const cur = cost ? cost.cur : lastCur || tripCurrency(trip);
  $('#cost-dialog-title').textContent = cost ? (kind === 'transfer' ? T('Money given back') : T('Edit expense')) : T('New expense');
  f.title.value = cost ? cost.title : '';
  f.amount.value = cost ? amountText(cost.amount, cost.cur) : '';
  f.cur.innerHTML = currencyOptions(trip, cur);
  f.cur.value = cur;
  f.rate.value = cost && cost.cur !== tripCurrency(trip) ? rateText(1 / cost.rate) : '';
  f.rate.dataset.kept = cost ? cost.cur : '';
  f.date.value = cost ? cost.date : todayISO();
  f.kind.value = kind;
  f.how.value = cost ? cost.how : 'equal';
  costForm.dataset.split = JSON.stringify(cost ? cost.split : null);
  fillPeopleFields(trip, cost ? cost.paidBy : me);
  showCostKind();
  $('#cost-delete').hidden = !cost;
  costDialog.showModal();
  draftStart(costDialog);
  loadRates().then(() => { if (costDialog.open) showRate(); });
  if (!cost) setTimeout(() => f.amount.focus(), 50);
}

// "Paid by" (or "From"), and the list of who it is for, with the people of the trip.
function fillPeopleFields(trip, paidBy) {
  const f = costFields();
  const people = tripPeople(trip);
  f.paidBy.innerHTML = people.map(p => `<option value="${esc(p.id)}">${esc(personLabel(trip, p.id))}</option>`).join('');
  f.paidBy.value = people.some(p => p.id === paidBy) ? paidBy : myPersonId(trip);
  drawSplit();
}

// Expense or money given back: the same sheet, with other words.
function showCostKind() {
  const transfer = formKind() === 'transfer';
  for (const b of costForm.querySelectorAll('[data-action="cost-kind"]')) b.setAttribute('aria-pressed', String(b.dataset.kind === formKind()));
  for (const b of costForm.querySelectorAll('[data-action="split-how"]')) b.setAttribute('aria-pressed', String(b.dataset.how === formHow()));
  $('#cost-title-field').hidden = transfer;
  $('#cost-paid-label').textContent = transfer ? T('From') : T('Paid by');
  $('#cost-for-label').textContent = transfer ? T('To') : T('For whom');
  costForm.querySelector('.split-how').hidden = transfer;
  showRate();
  drawSplit();
}

// The rate, when the expense isn't in the trip's currency: today's, or the one it was saved with.
function showRate() {
  const trip = activeTrip();
  if (!trip) return;
  const f = costFields();
  const cur = formCur();
  const to = tripCurrency(trip);
  const box = $('#cost-rate');
  box.hidden = cur === to;
  if (box.hidden) return;
  $('#cost-rate-label').textContent = T('1 {to} in {cur}', { cur, to });
  // A rate typed or saved for this currency stays; another currency starts from today's.
  if (f.rate.dataset.kept !== cur) {
    const r = rateFor(to, cur);
    f.rate.value = r ? rateText(r) : '';
    f.rate.dataset.kept = r ? cur : '';
  }
  const rate = readRate(f.rate.value);
  const amount = parseAmount(f.amount.value, cur);
  const note = [];
  if (rate && amount) note.push(T('= {amount}', { amount: esc(fmtMoney(costInTrip({ amount, cur, rate }, trip), to)) }));
  if (!rate) note.push(navigator.onLine ? T('Finding today’s rate… You can also type it.') : T('Offline: type the rate.'));
  else if (rates.saved && f.rate.dataset.kept === cur && !editingCostId) note.push(T('Rate of {day}.', { day: esc(fmtDay(rates.saved.date, { month: 'short', day: 'numeric' })) }));
  $('#cost-rate-note').innerHTML = note.join(' ');
}

// Who the expense is for: everyone ticked, each with their part (a field for it "By amounts", and − / + for
// their number of shares "By shares"). Money given back goes to one person.
const MAX_SHARES = 99;
function drawSplit() {
  const trip = activeTrip();
  if (!trip) return;
  const f = costFields();
  const cur = formCur();
  const people = tripPeople(trip);
  const transfer = formKind() === 'transfer';
  const byAmounts = !transfer && formHow() === 'amounts';
  const byShares = !transfer && formHow() === 'shares';
  // What the list showed before (kept while it is drawn again), else what the expense had, else everyone.
  const was = JSON.parse(costForm.dataset.split || 'null');
  const ticked = id => (was ? id in was : true);
  const amount = parseAmount(f.amount.value, cur) || 0;
  let rows;
  if (transfer) {
    const to = was && Object.keys(was)[0];
    const pick = people.find(p => p.id === to && p.id !== f.paidBy.value) || people.find(p => p.id !== f.paidBy.value);
    rows = people.map(p => `
      <li><label class="split-row">
        <input type="radio" name="to" value="${esc(p.id)}" ${pick && p.id === pick.id ? 'checked' : ''} ${p.id === f.paidBy.value ? 'disabled' : ''}>
        ${personBadge(trip, p.id)}<span class="split-name">${esc(personLabel(trip, p.id))}</span>
      </label></li>`);
  } else {
    const sharesOf = id => (byShares && was && Number.isSafeInteger(was[id]) && was[id] > 0 ? Math.min(was[id], MAX_SHARES) : 1);
    const weights = Object.fromEntries(people.filter(p => ticked(p.id)).map(p => [p.id, sharesOf(p.id)]));
    const parts = shareOut(amount, weights);
    rows = people.map((p) => {
      const on = ticked(p.id);
      const name = esc(personLabel(trip, p.id));
      const typed = was && byAmounts && was[p.id] ? amountText(was[p.id], cur) : '';
      const share = `<span class="split-share">${on && amount ? esc(fmtMoney(parts.get(p.id) || 0, cur)) : ''}</span>`;
      const n = sharesOf(p.id);
      return `
        <li><label class="split-row">
          <input type="checkbox" name="for" value="${esc(p.id)}" ${on ? 'checked' : ''}>
          ${personBadge(trip, p.id)}${byShares
            ? `<span class="split-name two-lines"><span>${name}</span><small>${on && amount ? esc(fmtMoney(parts.get(p.id) || 0, cur)) : ''}</small></span>`
            : `<span class="split-name">${name}</span>`}
          ${byAmounts
            ? `<input class="split-part" name="part_${esc(p.id)}" inputmode="decimal" autocomplete="off" value="${esc(typed)}" ${on ? '' : 'disabled'} aria-label="${T('Part of {name}', { name })}">`
            : byShares ? `
              <span class="share-step" role="group" aria-label="${T('Shares of {name}', { name })}">
                <button type="button" class="icon-btn ripple" data-action="share-step" data-id="${esc(p.id)}" data-step="-1" ${on && n > 1 ? '' : 'disabled'} aria-label="${T('One share less')}">−</button>
                <b aria-live="polite">${on ? n : 0}</b>
                <button type="button" class="icon-btn ripple" data-action="share-step" data-id="${esc(p.id)}" data-step="1" ${on && n < MAX_SHARES ? '' : 'disabled'} aria-label="${T('One share more')}">+</button>
                <input type="hidden" name="share_${esc(p.id)}" value="${n}">
              </span>`
            : share}
        </label></li>`;
    });
  }
  $('#cost-split').innerHTML = rows.join('');
  splitNote();
}

// Under the list: what is left to share out "By amounts".
function splitNote() {
  const note = $('#cost-split-note');
  note.textContent = '';
  if (formKind() === 'transfer' || formHow() !== 'amounts') return;
  const cur = formCur();
  const amount = parseAmount(costFields().amount.value, cur) || 0;
  const typed = [...costForm.querySelectorAll('.split-part:not(:disabled)')].reduce((s, el) => s + (parseAmount(el.value, cur) || 0), 0);
  const left = amount - typed;
  if (!amount) return;
  note.textContent = left > 0 ? T('{amount} left to share out', { amount: fmtMoney(left, cur) })
    : left < 0 ? T('{amount} too much', { amount: fmtMoney(-left, cur) }) : T('All shared out');
  note.classList.toggle('bad', left !== 0);
}

// What the list holds now, kept while it is drawn again (another currency, someone added).
function keepSplit() {
  const cur = formCur();
  if (formKind() === 'transfer') {
    const to = costForm.querySelector('[name="to"]:checked');
    costForm.dataset.split = JSON.stringify(to ? { [to.value]: 1 } : {});
    return;
  }
  const out = {};
  for (const box of costForm.querySelectorAll('[name="for"]:checked')) {
    const part = costForm.querySelector(`[name="part_${CSS.escape(box.value)}"]`);
    const shares = costForm.querySelector(`[name="share_${CSS.escape(box.value)}"]`);
    out[box.value] = part ? parseAmount(part.value, cur) || 0 : shares ? Number(shares.value) || 1 : 1;
  }
  costForm.dataset.split = JSON.stringify(out);
}

costForm.addEventListener('input', (e) => {
  const name = e.target.name || '';
  if (name === 'amount' || name === 'rate') { showRate(); if (formHow() !== 'amounts' || formKind() === 'transfer') { keepSplit(); drawSplit(); } else splitNote(); }
  if (name.startsWith('part_')) splitNote();
});
costForm.addEventListener('change', (e) => {
  const name = e.target.name || '';
  if (name === 'cur') { keepSplit(); showRate(); drawSplit(); }
  if (name === 'for' || name === 'paidBy' || name === 'to') { keepSplit(); drawSplit(); }
});

// What the sheet says, as an expense. Or a message saying what is missing.
function readCostForm(trip) {
  const f = costFields();
  const cur = formCur();
  const amount = parseAmount(f.amount.value, cur);
  if (!amount) return { error: T('Type the amount') };
  let rate = 1;
  if (cur !== tripCurrency(trip)) {
    rate = readRate(f.rate.value);
    if (!rate) return { error: T('Type the rate') };
  }
  const paidBy = f.paidBy.value;
  let split = {};
  let how = 'equal';
  if (formKind() === 'transfer') {
    const to = costForm.querySelector('[name="to"]:checked');
    if (!to || to.value === paidBy) return { error: T('Pick who gets the money') };
    split = { [to.value]: 1 };
  } else {
    const boxes = [...costForm.querySelectorAll('[name="for"]:checked')];
    if (!boxes.length) return { error: T('Pick who it is for') };
    if (formHow() === 'amounts') {
      how = 'amounts';
      for (const box of boxes) {
        const part = parseAmount(costForm.querySelector(`[name="part_${CSS.escape(box.value)}"]`).value, cur);
        if (part) split[box.value] = part;
      }
      const sum = Object.values(split).reduce((s, n) => s + n, 0);
      if (sum !== amount) return { error: T('The parts must add up to {amount}', { amount: fmtMoney(amount, cur) }) };
    } else if (formHow() === 'shares') {
      how = 'shares';
      for (const box of boxes) {
        const n = Number(costForm.querySelector(`[name="share_${CSS.escape(box.value)}"]`).value);
        split[box.value] = Number.isSafeInteger(n) && n >= 1 ? Math.min(n, MAX_SHARES) : 1;
      }
    } else {
      split = Object.fromEntries(boxes.map(b => [b.value, 1]));
    }
  }
  return {
    cost: {
      title: formKind() === 'transfer' ? '' : f.title.value.trim().slice(0, 80),
      amount, cur, rate, paidBy, split, how,
      date: isDate(f.date.value) ? f.date.value : '',
      kind: formKind() === 'transfer' ? 'transfer' : 'cost',
    },
  };
}

costForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const trip = activeTrip();
  if (!trip) return;
  const { cost, error } = readCostForm(trip);
  if (error) { snackbar(error); return; }
  keepPeople(trip, [cost.paidBy, ...Object.keys(cost.split)]);
  trip.costs = trip.costs || [];
  const old = editingCostId && trip.costs.find(c => c.id === editingCostId);
  if (old) Object.assign(old, cost);
  else trip.costs.push({ id: uid(), ...cost, at: Date.now() });
  save();
  costDialog.close();
  ui.moneyTab = ui.moneyTab || 'costs';
  if (ui.view === 'money') render(); else showView('money');
});

$('#cost-delete').addEventListener('click', () => {
  const trip = activeTrip();
  const cost = trip && (trip.costs || []).find(c => c.id === editingCostId);
  if (!cost) return;
  const at = trip.costs.indexOf(cost);
  trip.costs.splice(at, 1);
  save();
  costDialog.close();
  render();
  snackbar(cost.kind === 'transfer' ? T('Payment deleted') : T('Expense deleted'), T('Undo'), () => {
    if (!state.trips.includes(trip)) return;
    trip.costs = trip.costs || [];
    trip.costs.splice(Math.min(at, trip.costs.length), 0, cost);
    save();
    render();
  });
});

/* ---------- Someone without the app ---------- */

function openPersonForm(person) {
  const trip = activeTrip();
  if (!trip) return;
  editingPersonId = person ? person.id : null;
  $('#person-dialog-title').textContent = person ? T('Edit name') : T('Add someone');
  $('#person-text').hidden = !!person;
  personForm.elements.name.value = person ? person.name : '';
  // Only someone no expense names can be taken off.
  $('#person-delete').hidden = !person || personUsed(trip, person.id);
  personDialog.showModal();
  personForm.elements.name.focus();
}

personForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const trip = activeTrip();
  const name = tidyName(personForm.elements.name.value);
  if (!trip || !name) { personForm.elements.name.focus(); return; }
  let id = editingPersonId;
  if (id) {
    const p = (trip.people || []).find(x => x.id === id);
    if (p) p.name = name;
  } else {
    id = addGuest(trip, name).id;
  }
  save();
  personDialog.close();
  if (peopleDialog.open) drawPeople();
  // Added from the expense sheet: they are ticked in it, as everyone else.
  if (costDialog.open) {
    keepSplit();
    const split = JSON.parse(costForm.dataset.split || '{}');
    if (!editingPersonId && formKind() !== 'transfer') { split[id] = formHow() === 'amounts' ? 0 : 1; costForm.dataset.split = JSON.stringify(split); }
    fillPeopleFields(trip, costFields().paidBy.value);
  }
  render();
});

$('#person-delete').addEventListener('click', () => {
  const trip = activeTrip();
  if (!trip || !editingPersonId || personUsed(trip, editingPersonId)) return;
  trip.people = (trip.people || []).filter(p => p.id !== editingPersonId);
  save();
  personDialog.close();
  if (peopleDialog.open) drawPeople();
  render();
});

/* ---------- Everyone who shares the costs ---------- */

const peopleDialog = $('#people-dialog');

// Someone the app decides about: you, and the people on a shared trip (their name is their own, from Settings).
// Everyone else (a guest, someone who has left the trip) can be renamed, and removed while no expense names them.
function fixedPerson(trip, id) {
  if (id === myPersonId(trip)) return true;
  const root = shareOf(trip);
  return !!root && root.members.some(m => memberId(m.uid) === id);
}

function drawPeople() {
  const trip = activeTrip();
  if (!trip) return;
  const me = myPersonId(trip);
  $('#people-text').textContent = trip.shared
    ? T('Everyone on the trip is here. Add anyone else by name, even without the app.')
    : T('Add the people you travel with, even without the app: you add what they pay.');
  $('#people-list').innerHTML = tripPeople(trip).map((p) => {
    const used = (trip.costs || []).filter(c => c.paidBy === p.id || p.id in c.split).length;
    const fixed = fixedPerson(trip, p.id);
    const sub = p.id === me ? T('That’s you') : fixed ? T('On the trip')
      : used ? Tn(used, 'In {n} expense', 'In {n} expenses') : T('In no expense yet');
    const name = esc(personLabel(trip, p.id));
    return `
      <li class="person-row">
        ${personBadge(trip, p.id)}
        <span class="row-text"><span class="row-title">${name}</span><span class="row-sub">${sub}</span></span>
        ${fixed ? '' : `
          <button type="button" class="icon-btn ripple" data-action="edit-person" data-id="${esc(p.id)}" aria-label="${T('Rename {name}', { name })}" title="${T('Rename {name}', { name })}">${icon('edit')}</button>
          <button type="button" class="icon-btn ripple" data-action="remove-person" data-id="${esc(p.id)}" aria-label="${T('Remove {name}', { name })}" title="${T('Remove {name}', { name })}">${icon('delete')}</button>`}
      </li>`;
  }).join('');
}

function openPeople() {
  if (!activeTrip()) return;
  drawPeople();
  peopleDialog.showModal();
}

/* ---------- The currency of the totals ---------- */

const currencyDialog = $('#currency-dialog');
const currencyForm = $('#currency-form');

function openCurrency() {
  const trip = activeTrip();
  if (!trip) return;
  const cur = tripCurrency(trip);
  const f = currencyForm.elements;
  f.cur.innerHTML = currencyOptions(trip, cur);
  f.cur.value = cur;
  f.rate.value = '';
  f.rate.dataset.kept = '';
  $('#currency-text').textContent = (trip.costs || []).length
    ? T('Totals and balances are shown in it. Each expense keeps its own amount, converted at today’s rate.')
    : T('Totals and balances are shown in it.');
  showCurrencyRate();
  currencyDialog.showModal();
  loadRates().then(() => { if (currencyDialog.open) showCurrencyRate(); });
}

// With expenses, a new currency needs today's rate from the old one ("1 EUR in JPY": 162.4). It can be typed.
function showCurrencyRate() {
  const trip = activeTrip();
  if (!trip) return;
  const f = currencyForm.elements;
  const from = tripCurrency(trip);
  const to = f.cur.value;
  const box = $('#currency-rate');
  box.hidden = to === from || !(trip.costs || []).length;
  if (box.hidden) return;
  $('#currency-rate-label').textContent = T('1 {to} in {cur}', { to: from, cur: to });
  if (f.rate.dataset.kept !== to) {
    const r = rateFor(from, to);
    f.rate.value = r ? rateText(r) : '';
    f.rate.dataset.kept = r ? to : '';
  }
  $('#currency-rate-note').textContent = readRate(f.rate.value) ? ''
    : navigator.onLine ? T('Finding today’s rate… You can also type it.') : T('Offline: type the rate.');
}
currencyForm.addEventListener('change', (e) => { if (e.target.name === 'cur') showCurrencyRate(); });
currencyForm.addEventListener('input', (e) => { if (e.target.name === 'rate') showCurrencyRate(); });

currencyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const trip = activeTrip();
  const f = currencyForm.elements;
  const to = f.cur.value;
  if (!trip || !isCurrency(to)) return;
  if (to === tripCurrency(trip)) { currencyDialog.close(); return; }
  let undo;
  if ((trip.costs || []).length) {
    const back = readRate(f.rate.value);        // what 1 of the new is in the old one
    if (!back) { snackbar(T('Type the rate')); return; }
    undo = changeTripCurrency(trip, to, 1 / back);
  } else {
    undo = changeTripCurrency(trip, to, 1);
  }
  save();
  currencyDialog.close();
  render();
  snackbar(T('Totals in {cur}', { cur: currencyName(to) }), T('Undo'), () => {
    if (!state.trips.includes(trip)) return;
    undo();
    save();
    render();
  });
});

/* ---------- Taps ---------- */

onAction('money-tab', (el) => {
  ui.moneyTab = el.dataset.tab;
  render();
});
onAction('edit-cost', (el) => {
  const trip = activeTrip();
  const cost = trip && (trip.costs || []).find(c => c.id === el.dataset.id);
  if (cost) openCostForm(cost);
});
onAction('cost-kind', (el) => {
  keepSplit();
  if (formKind() !== el.dataset.kind) costForm.dataset.split = 'null';
  costFields().kind.value = el.dataset.kind;
  showCostKind();
});
onAction('split-how', (el) => {
  keepSplit();
  // To amounts: each ticked person starts empty, to be typed. Otherwise one share each.
  const was = JSON.parse(costForm.dataset.split || 'null');
  if (was && el.dataset.how !== formHow()) for (const k of Object.keys(was)) was[k] = el.dataset.how === 'amounts' ? 0 : 1;
  costForm.dataset.split = JSON.stringify(was);
  costFields().how.value = el.dataset.how;
  showCostKind();
});
// − and + "By shares": one share less or more for that person (1 at least: untick them to leave them out).
onAction('share-step', (el) => {
  keepSplit();
  const split = JSON.parse(costForm.dataset.split || '{}');
  const id = el.dataset.id;
  if (!(id in split)) return;
  split[id] = Math.max(1, Math.min(MAX_SHARES, (split[id] || 1) + Number(el.dataset.step)));
  costForm.dataset.split = JSON.stringify(split);
  drawSplit();
  const again = costForm.querySelector(`[data-action="share-step"][data-id="${CSS.escape(id)}"][data-step="${el.dataset.step}"]`);
  if (again && !again.disabled) again.focus();
});
onAction('add-person', () => openPersonForm(null));
onAction('edit-person', (el) => {
  const trip = activeTrip();
  const p = trip && (trip.people || []).find(x => x.id === el.dataset.id);
  if (p) openPersonForm(p);
});
// "Paid", under How to settle up: the payment goes in as money given back, with Undo.
onAction('settle', (el) => {
  const trip = activeTrip();
  const amount = Number(el.dataset.amount);
  if (!trip || !Number.isSafeInteger(amount) || amount <= 0) return;
  const cost = addTransfer(trip, { from: el.dataset.from, to: el.dataset.to, amount });
  save();
  render();
  snackbar(T('Marked as paid'), T('Undo'), () => {
    trip.costs = (trip.costs || []).filter(c => c !== cost);
    save();
    render();
  });
});

onAction('money-people', () => openPeople());
onAction('money-currency', () => openCurrency());
// Removing someone from the People sheet, with Undo. Not while an expense names them: it would no longer add up.
onAction('remove-person', (el) => {
  const trip = activeTrip();
  const person = trip && (trip.people || []).find(p => p.id === el.dataset.id);
  if (!person || fixedPerson(trip, person.id)) return;
  const used = (trip.costs || []).filter(c => c.paidBy === person.id || person.id in c.split).length;
  const name = personLabel(trip, person.id);
  if (used) { snackbar(Tn(used, '{name} is in {n} expense: change or delete it first.', '{name} is in {n} expenses: change or delete them first.', { name })); return; }
  const at = trip.people.indexOf(person);
  trip.people.splice(at, 1);
  save();
  drawPeople();
  render();
  snackbar(T('{name} removed', { name }), T('Undo'), () => {
    if (!state.trips.includes(trip)) return;
    trip.people = trip.people || [];
    trip.people.splice(Math.min(at, trip.people.length), 0, person);
    save();
    if (peopleDialog.open) drawPeople();
    render();
  });
});
