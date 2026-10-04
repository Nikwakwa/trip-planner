# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Dotted Line": a trip-planner PWA for phones (the owner uses a Pixel), hosted on GitHub Pages. Plain HTML/CSS/JS:
no framework, no build step, no package manager, no tests, no backend of our own. The README is
written for a non-developer owner, so keep its explanations plain-language when updating it.

## Running it

```powershell
.\serve.ps1                  # http://localhost:8080, sends Cache-Control: no-cache
.\serve.ps1 -MaxAge 600      # mimic GitHub Pages' 10-minute browser caching (to test update flow)
```

There is no build, lint or test command. Check changes by loading the app in a browser at phone size.

Testing notes (this machine has no Node or Python; use PowerShell or Git Bash):
- `.claude/launch.json` starts `serve.ps1` for the browser pane (`preview_start` name `trip-planner`).
- The service worker serves stale files after an edit. Before checking a change, unregister it and clear caches
  (`navigator.serviceWorker.getRegistrations()` → `unregister()`, `caches.delete`), then reload.
- When the app window is in the background, the pane stops drawing (screenshots time out, smooth scroll and map
  rendering stall). Measure the DOM instead, or render a page to PNG with Edge headless (see `tools/make-icons.ps1`).
  Also while hidden: the window height is 0 (set a size with `resize_window` before testing drag or `elementFromPoint`),
  `loading="lazy"` photos never load, and a dialog's `close` event doesn't fire, so `askConfirm` never answers
  (stand in for it: `askConfirm = async () => true`).
- A test that swaps `state` and calls `render()` can still save (address lookups call `save()` when they finish).
  Copy the `tripPlanner.*` localStorage keys first and put them back afterwards.
- The AI Assistant (App Check) only works on the live site, https://nikwakwa.github.io/trip-planner/. After a push,
  wait until `sw.js` there shows the new `trip-planner-vN`, then open the site with a `?fresh=N` query to dodge caches.

Asset scripts (they download from the internet and rewrite files in the repo):
- `tools/fetch-assets.ps1`: re-downloads the font, **regenerates `icons/sprite.svg`** from the icon
  name lists in the script, and refreshes the vendored Firebase/Leaflet builds. To use a new
  Material Symbols icon, add its name to `$outline` or `$filled` there and rerun. Don't edit the sprite by hand.
  Filled variants get the id `<name>-fill`.
- `tools/make-icons.ps1`: writes the logo (`icons/logo.svg`) and renders the home-screen PNG icons from it with
  Microsoft Edge (headless). Change the drawing in `Get-LogoSvg` there, not the PNGs.

## Architecture

**Classic scripts that share one global scope.** `index.html` loads, in this order:
`theme.js` (in the `<head>`), then at the end of the page `firebase-config.js` → `places.js` → `weather.js` → `hours.js` → `essentials.js` → `mapstyle.js` → `maps.js` →
`drag.js` → `today.js` → `calendar.js` → `files.js` → `packing.js` → `info.js` → `assistant.js` → `sync.js` → `app.js`. Don't use `app.js` names (`$`, `CATEGORIES`, …) at load time
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
- `theme.js` (loaded in `index.html`'s `<head>`) reads `tripPlanner.v1.settings.theme` to avoid a light/dark flash.
  Keep it in sync if the settings shape changes.
- Data from outside goes through checks before it is used: the saved copy (`tidyState` in `load()`), the account's
  documents (`tidyTrip` / `tidyItem` / `tidyCheck` in `applyDocs`) and backup files (`cleanBackup`, stricter: it keeps
  only known fields). The `tidy…` functions fix the types of the fields the app relies on and keep unknown fields, so
  an older version doesn't erase what a newer one added. Ids must pass `isId`, days `isDate`, times `isTime`.
- Theme colors come from each trip's `color`: `applyTheme` sets it as the CSS `--seed` variable, and `styles.css`
  derives the whole palette from that one color. Light/dark mode is set with `html[data-theme]`.

**Guides and suggestions.** A "guide" has the shape `{ dayAreas, places[{id,name,area,cat,lat,lng,mins,when,tags,blurb,aliases}] }`.
`guideFor(trip)` returns the guide generated for the trip's place (`places.js`; there are no built-in guides any more).
`places.js` looks up the trip's place with Photon (OSM),
then builds a guide from Wikivoyage listings, falling back to Wikipedia geosearch. Generated guides are cached in
localStorage `tripPlanner.guides` (up to 10). `planSuggestions` in `app.js` and Explore both use this guide.
- Places may carry `about` (the full description, shown in the details sheet `openPlaceInfo`) and `hours`.
- Saved guides are stamped with `GUIDE_VERSION`. Bump it when the guide shape changes: older saved guides keep
  working, and are re-fetched quietly in the background.
- Guides near the plans: a country or region trip's own guide only lists destinations. So each group of located
  plans (`planGroups`: within 6 miles, at least two plans; for a city trip only groups over 15 miles away) gets a
  `kind: 'near'` guide built from the Wikivoyage pages closest to it (`nearbyGuide`, saved as `near:lat,lng`).
  `guideFor(trip)` returns the trip's guide with those places added (`withNearby`, `guide.joined`; their places have
  `local: true`). "Nearby ideas" then only use local places, and never anything over 25 miles away.
