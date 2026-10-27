'use strict';

/* Screen snapshots, for changes that must not change what is on screen (moving code around, tidying the
   stylesheets). Records, for each section, the HTML it draws and the computed style of every element in
   the page (pseudo-elements included), then compares a later run with it. Kept in localStorage
   ("snapshot.<name>.<width>"): both runs need the same address, so the same saved data.

   The code as it was can be served next to the new one, at the same address (so with the same data):
     git archive HEAD | tar -x -C _old        (from the project folder; _old/ is ignored by git locally)
   Then, in the browser's console, at each window width to check (resize the window between widths):
     on /_old/index.html:  await loadScript('/tools/snapshot.js'); await snapshot.record('before')
     on /:                 await loadScript('/tools/snapshot.js'); await snapshot.compare('before')
     back on /_old/ when styles differ:   await snapshot.explain('before')   (which properties, old → new)
   The saved plans must be the same for both runs: copy the tripPlanner.* keys first, put them back before
   each run. The screens are drawn at a fixed moment (snapshot.at), so the clock doesn't change them. */

const snapshot = (() => {
  // The sections, and the Ideas tab's two halves.
  const SCREENS = [['plan'], ['ideas', 'mine'], ['ideas', 'explore'], ['pack'], ['more']];

  const hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  };
  // An element's computed style, with its ::before and ::after when they are drawn.
  const styleOf = (el) => {
    const out = {};
    for (const pseudo of ['', '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo || null);
      if (pseudo && /^(none|normal)$/.test(cs.content)) continue;
      for (let i = 0; i < cs.length; i++) out[pseudo + cs[i]] = cs.getPropertyValue(cs[i]);
    }
    return out;
  };
  const styleText = el => Object.entries(styleOf(el)).map(([k, v]) => `${k}:${v}`).join(';');
  const label = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].join('.') : '');
  // Every element on the page, except scripts (they draw nothing, and a code change may add files), the
  // sections not on screen (they keep what they last drew) and the box Firebase adds for App Check
  // (whenever it gets to it).
  const elements = () => [document.documentElement, document.body, ...document.body.querySelectorAll(':not(script)')]
    .filter(el => !el.closest('[id^="fire_app_check"], .view[hidden]'));
  // The section on screen, the sidebar's extras, the day strip and the trip tabs.
  const pageHTML = () => [[...document.querySelector('#main').children].filter(c => !c.hidden).map(c => c.outerHTML).join(''),
    ...['#side-extra', '#day-strip', '#trip-tabs'].map(s => (document.querySelector(s) || {}).innerHTML || '')].join('\n<!-- -->\n');

  // Draws each screen at a fixed moment, and runs fn(screen) on it.
  async function each(fn) {
    const was = { view: ui.view, tab: ui.ideasTab };
    const RealDate = Date;
    const at = new RealDate(snapshot.at).getTime();
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [at])); }
      static now() { return at; }
    };
    const out = {};
    try {
      for (const [view, tab] of SCREENS) {
        if (tab) ui.ideasTab = tab;
        showView(view, { top: true });      // drawn at once (no timer: a hidden window runs them late)
        const screen = view + (tab ? ':' + tab : '');
        out[screen] = fn(screen);
      }
    } finally {
      window.Date = RealDate;
    }
    ui.ideasTab = was.tab;
    showView(was.view, { top: true });
    return out;
  }

  const key = name => `snapshot.${name}.${innerWidth}`;
  const load = k => JSON.parse(localStorage.getItem(k) || 'null');

  async function record(name) {
    // The whole HTML is kept at one width only (to show where it differs), a code for it at the others.
    const full = !Object.keys(localStorage).some(k => k.startsWith(`snapshot.${name}.`) && !k.startsWith(key(name)));
    const shots = await each(() => {
      const html = pageHTML();
      return { [full ? 'html' : 'htmlHash']: full ? html : hash(html), styles: elements().map(el => hash(styleText(el))).join(' ') };
    });
    localStorage.setItem(key(name), JSON.stringify(shots));
    return `Recorded ${Object.keys(shots).length} screens at ${innerWidth}px as "${name}"`;
  }

  async function compare(name) {
    const saved = load(key(name));
    if (!saved) return `Nothing recorded as "${name}" at ${innerWidth}px`;
    const report = [];
    const odd = [];       // the elements that look different, with their style now (for explain)
    await each((screen) => {
      const was = saved[screen];
      if (!was) { report.push(`${screen}: not recorded`); return; }
      const html = pageHTML();
      if (was.htmlHash && was.htmlHash !== hash(html)) {
        report.push(`${screen}: HTML differs (compare at the width recorded first to see where)`);
      } else if (was.html !== undefined && was.html !== html) {
        let i = 0;
        while (i < was.html.length && was.html[i] === html[i]) i++;
        report.push(`${screen}: HTML differs at ${i}\n  before: ${was.html.slice(Math.max(0, i - 80), i + 120)}\n  after:  ${html.slice(Math.max(0, i - 80), i + 120)}`);
      }
      const before = was.styles.split(' ');
      const els = elements();
      if (before.length !== els.length) { report.push(`${screen}: ${before.length} elements before, ${els.length} now`); return; }
      const diff = els.map((el, k) => (hash(styleText(el)) === before[k] ? -1 : k)).filter(k => k >= 0);
      if (!diff.length) return;
      report.push(`${screen}: style differs on ${diff.length} element(s): ${diff.slice(0, 12).map(k => label(els[k])).join(', ')}${diff.length > 12 ? '…' : ''}`);
      for (const k of diff.slice(0, 40)) odd.push({ screen, k, label: label(els[k]), style: styleOf(els[k]) });
    });
    localStorage.setItem(key(name) + '.odd', JSON.stringify(odd));
    return report.length ? report.join('\n') : `Same as "${name}" at ${innerWidth}px: ${SCREENS.length} screens`;
  }

  // On the old code, after compare() found elements that look different: what differs, old → new.
  async function explain(name) {
    const odd = load(key(name) + '.odd') || [];
    if (!odd.length) return 'Nothing to explain: compare() found no style differences at this width.';
    const lines = new Map();      // what differs → the screens it was seen on
    await each((screen) => {
      const els = elements();
      for (const o of odd.filter(x => x.screen === screen)) {
        const was = styleOf(els[o.k]);
        // Longhands repeat their shorthand's change (border-color → border-top-color…): one of each is enough.
        const props = [...new Set([...Object.keys(was), ...Object.keys(o.style)])].filter(p => was[p] !== o.style[p])
          .filter(p => !/-(block|inline)-(start|end)|-(top|right|bottom|left)-/.test(p) || /^(::\w+)?(top|left|right|bottom|margin|padding)/.test(p));
        const line = `${o.label}: ${props.slice(0, 6).map(p => `${p}: ${was[p]} → ${o.style[p]}`).join('; ')}`;
        lines.set(line, [...(lines.get(line) || []), screen]);
      }
    });
    return [...lines].map(([line, screens]) => `${line}  [${screens.join(', ')}]`).join('\n');
  }

  return { record, compare, explain, at: '2026-10-27T13:00' };
})();
