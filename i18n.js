'use strict';

/* Languages. The app is written in English: every text on screen goes through T() (or Tn() when it
   depends on a number), and is looked up in the dictionary of the language in use (lang/fr.js…).
   A text missing from a dictionary simply shows in English.

   Rules for the texts:
   - T()'s first argument is always one plain '…' text, never built from pieces: the dictionaries are
     checked against the code (self-check, "Every text has a translation").
   - Names, numbers and dates go in with {name}: T('Add to {day}', { day }). They are put in as they
     are, so anything a user typed still goes through esc() first.
   - To add a language: a file lang/xx.js filling DICTS.xx, its name in LANGS, the file in index.html
     and in sw.js's FILES, and its date and number style in LOCALES. */

const LANGS = { en: 'English', fr: 'Français' };
const LOCALES = { en: '', fr: 'fr-FR' };     // '' = English: the date order and clock settings decide
const DICTS = {};

// The language chosen in Settings → Appearance, else the device's own when the app has it, else English.
// It is read before anything is drawn (like theme.js), and changing it reloads the app.
function pickLang() {
  try {
    const saved = JSON.parse(localStorage.getItem('tripPlanner.v1'));
    const lang = saved && saved.settings && saved.settings.lang;
    if (LANGS[lang]) return lang;
  } catch { /* nothing saved yet */ }
  return deviceLang();
}
function deviceLang() {
  for (const l of navigator.languages || [navigator.language || '']) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (LANGS[code]) return code;
  }
  return 'en';
}
let LANG = pickLang();
document.documentElement.lang = LANG;

// A text in the language in use. vars fill its {names}.
function T(text, vars) {
  const dict = DICTS[LANG];
  let out = (dict && dict[text]) || text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

// A text that depends on a number: Tn(3, '{n} plan', '{n} plans'). French says "0 plan", English "0 plans".
const pluralRules = {};
function Tn(n, one, many, vars) {
  const rule = pluralRules[LANG] || (pluralRules[LANG] = new Intl.PluralRules(LANG));
  return T(rule.select(n) === 'one' ? one : many, { n, ...vars });
}

// Numbers with decimals: "2.5" or "2,5".
const fmtNum = (v, dec = 1) => {
  const s = typeof v === 'number' ? v.toFixed(dec) : String(v);
  return LANG === 'fr' ? s.replace('.', ',') : s;
};

// The page's own texts (index.html) are written in English too: they are swapped once at startup.
// An element marked data-i18n is taken whole (its text has <b> or <a> inside).
function translatePage(root = document.body) {
  if (!DICTS[LANG]) return;
  const swap = s => {
    const key = s.trim().replace(/\s+/g, ' ');
    return key && DICTS[LANG][key] ? s.replace(/\S[\s\S]*\S|\S/, T(key)) : s;
  };
  for (const el of root.querySelectorAll('[data-i18n]')) el.innerHTML = swap(el.innerHTML);
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.parentElement.closest('[data-i18n], script, style')) n.nodeValue = swap(n.nodeValue);
  }
  for (const attr of ['aria-label', 'title', 'placeholder']) {
    for (const el of root.querySelectorAll(`[${attr}]`)) el.setAttribute(attr, swap(el.getAttribute(attr)));
  }
}