- Places may also carry `price`, `tip` (how to get there) and `url` (`GUIDE_VERSION` 4). Destinations without a photo
  get the picture of the Wikipedia article with the same name (`fillPhotosByName`).
- Places carry `fame` (`GUIDE_VERSION` 5): the number of Wikipedia languages with an article about them, from Wikidata
  (`fillFame`). It also helps decide which 160 listings a guide keeps.
- A huge city whose Wikivoyage districts are pages of their own (New York: "Manhattan", then "Manhattan/Midtown") is
  read two levels deep, from the page's region list.
- Place search (`searchPlaces`) re-ranks Photon's results so countries and cities come before villages with the
  same name.

**Travel mode and units.**
- `trip.travel` is `'transit'` (the default when missing) or `'drive'`. `trip.dayTravel[day]` overrides it for a
  day, and both sync. Always go through `modeFor(trip, day)` and `travel(miles, mode)`.
- Distances are computed in miles. Show them with `fmtDist()`, and temperatures with `temp()`. Both follow
  `state.settings.units` (`'metric'`/`'imperial'`, per phone, defaulting from the phone's language).
- The app is English only. Dates and times go through `fmtDay()`, `fmtTime()` and `fmtClock()`, which follow
  `state.settings.dateOrder` (`'dmy'`/`'mdy'`) and `state.settings.clock` (`'24'`/`'12'`), per phone, defaulting
  from the device (`deviceFormats`). Don't call `toLocale…String(undefined, …)`: it follows the device's language.
- User-facing text says "device", not "phone" (the app also runs on computers).

**Maps (`maps.js`).** Leaflet (vendored) is loaded on first use. Addresses are looked up with
Nominatim. The basemap is a MapLibre GL vector layer inside Leaflet (`L.maplibreGL`, vendored in `vendor/maplibre`),
using OpenFreeMap's "liberty" style as adjusted by `tuneMapStyle(style, theme)` in `mapstyle.js` (earlier POI labels;
the dark theme is derived by recoloring every paint color, see `nightColor`). Pins, routes and popups stay Leaflet.
If MapLibre or the style can't load, raster tiles are used: CARTO (Voyager / dark) when `window.CARTO_KEY` is set in
`firebase-config.js`, else standard OSM tiles with a CSS invert in dark mode (`tileUrl`, `setMapTheme`). Plans are ordered by `time`, then by `slot` (written by Optimize route, e.g. `"12:30~01"`),
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
  `date` and renumbers the untimed plans' `slot`s for that day. A plan with a time can be dropped anywhere that keeps
  the day's timed plans in time order (the untimed ones around it are renumbered); otherwise it stays put.

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
- The same prompt can be copied to another AI app (the UI never names one), and the pasted answer goes through `parseAnswer`.
- Chats are stored per trip on the phone only (`tripPlanner.assistant`).

