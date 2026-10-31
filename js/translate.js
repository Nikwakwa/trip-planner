'use strict';

/* =========================================================
   Texts other people wrote, in the app's language. The travel guide (Wikivoyage), Wikipedia and the
   Essentials tips are read in English (guide place names are English, and the matching relies on them).
   When the app is in another language, each such text is translated as it is shown: tr(text) gives
   the translation saved on the device, or the English text while it is asked for. Gemini Flash-Lite
   (the AI Assistant's lighter model, free tier) translates a few dozen texts in one request.
   Offline, or without the AI (no Firebase settings), the English text stays.
   Functions here also use the screen's files (ui.js … app.js), which load after this one.
   ========================================================= */

const TRANSLATIONS_KEY = 'tripPlanner.translations';
const TRANSLATIONS_MAX = 2500;      // texts kept on the device, the least recently shown go first
const TRANSLATE_BATCH = 5000;       // characters asked in one request
const TRANSLATE_GAP = 4000;         // between two requests (the free tier allows 15 a minute)
const LANG_NAMES = { fr: 'French' };

const translations = {
  saved: (() => { try { return JSON.parse(localStorage.getItem(TRANSLATIONS_KEY)) || {}; } catch { return {}; } })(),
  queue: new Map(),       // key → English text waiting to be asked
  asking: new Set(),      // keys in the request on its way
  failed: new Set(),      // asked this visit and not answered well: English stays
  retryAt: 0,
  stopped: '',            // the day the free allowance ran out, or 'visit' when the AI can't be used
  timer: 0,
};

// A text's key: its language, length and a short fingerprint (FNV-1a).
function textKey(text, lang) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${lang}:${text.length}:${(h >>> 0).toString(36)}`;
}

// The text in the app's language when its translation is on the device; else the text itself,
// and the translation is asked for.
function tr(text) {
  if (typeof text !== 'string' || !text.trim() || LANG === 'en') return text || '';
  const key = textKey(text, LANG);
  const had = translations.saved[key];
  if (had) {
    if (Date.now() - had[1] > 864e5) had[1] = Date.now();        // still in use: kept longer
    return had[0];
  }
  askTranslation(key, text);
  return text;
}

// Is this text being translated? (a sheet says so meanwhile)
const translating = text => LANG !== 'en' && !!text && [translations.queue, translations.asking].some(s => s.has(textKey(text, LANG)));

// A line under translated texts.
const translatedNote = () => (LANG !== 'en' && aiReady() ? `<p class="footnote">${icon('translate', 'sm')}${T('Descriptions translated automatically from English.')}</p>` : '');

function askTranslation(key, text) {
  if (!aiReady() || translations.failed.has(key) || translations.asking.has(key)) return;
  if (translations.stopped === 'visit' || translations.stopped === todayISO()) return;
  translations.queue.set(key, text);
  if (!translations.timer) translations.timer = setTimeout(sendTranslations, Math.max(300, translations.retryAt - Date.now()));
}

const TRANSLATE_RULES = lang => `You translate short texts from a travel guide into ${LANG_NAMES[lang] || lang}, for people planning a trip.
The input is a JSON array of English texts. Answer {"texts": [...]} with exactly one translation per text, in the same order.
- Translate the meaning faithfully: add nothing, leave nothing out, keep it about as long.
- Keep the names of places, businesses, dishes and people as they are, unless they have a well-known ${LANG_NAMES[lang] || lang} name (Statue of Liberty → statue de la Liberté).
- Keep numbers, prices and currencies as written. Opening hours: write the days and times the ${LANG_NAMES[lang] || lang} way.
- A text that is only a name, an address or a number comes back unchanged.`;

async function sendTranslations() {
  translations.timer = 0;
  if (!translations.queue.size || translations.asking.size) return;
  if (!navigator.onLine) { translations.queue.clear(); return; }      // asked again when shown online
  if (Date.now() < translations.retryAt) {
    translations.timer = setTimeout(sendTranslations, translations.retryAt - Date.now());
    return;
  }
  const lang = LANG;
  // The next texts, up to the batch size (a single long one goes alone).
  const batch = [];
  let size = 0;
  for (const [key, text] of translations.queue) {
    if (batch.length && size + text.length > TRANSLATE_BATCH) break;
    batch.push([key, text]);
    size += text.length;
  }
  for (const [key] of batch) { translations.queue.delete(key); translations.asking.add(key); }
  const body = {
    systemInstruction: { parts: [{ text: TRANSLATE_RULES(lang) }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(batch.map(b => b[1])) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: { texts: { type: 'array', items: { type: 'string' } } }, required: ['texts'] },
      temperature: 0,
    },
  };
  let wait = TRANSLATE_GAP;
  try {
    const got = readTranslations(await callGemini(AI_MODELS[1].id, body), batch.map(b => b[1]));
    batch.forEach(([key], k) => {
      if (got[k]) translations.saved[key] = [got[k], Date.now()];
      else translations.failed.add(key);
      translations.asking.delete(key);       // before the redraw: no "Translating…" left
    });
    saveTranslations();
    translationsArrived();
  } catch (e) {
    console.warn('Translation', e);
    if (e.kind === 'daily') translations.stopped = todayISO();
    else if (e.kind === 'appcheck' || e.kind === 'setup') translations.stopped = 'visit';
    else {
      wait = 2 * 60e3;                                          // busy, or no connection: later
      for (const [key, text] of batch) translations.queue.set(key, text);
    }
  } finally {
    for (const [key] of batch) translations.asking.delete(key);
  }
  translations.retryAt = Date.now() + wait;
  if (translations.stopped) translations.queue.clear();
  else if (translations.queue.size) translations.timer = setTimeout(sendTranslations, wait);
}

// The model's answer → one translation per text asked ('' for one that doesn't look right).
// All of them are dropped when the count doesn't match: they could be shifted.
function readTranslations(answer, asked) {
  let list;
  try { list = JSON.parse(answer).texts; } catch { return asked.map(() => ''); }
  if (!Array.isArray(list) || list.length !== asked.length) return asked.map(() => '');
  return list.map((t, k) => {
    const s = typeof t === 'string' ? t.trim() : '';
    return s && s.length <= asked[k].length * 2 + 40 ? s : '';
  });
}

function saveTranslations() {
  const keys = Object.keys(translations.saved);
  if (keys.length > TRANSLATIONS_MAX) {
    keys.sort((a, b) => translations.saved[a][1] - translations.saved[b][1])
      .slice(0, keys.length - TRANSLATIONS_MAX).forEach((k) => { delete translations.saved[k]; });
  }
  try { localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify(translations.saved)); } catch { /* storage full: kept until the app is closed */ }
}

// New translations: the page and an open sheet show them.
function translationsArrived() {
  renderSoon();
  const sheet = $('#place-dialog');
  if (sheet.open && sheet.redraw) sheet.redraw();
  if ($('#info-dialog').open) renderEssentials();
}
