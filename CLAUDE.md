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

**Self-check before every push:** open `http://localhost:8080/?selfcheck`. It loads `js/selfcheck.js` (only then) and
shows pass/fail for dates, the `tidy…` checks, backups, sync merging, shared trips, AI answers, opening hours, languages
(every text has its French) and the code itself ("The code": every file the page loads is in `sw.js`'s `FILES`, every
`data-action` has an action, no top-level name is used twice, the security policy, no `on…=` attributes or `javascript:`
links, `rel="noopener"` on links that open a new tab). From the console:
`runSelfCheck().filter(r => !r.ok)`. It swaps `state` and `sync.saved` for made-up plans inside `sandbox()`, with
saving and drawing switched off, all in one go (no `await`). When you change one of those parts, add a check.

Testing notes (this machine has no Node or Python; use PowerShell or Git Bash):
- `.claude/launch.json` starts `serve.ps1` for the browser pane (`preview_start` name `trip-planner`).
- The service worker serves stale files after an edit. Before checking a change, unregister it and clear caches
  (`navigator.serviceWorker.getRegistrations()` → `unregister()`, `caches.delete`), then reload.
- When the app window is in the background, the pane stops drawing (screenshots time out, smooth scroll and map
  rendering stall). Measure the DOM instead, or render a page to PNG with Edge headless (see `tools/make-icons.ps1`).
  Also while hidden: the window height is 0 (set a size with `resize_window` before testing drag or `elementFromPoint`),
  `loading="lazy"` photos never load, and a dialog's `close` event doesn't fire, so `askConfirm` never answers
  (stand in for it: `askConfirm = async () => true`). `renderSoon` waits for a frame that never comes
  (`renderSoon = () => render()`).
- A test that swaps `state` and calls `render()` can still save (address lookups call `save()` when they finish).
  Copy the `tripPlanner.*` localStorage keys first and put them back afterwards.
- The AI Assistant (App Check) only works on the live site, https://nikwakwa.github.io/trip-planner/. After a push,
  wait until `js/version.js` there shows the new version, then open the site with a `?fresh=N` query to dodge caches.
- A change that must not change the screen (moving code, tidying the CSS): `tools/snapshot.js` records each
  section's HTML and every element's computed style at a fixed moment, and compares; `explain()` lists the properties
  that changed. Serve the code as it was next to the new one (`git archive HEAD | tar -x -C _old`, ignored by git;
  delete it afterwards) and follow the steps at the top of the file, at 375, 1000 and 1400px. Record on a freshly
  loaded page, and put the same `tripPlanner.*` keys back before each run.
- Nothing here can run Safari. iPhone behavior is only reviewed in the code, never tested: say so, and ask the owner
  to check on an iPhone (the self-check page runs there too).
- Real accounts can't be created or signed in to from here. For sync and shared trips, use the pretend Firebase,
  on a copy of the app that is not signed in (clear `tripPlanner.sync` and reload first, or the real one loads):
  `await loadScript('tools/fake-firebase.js'); await fakeFirebase.signIn('ann@test.org')`. `fakeFirebase.as(email)`
  is the database as another account's device sees it, `fakeFirebase.options.oldRules = true` is a project whose
  rules don't know shared trips. It repeats `firestore.rules` in JavaScript: change both together. The real rules
  are only ever tested by the owner, with two accounts.
- If another session holds port 8080, `preview_start` name `trip-planner-8081` serves the same folder (its saved
  data is separate: another address).

Asset scripts (they download from the internet and rewrite files in the repo):
- `tools/fetch-assets.ps1`: re-downloads the font, **regenerates `icons/sprite.svg`** from the icon
  name lists in the script, and refreshes the vendored Firebase/Leaflet builds. To use a new
  Material Symbols icon, add its name to `$outline` or `$filled` there and rerun. Don't edit the sprite by hand.
  Filled variants get the id `<name>-fill`.
- `tools/make-icons.ps1`: writes the logo (`icons/logo.svg`) and renders the home-screen PNG icons from it with
  Microsoft Edge (headless). Change the drawing in `Get-LogoSvg` there, not the PNGs.

## Architecture

