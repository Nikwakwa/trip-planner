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
`firebase-config.js` → `guides.js` → `places.js` → `weather.js` → `hours.js` → `essentials.js` → `maps.js` →
`drag.js` → `assistant.js` → `sync.js` → `app.js`. Don't use `app.js` names (`$`, `CATEGORIES`, …) at load time
in the earlier files, only inside functions. The files are not modules. The feature files call helpers defined in `app.js` (`$`, `esc`, `icon`,
`save`, `render`, `snackbar`, `state`, …) at runtime, which works because `app.js` loads last and the calls
happen after startup. Top-level names must stay unique across all files.

**State and rendering (`app.js`).**
- One `state` object (`{ version, activeTripId, trips[{id,name,color,start,end,place,items[]}], checklist[], settings }`)
  is saved as JSON in localStorage under `tripPlanner.v1`. Plans ("items") store dates as `YYYY-MM-DD` strings. An item
  with no date is an "idea".
- `state.trips` can be empty (a fresh install starts with no trips). Then `activeTrip()` returns `null`, and the Plan
  and Ideas tabs show `renderWelcome()` ("Where do you want to go?") instead of a trip. Code reachable without a trip
  must handle `null`.
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
- Places may carry `about` (the full description, shown in the details sheet `openPlaceInfo`) and `hours`.
- Saved guides are stamped with `GUIDE_VERSION`. Bump it when the guide shape changes: older saved guides keep
  working, and are re-fetched quietly in the background.
- Place search (`searchPlaces`) re-ranks Photon's results so countries and cities come before villages with the
  same name.

**Maps (`maps.js`).** Leaflet (vendored) is loaded on first use. Tiles come from OSM, and addresses are looked up with
Nominatim. Plans are ordered by `time`, then by `slot` (written by Optimize route, e.g. `"12:30~01"`),
then everything else (`byPlanOrder`).

**Weather, hours, essentials, drag.**
- Each of `weather.js` (Open-Meteo), `hours.js` (Overpass/OSM `opening_hours`, falling back to the Wikivoyage listing's
  `hours`) and `essentials.js` (Wikidata SPARQL + Wikivoyage sections) keeps a cache on the phone only
  (`tripPlanner.weather` / `.hours` / `.essentials`). These caches are never synced.
- Each fetches in the background from a render path. When it finishes, it calls `renderSoon()`; after a failure it
  waits before retrying.
- The hours parser supports a subset of OSM's format and returns `null` (no note shown) for anything it
  can't read, rather than guessing.
- Weather is only fetched for city-sized places. Rainy days reorder `planSuggestions` toward `rainy`-tagged places.
- `drag.js` uses a long-press, then pointer events plus a non-passive `touchmove` to stop the page scrolling. Elements
  marked `data-drag` (plan cards in the Plan view, `.idea-chip`s in the ideas tray) can be dragged. A drop rewrites
  `date` and renumbers the untimed plans' `slot`s for that day.
- Built-in Boston/NYC trips also get a `trip.place` now (for weather and essentials). `guideFor` still prefers the
  built-in guide.

**AI assistant (`assistant.js`).**
- It calls the Firebase AI Logic REST endpoint (`firebasevertexai.googleapis.com/v1beta/projects/{id}/models/{model}:generateContent`)
  directly with the Firebase web key, because the AI SDK has no compat build. Requests carry an App Check token
  (reCAPTCHA Enterprise; site key in `firebase-config.js` as `RECAPTCHA_SITE_KEY`). App Check is required by Firebase
  from 2026-11-02.
- It uses the Gemini free tier only: `gemini-3.8-flash` (~20 requests/day), and on a daily 429 it switches to
  `gemini-3.5-flash-lite` for the rest of the day (`liteDay`).
- The model returns JSON `{reply, add[], update[], remove[], dates}` (structured output, `aiSchema()`; every field is
  required, since Flash-Lite drops optional ones). `parseAnswer` turns it into one `changes` list. `checkChanges` validates the
  changes against the trip, and nothing is applied until the user taps Apply (with Undo).
- The same prompt can be copied to the Claude or Gemini app, and the pasted answer goes through `parseAnswer`.
- Chats are stored per trip on the phone only (`tripPlanner.assistant`).

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