**During the trip, calendar, files, packing.**
- `today.js`: `baseFor(trip, day)` is the home base. It's the latest located `stay` plan dated on or before the day
  (else the first one; an undated stay counts for every day). Day lists, Optimize route, the day map, the route link,
  empty-day area order and the AI context all use it. `nowCardHTML` refreshes itself every 30 s. "Near me" uses the
  geolocation API only, on the guide already saved on the phone.
- `calendar.js`: there's a Google Calendar template link per plan, and an `.ics` file per trip. Times are local to
  the destination via `tripTimeZone` (the Essentials time zone). Visit length comes from `planLength` (today.js).
- `files.js`: attachments go in IndexedDB `tripPlannerFiles` (per phone, never synced or backed up). `tickets.index`
  maps plan id → file list. The plan form stages changes in `tickets.form`, and they're written on save.
- `info.js`: the "i" button on a plan's card opens "About this place" (`openPlanInfo`, in the `#place-dialog` sheet):
  the guide entry, the opening hours for the day, and the start of the Wikipedia article found by name among the
  articles within 1.5 km of the plan (`wikiAbout`, saved per device in `tripPlanner.info`).
- `packing.js`: suggestions are rules over the forecast, plans, travel mode and Essentials. Hidden ones are kept
  per phone (`tripPlanner.packing`).
- Guide places may carry `photo` (a Commons `Special:FilePath` or Wikipedia thumbnail URL; `GUIDE_VERSION` 3). Photos
  aren't cached by the service worker, so they only show online.

**Sync (`sync.js`).** This is optional and switched on only when `firebase-config.js` sets `window.FIREBASE_CONFIG`.
Firebase compat SDKs are vendored and loaded lazily. The state is split into Firestore documents
`users/{uid}/docs/{trip_…|item_…|check_…}`. After each save, the local state is compared with the last known remote copy (kept in
localStorage `tripPlanner.sync`), and only the differences are sent. Remote snapshots are merged into
`state`. `settings` stay on each phone and are never synced. `firestore.rules` must be pasted into the
Firebase console by hand; it isn't deployed from here.

**Offline / updates (`sw.js`).** The service worker serves cached files first and refreshes them in the background (stale-while-revalidate).
When you **add a new app file**, add it to `FILES`. When you **ship any change**, bump `CACHE`
(`trip-planner-vN`) so installed phones pick up the new version. The big vendored libraries (MapLibre, Firebase) are in
`LIBS`: saved at install too, but the install doesn't fail without them. Files are saved without their `?query`.
OSM tiles go in a separate cache that is kept between versions (`trip-planner-map-tiles`, capped at 900 tiles).

