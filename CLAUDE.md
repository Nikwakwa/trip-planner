# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A trip-planner PWA for phones (the owner uses a Pixel), hosted on GitHub Pages. Plain HTML/CSS/JS:
no framework, no build step, no package manager, no tests, no backend of our own. The README is
written for a non-developer owner, so keep its explanations plain-language when updating it.

## Running it

```powershell
.\serve.ps1                  # http://localhost:8080, sends Cache-Control: no-cache
.\serve.ps1 -MaxAge 600      # mimic GitHub Pages' 10-minute browser caching (to test update flow)
```

There is no build, lint or test command. Check changes by loading the app in a browser at phone size.

Asset scripts (they download from the internet and rewrite files in the repo):
- `tools/fetch-assets.ps1`: re-downloads the font, **regenerates `icons/sprite.svg`** from the icon
  name lists in the script, and refreshes the vendored Firebase/Leaflet builds. To use a new
  Material Symbols icon, add its name to `$outline` or `$filled` there and rerun. Don't edit the sprite by hand.
  Filled variants get the id `<name>-fill`.
- `tools/make-icons.ps1`: redraws the home-screen PNG icons.

## Architecture

**Classic scripts that share one global scope.** `index.html` loads, in this order:
`firebase-config.js` → `guides.js` → `places.js` → `maps.js` → `sync.js` → `app.js`. The files are not
modules. `places.js`, `maps.js` and `sync.js` call helpers defined in `app.js` (`$`, `esc`, `icon`,
`save`, `render`, `snackbar`, `state`, …) at runtime, which works because `app.js` loads last and the calls
happen after startup. Top-level names must stay unique across all files.

**State and rendering (`app.js`).**
- One `state` object (`{ version, activeTripId, trips[{id,name,color,start,end,place,items[]}], checklist[], settings }`)
  is saved as JSON in localStorage under `tripPlanner.v1`. Plans ("items") store dates as `YYYY-MM-DD` strings. An item
  with no date is an "idea".
- `ui` holds temporary view state that isn't saved (current tab/filter).
- After any change, call `save()` then `render()`. `save()` writes localStorage *and* calls `pushChanges()`
  (sync.js). `render()` rebuilds the current view's HTML from scratch using template strings. Put all
  user text through `esc()`, and all user URLs through `safeUrl()`.
- The inline script in `index.html`'s `<head>` reads `tripPlanner.v1.settings.theme` to avoid a light/dark flash.
  Keep it in sync if the settings shape changes.
- Theme colors come from each trip's `color`: `applyTheme` sets it as the CSS `--seed` variable, and `styles.css`
  derives the whole palette from that one color. Light/dark mode is set with `html[data-theme]`.

**Guides and suggestions.** A "guide" has the shape `{ dayAreas, places[{id,name,area,cat,lat,lng,mins,when,tags,blurb,aliases}] }`.
`guideFor(trip)` returns either a hand-written built-in guide (`guides.js`: Boston, NYC, matched by regex
on the trip name) or a generated one (`places.js`). `places.js` looks up the trip's place with Photon (OSM),
then builds a guide from Wikivoyage listings, falling back to Wikipedia geosearch. Generated guides are cached in
localStorage `tripPlanner.guides` (up to 10). `planSuggestions` in `app.js` and Explore both use this guide.

**Maps (`maps.js`).** Leaflet (vendored) is loaded on first use. Tiles come from OSM, and addresses are looked up with
Nominatim. Plans are ordered by `time`, then by `slot` (written by Optimize route, e.g. `"12:30~01"`),
then everything else (`byPlanOrder`).

**Sync (`sync.js`).** This is optional and switched on only when `firebase-config.js` sets `window.FIREBASE_CONFIG`.
Firebase compat SDKs are vendored and loaded lazily. The state is split into Firestore documents
`users/{uid}/docs/{trip_…|item_…|check_…}`. After each save, the local state is compared with the last known remote copy (kept in
localStorage `tripPlanner.sync`), and only the differences are sent. Remote snapshots are merged into
`state`. `settings` stay on each phone and are never synced. `firestore.rules` must be pasted into the
Firebase console by hand; it isn't deployed from here.

**Offline / updates (`sw.js`).** The service worker serves cached files first and refreshes them in the background (stale-while-revalidate).
When you **add a new app file**, add it to `FILES`. When you **ship any change**, bump `CACHE`
(`trip-planner-vN`) so installed phones pick up the new version. OSM tiles go in a separate cache that is kept between versions
(`trip-planner-map-tiles`, capped at 800 tiles).

## Conventions

- External services (Photon, Nominatim, Wikivoyage/Wikipedia/Wikidata, OSM tiles, Firebase) are called straight
  from the browser. Don't add anything that needs a server or API keys we'd have to keep secret.
- Keep every feature working offline once loaded, or have it fail gracefully offline (the `#offline-badge` / `navigator.onLine` checks).
- UI follows Material 3 Expressive. Icons use `icon(name)` → `<svg><use href="icons/sprite.svg#name">`.
- Code comments are short and in plain language. Match that style.