**Classic scripts that share one global scope.** The code is in `js/`; only `firebase-config.js` (the owner's settings)
stays at the root. `index.html` loads `js/theme.js` in the `<head>`, then at the end of the page, in this order:
- the languages and settings: `version.js` → `i18n.js` → `lang/fr.js` → `firebase-config.js`;
- `core.js`: constants (`CATEGORIES`, `COLORS`, `TRAVEL_MODES`), small helpers (`$`, `esc`, `icon`, `uid`, `isId`,
  dates and times, `travel`, `fmtDist`, `safeUrl`, `mapsUrl`…), the errors of the visit (`noteError`, listening from the
  start) and the action table (`onAction`);
- the features: `places.js` → `weather.js` → `hours.js` → `essentials.js` → `mapstyle.js` → `maps.js` → `routes.js` →
  `drag.js` → `today.js` → `calendar.js` → `files.js` → `packing.js` → `info.js` → `assistant.js` → `vote.js` →
  `share.js` → `sync.js`;
- the screen: `ui.js` (shapes, empty states, `snackbar`, `askConfirm`, photos, theme colors, `tick`, ripple) →
  `guide.js` (which guide place a plan is, `planSuggestions`, Auto-fill, `bookingNote`) → `store.js` (`state`: defaults,
  `tidy…`, `load`/`save`, the one-time repairs) → `render.js` (`ui`, `showView`, `render()`, trip tabs, day strip,
  sidebar, scrolling) → `view-plan.js` → `view-ideas.js` → `view-checklist.js` → `view-settings.js` → `form-plan.js` →
  `form-trip.js` → `account.js` (sign-in, password, delete account) → `sheets.js` (closing sheets, drafts, swipe down)
  → `backup.js` (backup, restore, erase) → `about.js` (privacy, What's new, Report a problem) → `pad.js` → `app.js`
  (install, offline, service worker, start, `catchUp`).

Names from `core.js` and the files before it can be used anywhere, also at load time. A file may use names from the
files after it only inside functions (they run after startup, when everything is loaded). The files are not modules:
top-level names must stay unique across all files (two `function save` in two files: the second silently wins; the
self-check fails on it). A new file goes in `index.html` and in `sw.js`'s `FILES` (the self-check compares them).

**Taps: the action table (`core.js`).** A button or link with `data-action="name"` runs the action registered with
`onAction('name', (el, e) => …)`. Each file registers the actions of the buttons it draws, at its end ("Taps"), and
one listener on the page runs them. `idOf(el)` is the id of the plan a tapped button belongs to. The self-check fails on a
`data-action` that has no action. The trip tabs (`data-trip`) and the navigation bar (`data-go`) have their own
listener in render.js. Don't add another document-wide click listener for buttons: register an action.

**State and rendering (`store.js`, `render.js`).**
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
- Two safety nets, for when nobody can fix the app: a section that throws while drawing shows "This screen can’t be
  shown" (`renderFailed`; the other sections and Settings keep working, and the error goes with "Report a problem"),
  and when the storage is full `saveLocal` drops what can be fetched again (info, hours, forecasts, then guides) to
  save the plans.
- A phone keeps the app open for days. Back on screen after 5 minutes, or on a new day, `catchUp()` (end of app.js)
  redraws; on a new day the Plan jumps to today's card (not with a sheet open).
- The trip form: a new trip's place is looked up from its name. A trip being edited keeps its place whatever it is
  renamed to; only picking a place from the list changes it (`onTripNameInput`, the hint in `showChosenPlace`).
- `theme.js` (loaded in `index.html`'s `<head>`) reads `tripPlanner.v1.settings.theme` to avoid a light/dark flash.
  Keep it in sync if the settings shape changes.
- Data from outside goes through checks before it is used: the saved copy (`tidyState` in `load()`), the account's
  documents (`tidyTrip` / `tidyItem` / `tidyCheck` in `applyDocs`) and backup files (`cleanBackup`, stricter: it keeps
  only known fields). The `tidy…` functions fix the types of the fields the app relies on and keep unknown fields, so
  an older version doesn't erase what a newer one added. Ids must pass `isId`, days `isDate`, times `isTime`.
- Theme colors come from each trip's `color`: `applyTheme` sets it as the CSS `--seed` variable, and `css/base.css`
  derives the whole palette from that one color. Light/dark mode is set with `html[data-theme]`.

**Guides and suggestions.** A "guide" has the shape `{ dayAreas, places[{id,name,area,cat,lat,lng,mins,when,tags,blurb,aliases}] }`.
`guideFor(trip)` returns the guide generated for the trip's place (`places.js`; there are no built-in guides any more).
`places.js` looks up the trip's place with Photon (OSM),
then builds a guide from Wikivoyage listings, falling back to Wikipedia geosearch. Generated guides are cached in
localStorage `tripPlanner.guides` (up to 10). `planSuggestions` (guide.js) and Explore both use this guide.
- Places may carry `about` (the full description, shown in the details sheet `openPlaceInfo`) and `hours`.
- Saved guides are stamped with `GUIDE_VERSION`. Bump it when the guide shape changes: older saved guides keep
  working, and are re-fetched quietly in the background. A Wikipedia guide saved because Wikivoyage couldn't be read
  (an error, not "no page") is a stand-in stamped `v: 0`: it is fetched again at the next start.
- Guides near the plans: a country or region trip's own guide only lists destinations. So each group of located
  plans (`planGroups`: within 6 miles, at least two plans; for a city trip only groups over 15 miles away) gets a
  `kind: 'near'` guide built from the Wikivoyage pages closest to it (`nearbyGuide`, saved as `near:lat,lng`).
  `guideFor(trip)` returns the trip's guide with those places added (`withNearby`, `guide.joined`; their places have
  `local: true`). "Nearby ideas" then only use local places, and never anything over 25 miles away.
  On a country or region trip, a plan's link to Google Maps adds the town of the nearest of these guides
  (`townNear`, in `mapsUrl`): "Museum of Fine Arts, United States" could be Houston's.
  On a city trip, `mapsUrl` adds the trip's town only to a plan that is in it. A plan outside it (a day trip) keeps
  its address's own town plus the country, and an address with no town at all ("Am Bahnhof") opens the plan's
  spot by its coordinates: with "Daun" added, Google opened Daun's station for a plan in Moselkern, 24 miles away.
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
- `travel` is an estimate from the straight-line distance: it returns the time (`mins`) and the way by road (`dist`,
  20–30% longer), and its speed grows smoothly with the distance. A step in the speed once made 39 km by car "2 h"
  and 41 km "45 min": the self-check guards it. Transit is door to door: 20–30 minutes for the walk to the stop,
  the wait and the changes, plus a slow ride (the owner's own notes for Boston and New York were the measure).
- By car the estimate is replaced by the real road (`routes.js`): between two stops, use `legTravel(a, b, mode)`,
  and for a day `routeTravel` (maps.js). `lookupRoads(trip)`, called while the Plan is drawn, asks OpenStreetMap's
  routing server (FOSSGIS, `routing.openstreetmap.de`, no key, one request a second at most) for each car day in one
  question: the stay, the stops in order, the stay. Legs are saved per device in `tripPlanner.routes` (by the two
  spots, 90 days, 600 at most; never synced), so they also show offline. A leg no road reaches is saved as `none`
  and stays an estimate, like walks and public transit (no free service for those). It follows the
  "Find addresses and opening hours" switch. The estimate was up to 3× too low where roads wind (the Mosel valley).
- Distances are computed in miles. Show them with `fmtDist()`, and temperatures with `temp()`. Both follow
  `state.settings.units` (`'metric'`/`'imperial'`, per phone, defaulting from the phone's language).
- Dates and times go through `fmtDay()`, `fmtTime()` and `fmtClock()`. In English they follow
  `state.settings.dateOrder` (`'dmy'`/`'mdy'`) and `state.settings.clock` (`'24'`/`'12'`), per phone, defaulting
  from the device (`deviceFormats`); in French the date is always day first (`LOCALES`, the Date choice is hidden),
  the clock still follows the setting. Don't call `toLocale…String(undefined, …)`: it follows the device's language.
- User-facing text says "device", not "phone" (the app also runs on computers); in French "appareil". A plan is
  an "activité", the Plan tab "Programme", the Checklist "Liste", a stay "hébergement".

**Languages (`i18n.js`, `lang/fr.js`).** English and French; built so another language is one more file.
- Every text on screen goes through `T('English text', { name })` or `Tn(n, '{n} plan', '{n} plans', vars)`. The
  English text is the key; `DICTS.fr` (lang/fr.js) maps it to French, and a missing one shows in English. The
  first argument is always one plain `'…'` literal (never built from pieces, never `T(cond ? 'a' : 'b')`): the
  self-check reads the code's files and fails on a text without a translation, or a translation no code uses.
  Names go in through `{…}` and are put in as they are: user text still goes through `esc()` first. A French
  text keeps the same `{names}` and markup (`<b>`, `<span class="ok">`) as the English, also checked.
- `LANG` is picked once at startup (like theme.js): `settings.lang`, else the device's language when the app
  has it (`deviceLang`), else English. Constants built at load time (`CATEGORIES`, `TRAVEL_MODES`,
  `FEATURE_IDEAS`, `KIND_LABEL`…) use `T()` directly, so changing the language reloads the app
  (Settings → Appearance → Language, action `lang`). `settings.lang` is per device, kept by "Erase everything"
  and "Restore from backup" (`deviceMarks`).
- index.html's own texts and its `aria-label`/`title`/`placeholder` are swapped once at startup
  (`translatePage`); an element with markup inside a text needs `data-i18n` (none does yet).
- "What's new" items are translated at display (`T(t)`): a new `CHANGELOG` line needs its French in lang/fr.js.
- `fmtNum` writes decimals with a comma in French (`fmtDist`, `fmtDuration`). French plurals: 0 and 1 are
  singular (`Intl.PluralRules`). lang/fr.js turns the space before `? ! : ; % »` into a non-breaking one.
- What stays English on purpose: guide content (Wikivoyage, the Wikipedia "What it is", read in English because
  guide place names are English: fr.wikipedia matched the wrong articles), "Report a problem" details (for the
  owner; they say the app's language), the self-check (it switches `LANG` to English while it runs).
- Language-aware outside calls: Photon place search (`lang`), Wikidata labels in Essentials (`factsLang`; saved
  essentials carry `lang` and are fetched again in the other language), the AI Assistant (a line in
  `tripContext` asks for replies and new plan titles in that language; booking answers are kept per language).
  Packing suggestions match the checklist in both languages: each suggestion's French text must match its own
  pattern (packing.js), or it keeps being suggested after it was added.

**Maps (`maps.js`).** Leaflet (vendored) is loaded on first use. Addresses are looked up with
Nominatim (`lookupMissing`); a house number on "Fifth Avenue" is asked as "5th Avenue" (`numbered`: with the word,
Nominatim only answers with the street, and the pin landed 3 miles up it; `repinNumbered` repairs such pins once,
`geoRetry` 6, moving a pin only when the house itself is found); when an address exists in several places, the one nearest the plans around it wins, or
the one where the plan's name is found. A plan matches a guide place by its title or by the part of its address
before the first comma only (`matchPlaces`), so "…, New York, NY" isn't taken for the city. A name never says
where: a trip across a country has a "Rathaus" and a "Residenz" in several towns' guides. So a plan with an address
is always looked up (`needsLookup`), a plan on the map only matches a place of that name within `SIGHT_REACH`
(5 miles; a destination of a country guide gets `MATCH_REACH`), and a plan without a spot only one near the plans
around it (`plansAround`: its day, the day before and after). When the address found is a whole town or park and
the guide place with the plan's name is inside it, the pin goes on that place. A short address on a country or
region trip ("Hauptbahnhof") is first searched around the day's plans. The basemap is a MapLibre GL (6.x, an ES module) vector layer inside Leaflet (`L.maplibreGL`, vendored in `vendor/maplibre`),
using OpenFreeMap's "liberty" style as adjusted by `tuneMapStyle(style, theme)` in `mapstyle.js` (earlier POI labels;
the dark theme is derived by recoloring every paint color, see `nightColor`). Pins, routes and popups stay Leaflet.
If MapLibre or the style can't load, raster tiles are used: CARTO (Voyager / dark) when `window.CARTO_KEY` is set in
`firebase-config.js`, else standard OSM tiles with a CSS invert in dark mode (`tileUrl`, `setMapTheme`). Plans are ordered by `time`, then by `slot` (written by Optimize route and by a drop, e.g. `"12:30~01"`);
a plan with neither sorts as if at 17:00, after that hour's plans (`byPlanOrder`): at the end it came after an 8 PM
dinner, and the route doubled back.

**Weather, hours, essentials, drag.**
- Each of `weather.js` (Open-Meteo), `hours.js` (Overpass/OSM `opening_hours`, falling back to the Wikivoyage listing's
  `hours`) and `essentials.js` (Wikidata SPARQL + Wikivoyage sections) keeps a cache on the phone only
  (`tripPlanner.weather` / `.hours` / `.essentials`). These caches are never synced.
- Guide and essentials texts go through `plainText` (wiki markup out) and `sentencesOf` (places.js). Don't split
  sentences with a regex on periods: "U.S.", "St." and "3.5" are not sentence ends.
- Essentials languages: Wikidata's official languages for the whole country; when there are none (United States,
  Belgium) the regional ones that are also widely spoken, else the main spoken ones (`languagesSpoken`). Saved
  essentials are stamped with `ESSENTIALS_VERSION`, like guides.
- Each fetches in the background from a render path. When it finishes, it calls `renderSoon()`; after a failure it
  waits before retrying. Anything that finishes later than the tap that started it (a fetch, a timer) redraws with
  `renderSoon()`, never `render()`: it waits while something is typed in the page or a plan is dragged.
- A plan only gets the hours of an OpenStreetMap place with its own name (`hoursFit`: the title, or the name its
  address starts with; never a street, a station or half a name: "22 Cortlandt Street" once got a subway station's
  hours). Transport and stay plans get none (`HOURS_KINDS`). Saved answers are stamped with `HOURS_VERSION`. A guide
  text that only says "closed Sun" warns on Sundays and shows nothing on the other days (`unknown`).
- The hours parser supports a subset of OSM's format and returns `null` (no note shown) for anything it
  can't read, rather than guessing.
- Weather is per day and per spot (`weatherSpot(trip, day)`): the trip's city, else (a country or region trip, or
  a city's day trip over 25 miles away) where the day is spent, from `baseFor` and the day's located plans. Days near
  one stay use that stay's spot, so they share one saved forecast; a day with nothing on the map has none.
  Rainy days reorder `planSuggestions` toward `rainy`-tagged places. A day's weather code is its worst moment:
  rain only shows from a 30% chance (`weatherLook(code, rain)`), and "Rain likely" needs `rainLikely` (40% with a
  wet code, or 60%).
- Each spot's forecast also brings its time zone (`weather.saved[key].tz`). A spot beyond the forecast's reach is
  asked about once per visit, for that alone (`weather.asked`).
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
- Nothing waits for ever: a model gets `AI_WAIT` (30 s) to answer, the App Check token `AI_CHECK_WAIT`. Under "high
  demand" Flash was seen hanging 3 minutes before a 503 (2026-10-11, live). No answer in time counts as `busy`:
  Flash-Lite takes over, and for the next ten minutes (`ai.busyUntil`) it is asked first.
- App Check is already enforced for Gemini (a request without a token gets 401). After one 403 the Firebase SDK
  stops asking for a day, until the page is loaded again: the error message says to close and reopen the app.
- The model returns JSON `{reply, add[], update[], remove[], dates}` (structured output, `aiSchema()`; every field is
  required, since Flash-Lite drops optional ones). `parseAnswer` turns it into one `changes` list. `checkChanges` validates the
  changes against the trip, and nothing is applied until the user taps Apply (with Undo).
- The same prompt can be copied to another AI app (the UI never names one), and the pasted answer goes through `parseAnswer`.
- Chats are stored per trip on the phone only (`tripPlanner.assistant`).

**During the trip, calendar, files, packing.**
- `today.js`: `baseFor(trip, day)` is the home base. It's the latest located `stay` plan dated on or before the day
  (else the first one; an undated stay counts for every day). Day lists, Optimize route, the day map, the route link,
  empty-day area order and the AI context all use it. Where a day starts and ends is `dayEnds(trip, day, items)`:
  the base both ways, except on the day a stay begins (`startsStay`, its card says "Check in"): that day ends at the
  new stay and, after a move, starts at the one before it (the "Check out" pill, `out`). A stay may have a check-out
  day (`item.until`, optional, synced; read it with `stayUntil`): that day starts there and doesn't end there, and from
  then on `baseFor` no longer returns it. A stay plan titled "Check out…" never begins a stay. `nowCardHTML` refreshes itself every 30 s. "Near me" uses the
  geolocation API only, on the guide already saved on the phone.
- `calendar.js`: there's a Google Calendar template link per plan, and an `.ics` file per trip. Times are local to
  where that day is spent: `tripTimeZone(trip, day)` is the zone of the day's weather spot (a country has several,
  and its middle is not where the plans are), else of the nearest day that has one, else the Essentials one, else ''.
  The Essentials "Local time" uses it too. Visit length comes from `planLength` (today.js).
- `files.js`: attachments go in IndexedDB `tripPlannerFiles` (per phone, never synced or backed up). `tickets.index`
  maps plan id → file list. The plan form stages changes in `tickets.form`, and they're written on save.
- `info.js`: the "i" button on a plan's card opens "About this place" (`openPlanInfo`, in the `#place-dialog` sheet):
  the guide entry, the opening hours for the day, and the start of the Wikipedia article found by name among the
  articles within 1.5 km of the plan (`wikiAbout`, saved per device in `tripPlanner.info`). The article with the
  plan's exact name wins, and a station named after a sight is skipped (`TRANSIT_ARTICLE`). Saved answers are
  stamped with `INFO_VERSION`: bump it when the matching changes, and older ones are asked again.
- `packing.js`: suggestions are rules over the forecast, plans, travel mode and Essentials. Hidden ones are kept
  per phone (`tripPlanner.packing`).
- Guide places may carry `photo` (a Commons `Special:FilePath` or Wikipedia thumbnail URL; `GUIDE_VERSION` 3). Photos
  aren't cached by the service worker, so they only show online.

**Sync (`sync.js`).** This is optional and switched on only when `firebase-config.js` sets `window.FIREBASE_CONFIG`.
Firebase compat SDKs are vendored and loaded lazily. The state is split into Firestore documents
`users/{uid}/docs/{trip_…|item_…|check_…}`. After each save, the local state is compared with the last known remote copy (kept in
localStorage `tripPlanner.sync`), and only the differences are sent. Only documents of those three kinds are ever
removed (`SYNCED_KINDS`), so a newer version can keep other kinds next to them. Remote snapshots are merged into
`state`. A plan changed both here (not sent yet) and elsewhere is merged field by field (`mergeDoc`: theirs, with
the fields changed here on top), because deleting a plan changes the `pos` of every plan after it. `settings` stay on each phone and are never synced. Account actions (Settings → Account): the sign-in sheet
has two modes (`setAuthMode`); change password and delete account share `#account-dialog` and both ask for the current
password first (`confirmUser`). `deleteAccount` stops listening before it empties the account, so this device keeps
its plans. The status line counts unconfirmed documents (`waitingCount`) and shows `sync.saved.at`. A new account gets
a confirmation email; until `sync.saved.verified` is true Settings shows "Confirm your email" (nothing is blocked).
Settings → About: the privacy note (`openPrivacy`; update it when a new outside service is called) and "Report a
problem" (`#report-dialog`, `openReport` in about.js): a form with the user's words, an optional reply email, and
`problemDetails()` (version, device, counts, sync state, `recentErrors`; never plan content, and the form shows it).
With `window.REPORT_KEY` (a Web3Forms access key, public by design) it is POSTed to Web3Forms, which emails the owner;
without it, or when that fails, `shareReport` uses the Share menu or the clipboard. `firestore.rules` must be pasted into the
Firebase console by hand; it isn't deployed from here.

**Shared trips (`share.js`, with `sync.js`).** A trip planned by several accounts is marked `trip.shared = <id>` and
kept outside the accounts: `shared/{id}` says who is on it (`{ owner, trip, code, uids[], members{uid: {email, at, via}} }`)
and `shared/{id}/docs/…` holds the trip and its plans, in the same form as an account's own documents.
- sync.js works per "space": `''` is the account's own (`sync.own`, base in `sync.saved.base`), each shared trip has
  one (`sync.shared[id]`, record in `sync.saved.shared[id]`: `{ trip, base, fresh, seen, at }`). `stateDocs`, `applyDocs`,
  `mergeRemote` and `pushSpace` take the space. A shared trip's `pos` is always 0 (everyone keeps their own order), and
  writes to a shared space go in batches of `SHARED_BATCH` (10): the rules look up `shared/{id}` for each write, and
  Firestore allows about 20 such look-ups per batch.
- The account's list of shared trips is one query (`uids array-contains me`, `onRoots`). It decides everything: a
  trip on the list is followed (`attachShare`), a trip no longer on it goes away from the device (`dropShare`).
  There are no pointers in the account's own documents (an older version of the app would delete them).
- A shared trip is never removed by leaving it out of `state`: `pushSpace` sends nothing for a shared space with no
  trip, and the next answer brings the trip back. Leaving (`leaveRemote`), removing someone (`removeRemote`, which
  changes the code) and deleting for everyone (`deleteSharedRemote`, owner only) are done on purpose, online only.
  "Erase everything" and deleting the account call `quitSharing` first; "Restore from backup" keeps shared trips.
- A trip is in the app once: when a shared trip arrives, the account's own trip with the same id (a copy from
  before it was shared, or the trip itself on the owner's other devices) becomes it, and its own documents are
  removed at the next save. Only the trip named in `shared/{id}.trip` is taken from a shared space.
- A shared trip has a list of its own for everyone on it: `trip.todos` (`[{ id, text, done }]`), synced as `todo_…`
  documents next to the trip's plans (not `check_…`: version 2.10 would remove those). The Checklist tab shows it
  for the trip that is open, above the personal checklist (`tripListHTML`; `listAt(el)` / `listNamed('trip' | 'own')`
  tell which list a row, button or form belongs to). Rows are dragged between the two lists, or to another spot in
  their own (`listTarget` / `dropOnList` in drag.js; the places to drop are `[data-list]`, the open items `ul.tasks`).
  On a shared trip each packing suggestion has two buttons: "+" for the personal checklist, the people icon for
  the trip's list. Files are never shared, by the owner's choice (2026-10-10): the app says so in the
  plan form, the Tickets sheet, the Share sheet and the privacy note.
- An invitation is `<id>.<code>`, sent as a link `…/#join=<id>.<code>` (after the `#`, so the host never sees it;
  `checkInviteLink`, or pasted under Settings → Trips → "Join a trip"). Joining is one write that adds the account
  to `uids` and `members` with the code as `via`; the rules compare it with the trip's code, and the email with the
  account's own. Members' email addresses are shown to the others on the trip, nowhere else.
- First attach on a device (`fresh`) takes what the database has, never the device's copy. Signed out, a shared
  trip stays on the device with its mark and follows the account again after signing in.
- Changing what `shared/…` holds means changing `firestore.rules` (and `tools/fake-firebase.js`), and the owner has
  to publish the rules by hand. With old rules the list fails with permission-denied: `sharing.off`, and the Share
  sheet says planning together isn't switched on. Nothing else is affected.

**Feature voting (`vote.js`).** Settings → About → "What should come next?" (`#vote-dialog`). Apart from shared
trips, the only data shared between accounts: `featureVotes/{uid}` (`{ ids }`, the keys that account voted for) and `featureIdeas/{uid}_{0…4}`
(`{ title, text, uid, at }`; the document name is what caps suggestions at five per account). The app's own proposals
are `FEATURE_IDEAS`; never reuse an id. A suggestion's vote key is `<doc>.<at>`, so a new one in the same slot starts
at zero. Both collections are listened to only while the sheet is open. `tallyVotes` counts; the order on screen is
fixed when the votes arrive (`voting.order`) so rows don't jump while voting. No names or emails are stored or shown.
A vote is saved by the tap itself, on the row or its button, and the sheet has to say so: the row lights up
("You voted for this") and the bottom line reads "2 votes saved" next to "Done" (`voteStatus`). The form for a
suggestion stays closed behind "Suggest something else" (`suggesting`), and "Done" is away while it is open: a tester
took "Send suggestion", then the only button in the sheet, for "save my votes".
`deleteAccount` calls `eraseVoting`. Changing what is stored means changing `firestore.rules` too, and the owner has
to publish them by hand.

**Offline / updates (`sw.js`).** The service worker serves cached files first and refreshes them in the background (stale-while-revalidate).
When you **add a new app file**, add it to `FILES` (`js/selfcheck.js` is there too, so the self-check matches the saved app; the self-check fails on a file the page loads that `FILES` misses). When you **ship any change**, add an entry at the top of `CHANGELOG` in `js/version.js`
(`x.y.z`: the app looks or works differently . something new . fixes only), written for users in plain words and
kept short: `{ v, date, items }`, no title, what is new in five short lines at most, and all the fixes as one line,
"Bug fixes" (the self-check enforces this). The owner wants it easy to digest: a fix is never described, not even
one users would notice ("a stay keeps its icon", "times are closer to the real ones"), and a fixes-only version
says just "Bug fixes". "What's new" shows each as "Version x.y.z", the date (the first one with "on this
device"), the lines; only the latest five show until "Earlier versions" is tapped.
`APP_VERSION` is that first entry. `sw.js` imports it for its cache name (`trip-planner-v1.2.3`), which is how
installed phones pick up the new version. Settings → About → "What's new" lists every entry (`openChangelog`), and
after an update a snackbar offers it once (`settings.seenVersion`). The big vendored libraries (MapLibre, Firebase) are in
`LIBS`: saved at install too, but the install doesn't fail without them. Files are saved without their `?query`.
OSM tiles go in a separate cache that is kept between versions (`trip-planner-map-tiles`, capped at 900 tiles).
The map's style and index are asked fresh, but a saved copy only waits `FRESH_WAIT` for the internet (`mapTile`),
and `loadMapStyle` gives up after 8 seconds: a weak connection must not leave the map empty.

**Security.**
- `index.html` has a Content-Security-Policy `<meta>`: scripts run only from the app's own files and Google's
  reCAPTCHA (for App Check). So: no inline `<script>`, no inline handlers (`onclick="…"`, `onerror="…"`) in HTML or in
  template strings; use `addEventListener` (see the `img[data-photo]` error listener in ui.js). A new outside script
  needs its host added to the policy. On phones, Firebase Auth tries to load `apis.google.com/js/api.js` (only needed
  for Google sign-in pop-ups, which the app doesn't use): the policy blocks it, and that console message is expected.
- The policy also blocks plugins (`object-src 'none'`). The self-check guards it (it fails without `script-src 'self'`,
  with `unsafe-inline` or `unsafe-eval`), and fails on an `on…=` attribute or a `javascript:` link anywhere in the code,
  and on a link opening a new tab without `rel="noopener"`.
- The policy lists the servers the page may talk to (`connect-src`: Firebase/Google, Photon, Nominatim, the OSM router,
  Overpass, Open-Meteo, OpenFreeMap, Wikipedia/Wikivoyage/Wikidata, Web3Forms). A new outside service needs its host
  added there, or its requests are blocked. The self-check fails on a `fetch(`/`getJSON(` address (written there or in
  a `const NAME = 'https://…'`) that isn't on the list, and anything the policy blocks is noted in `recentErrors` (only
  its site) for "Report a problem". Images aren't limited (photos and map tiles come from many hosts).
- The vendored libraries are checked against GitHub's advisory database (`api.github.com/advisories?ecosystem=npm&affects=maplibre-gl@6.16.0`)
  before a version is raised, and now and then. 2.17.1 left MapLibre 5 for 6.16 over CVE-2026-85061 (an XSS through a
  style's attribution). MapLibre 6 is a module only: maps.js `import()`s `maplibre-gl.mjs` and sets `window.maplibregl`
  for the bridge, and the map worker is `maplibre-gl-worker.mjs` next to it (both in `LIBS`). `tuneMapStyle` drops the
  style's `attribution`s: the app writes its own credit line.
- Everything written into the page goes through `esc()`, ids included. Wikivoyage, OpenStreetMap, AI answers and
  backup files are all text other people can write.
- Attachments (`files.js`) accept photos and PDFs only (`SAFE_FILE`). No SVG or HTML: opened from a `blob:` address,
  they would run with the app's own access.
- "Erase everything" also clears what is only on the device (`eraseDeviceData`). Add any new `tripPlanner.*` key there.
- "Erase everything" and "Restore from backup" replace `state`, settings included. What says "this device already
  did that" (`deviceMarks`: `geoRetry`, `seenVersion`, and the language) is carried over, or the one-time repairs at startup run again.
  Add any new marker of that kind there.

**Styles (`css/`).** `index.html` links them in cascade order: `base.css` (font, color tokens, page, ripple, keyboard
focus, reduced motion) → `components.css` (lists, a plan or place in a list, chips, the done circle, empty states,
settings rows, buttons, snackbar, sheets and fields, segmented buttons, filter chips, switches) → `shell.css` (top bar,
day strip, page column, the + and AI buttons, navigation bar) → `plan.css` → `ideas.css` → `checklist.css` → `map.css`
→ `sheets.css` (the features' sheets) → `desktop.css`. At equal specificity a later file wins: put a rule with its topic,
and change the rule itself rather than adding an override further down (the two "later pass" blocks that used to end
the stylesheet were folded back in 2.16.1). `url()` paths are relative to `css/` (`../fonts/…`).

**Desktop layout (`css/desktop.css`).** There is one codebase, and the layout switches by window width.
Phone styles are the default. Add desktop overrides in desktop.css (loaded last), and check phone, ~1000px and
~1400px.
- From 900px: `.navbar` becomes a labelled sidebar (`--rail-w`) with the FAB ("New plan") at its top, and `#side-extra`
  below the sections (AI Assistant, the trip's days as `jump-day` links; `renderSidebar` in render.js). Content is one
  reading-width column (`--content-w`). Days are never laid out in columns. Sheets become centered windows, and the AI
  Assistant sheet docks on the right.
- From 1200px on the Plan tab: the map is docked in `#map-pane` on the right (`body.has-map`). `syncMapDock()`
  (maps.js, called at the end of every `render()`) moves the single `#map` element between `#map-slot` and the map
  dialog. `openMap(day)` then only points the docked map at that day. Use `mapShown()` / `mapDocked()` instead of
  checking the dialog.
- With a mouse, `drag.js` starts a drag on move (no long-press).

**UI decisions worth keeping.**
- The navigation bar has four sections: Plan, Ideas, Checklist, Settings (`plan`, `ideas`, `pack` and `more` in the
  code). Change section with `showView(view)` or `setView(view)` (render.js), never by setting `ui.view`: they keep each
  section's scroll position (`scrollAt`) and the browser's history in step. Leaving the Plan adds one history step, so
  the device's Back button returns to the Plan instead of closing the app. Tapping the section already open scrolls
  to its top. The bar is 64px tall (`--nav-h`, Material 3 Expressive's shorter bar).
- The trip card (`.hero`) is compact on purpose, so today's plans are on the first screen.
- The trip card's Share button opens `#share-dialog` (`openShare` in share.js): "Plan it together" (invite people,
  who is on the trip, the link) and "Just show the plan" (the itinerary as text, `shareTrip` in maps.js). Once
  someone else is on the trip the button reads "2 people", and the trip's tab shows a small people icon.
- On a phone the AI Assistant is a small button stacked on the "New plan" FAB (`#ai-fab`), on the Plan and Ideas
  tabs. Both buttons slide away while scrolling down (`body.fabs-away`, set in `onScroll`), so they don't cover the
  plans' done circles, and come back on scrolling up, at the end of the page, or on opening a section (`showFabs`).
  On a computer it is in the sidebar. It is not on the trip card.
- Plan view (Wanderlog-like): each day has a big title, its travel total (`day-total`) and tools above the list,
  the stay as a pill at the top (`stay-pill`), white cards (`.group.plans`) with the stop's number (same as its map
  pin; plans not on the map keep their category icon, and a stay keeps its hotel icon, as on the map) and a photo (`planPhoto` in info.js: the guide's, else the
  Wikipedia article's, looked up three at a time), and dotted lines with the travel time between stops (`legHTML`).
- Plan cards show one row of actions, with the done circle at its end. Secondary ones are icon-only (`.assist-chip.icon-only`, with `title` and
  `aria-label`). The link and ticket chips are `.compact`: labeled on a wide window, icon-only under 600px, where the
  row also starts at the card's edge. Check a card with a link at 360px before adding an action. The address line is
  hidden when it repeats the title.
- A day's tools (`.day-tools`) are one row on a phone, scrolled sideways. Two fields side by side go in `.row2`
  (its columns are `minmax(0, 1fr)`, or a date pushes the form wider than the screen).
- The plan and trip forms keep their actions (`.sheet-actions`) stuck to the bottom of the sheet.
- Sheets close with their ✕, a tap outside, a swipe down, Esc or Back, all through `closeSheet`. A tap outside
  must start and end there: selecting text and letting go outside the sheet sends the dialog a click too (a
  tester lost a typed plan that way). Sheets to type in (`DRAFTS`: plan, trip, report, suggestion) ask "Discard…?"
  first when their form changed since it opened (`draftStart`, called by their open functions). Esc is caught on
  `keydown`: the browser lets a page stop the dialog's `cancel` only once per tap or key typed.
- Suggestion cards all start with `.s-photo`: the photo, over the type's color and icon when there is none.
- Settings: "Appearance" is the choices (`.row.pick`: Language, Theme, Units, Date (English only), Time; their buttons share the width by word length; on a phone the name is above its buttons, as "Language"
  ran into "English" beside them); the switches that fetch or
  suggest things are under "Planning help".
- Suggestions are open only for the "focus day" (first day from today with suggestions). Other days show a one-line
  `suggest-toggle`, and `ui.suggest[day]` remembers a manual toggle.
- Phones have a `#day-strip` under the trip tabs (`renderDayStrip`). `markCurrentDay()` highlights the day on screen
  there and in the desktop sidebar.
- The plan form's example texts come from the trip's guide and the chosen type (`planExamples`). Don't hard-code a city.
- The plan form lists matching real places under the name and the address as you type (`findMatches`: the guide, then
  Photon, kept to places near the trip with `nearTrip`). Picking one fills the address and saves its `lat`/`lng` (and
  `guideId`), so no address lookup is needed. Nothing is matched without a pick.
- "Auto-fill day" (a day tool, `autoFillDay` in guide.js) adds guide sights to a day until it holds about 8 hours, then
  runs `optimizeDay`. It picks by interest first (`placeInterest`, mostly the place's `fame`), minus a cost per mile
  from the day's plans, and only from the most interesting quarter of the guide; an empty day starts from the most
  interesting place not in the trip yet. No AI, no times, no meals, with Undo. Not offered with a Wikipedia guide.
- Plan cards show "Book ahead: …" (`bookingNote`) only for what is known to sell out, not for every fee or timed
  entry. `lookupBooking` (assistant.js) asks Flash-Lite once per new plan name, a trip's plans in one request, and
  keeps the answers per device in `ai.saved.booking`; until there's an answer, only the guide's own words count
  ("sells out", "weeks in advance"). The note goes when the plan's form has "Booked, or no booking needed" switched on
  (`item.booked`, synced) or a ticket is attached. Switch in Settings: `settings.booking`.
- Colors: the trip's color themes the app itself (trip card, buttons, links). Each day also has its own color
  (`dayTint(i)` in maps.js, set as `--day` on the day's section): its stop numbers, travel lines, dot in the day strip
  and sidebar, and its pins and route on the map (day map and trip map alike). The "Book ahead" label is amber on
  every trip, so it reads as a notice, not as part of the theme. Don't recolor whole days.
- Ideas (Ideas tab) have "Add to a day" (`pick-day` / `set-day`) in place of the done checkbox.
- On desktop, hovering a plan highlights its pin (`hotPin`), and the docked map opens on today's route during the trip.
- A hidden present for a friend of the owner who drums: eight taps on the title of the "What's new" sheet
  open a practice pad to play (`openPad` in pad.js; the words on it are `PAD_NAME`). Keep it out of
  the changelog and the README.
- Keyboard focus is shown with a global `:focus-visible` outline. Don't remove outlines without a replacement.

## Conventions

- External services (Photon, Nominatim, Wikivoyage/Wikipedia/Wikidata, OSM tiles, Firebase) are called straight
  from the browser. Don't add anything that needs a server or API keys we'd have to keep secret.
- Keep every feature working offline once loaded, or have it fail gracefully offline (the `#offline-badge` / `navigator.onLine` checks).
- UI follows Material 3 Expressive. Icons use `icon(name)` → `<svg><use href="icons/sprite.svg#name">`.
- Code comments are short and in plain language. Match that style.