**Security.**
- `index.html` has a Content-Security-Policy `<meta>`: scripts run only from the app's own files and Google's
  reCAPTCHA (for App Check). So: no inline `<script>`, no inline handlers (`onclick="…"`, `onerror="…"`) in HTML or in
  template strings; use `addEventListener` (see the `img[data-photo]` error listener in app.js). A new outside script
  needs its host added to the policy. On phones, Firebase Auth tries to load `apis.google.com/js/api.js` (only needed
  for Google sign-in pop-ups, which the app doesn't use): the policy blocks it, and that console message is expected.
- Everything written into the page goes through `esc()`, ids included. Wikivoyage, OpenStreetMap, AI answers and
  backup files are all text other people can write.
- Attachments (`files.js`) accept photos and PDFs only (`SAFE_FILE`). No SVG or HTML: opened from a `blob:` address,
  they would run with the app's own access.
- "Erase everything" also clears what is only on the device (`eraseDeviceData`). Add any new `tripPlanner.*` key there.

**Desktop layout (`styles.css`, end of file).** There is one codebase, and the layout switches by window width.
Phone styles are the default. Add desktop overrides in the media blocks at the end, and check phone, ~1000px and
~1400px.
- From 900px: `.navbar` becomes a labelled sidebar (`--rail-w`) with the FAB ("New plan") at its top, and `#side-extra`
  below the sections (AI Assistant, the trip's days as `jump-day` links; `renderSidebar` in app.js). Content is one
  reading-width column (`--content-w`). Days are never laid out in columns. Sheets become centered windows, and the AI
  Assistant sheet docks on the right.
- From 1200px on the Plan tab: the map is docked in `#map-pane` on the right (`body.has-map`). `syncMapDock()`
  (maps.js, called at the end of every `render()`) moves the single `#map` element between `#map-slot` and the map
  dialog. `openMap(day)` then only points the docked map at that day. Use `mapShown()` / `mapDocked()` instead of
  checking the dialog.
- With a mouse, `drag.js` starts a drag on move (no long-press).

**UI decisions worth keeping.**
- The trip card (`.hero`) is compact on purpose, so today's plans are on the first screen.
- Plan view (Wanderlog-like): each day has a big title, its travel total (`day-total`) and tools above the list,
  the stay as a pill at the top (`stay-pill`), white cards (`.group.plans`) with the stop's number (same as its map
  pin; plans not on the map keep their category icon) and a photo (`planPhoto` in info.js: the guide's, else the
  Wikipedia article's, looked up three at a time), and dotted lines with the travel time between stops (`legHTML`).
- Plan cards show one row of actions, with the done circle at its end. Secondary ones are icon-only (`.assist-chip.icon-only`, with `title` and
  `aria-label`). The address line is hidden when it repeats the title.
- Suggestions are open only for the "focus day" (first day from today with suggestions). Other days show a one-line
  `suggest-toggle`, and `ui.suggest[day]` remembers a manual toggle.
- Phones have a `#day-strip` under the trip tabs (`renderDayStrip`). `markCurrentDay()` highlights the day on screen
  there and in the desktop sidebar.
- The plan form's example texts come from the trip's guide and the chosen type (`planExamples`). Don't hard-code a city.
- The plan form lists matching real places under the name and the address as you type (`findMatches`: the guide, then
  Photon, kept to places near the trip with `nearTrip`). Picking one fills the address and saves its `lat`/`lng` (and
  `guideId`), so no address lookup is needed. Nothing is matched without a pick.
- "Auto-fill day" (a day tool, `autoFillDay` in app.js) adds guide sights to a day until it holds about 8 hours, then
  runs `optimizeDay`. It picks by interest first (`placeInterest`, mostly the place's `fame`), minus a cost per mile
  from the day's plans, and only from the most interesting quarter of the guide; an empty day starts from the most
  interesting place not in the trip yet. No AI, no times, no meals, with Undo. Not offered with a Wikipedia guide.
- Plan cards show "Book ahead: …" (`bookingNote`) only for what is known to sell out, not for every fee or timed
  entry. `lookupBooking` (assistant.js) asks Flash-Lite once per new plan name, a trip's plans in one request, and
  keeps the answers per device in `ai.saved.booking`; until there's an answer, only the guide's own words count
  ("sells out", "weeks in advance"). The note goes when the plan's form has "Booked, or no booking needed" switched on
  (`item.booked`, synced) or a ticket is attached. Switch in More: `settings.booking`.
- Colors: the trip's color themes the app itself (trip card, buttons, links). Each day also has its own color
  (`dayTint(i)` in maps.js, set as `--day` on the day's section): its stop numbers, travel lines, dot in the day strip
  and sidebar, and its pins and route on the map (day map and trip map alike). The "Book ahead" label is amber on
  every trip, so it reads as a notice, not as part of the theme. Don't recolor whole days.
- Ideas (Ideas tab) have "Add to a day" (`pick-day` / `set-day`) in place of the done checkbox.
- On desktop, hovering a plan highlights its pin (`hotPin`), and the docked map opens on today's route during the trip.
- Keyboard focus is shown with a global `:focus-visible` outline. Don't remove outlines without a replacement.

## Conventions

- External services (Photon, Nominatim, Wikivoyage/Wikipedia/Wikidata, OSM tiles, Firebase) are called straight
  from the browser. Don't add anything that needs a server or API keys we'd have to keep secret.
- Keep every feature working offline once loaded, or have it fail gracefully offline (the `#offline-badge` / `navigator.onLine` checks).
- UI follows Material 3 Expressive. Icons use `icon(name)` → `<svg><use href="icons/sprite.svg#name">`.
- Code comments are short and in plain language. Match that style.
