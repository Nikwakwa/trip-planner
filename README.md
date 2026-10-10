# Dotted Line

A small, installable web app (PWA) for planning a trip on your phone — and on your computer:
the same address shows a desktop layout on a wide screen, by itself.

- Plain HTML, CSS and JavaScript — no frameworks, no server of your own.
- Everything you type is saved on the phone itself (browser storage).
- Optional: sign in to see your trips on all your devices, and to **plan a trip together** with other
  people, each from their own account (see "Planning a trip together").
- Type a city or country for a new trip: the app finds the real place and suggests
  things to do there (from the Wikivoyage travel guide).
- Each trip day shows the weather forecast; on rainy days the suggestions favor indoor places.
- **Essentials** for each trip: emergency number, plugs, currency, local time, and tips
  on getting around and staying safe, saved for offline use.
- Hold a plan or an idea and drag it onto a day, or to another spot in the day.
- Warns when a plan is on a day or at a time the place is usually closed.
- An **AI Assistant** that plans days and edits your trip when you ask (free, see below).
- Each trip gets around by **public transit + walk** or **drive + walk** (set in the trip; a day can differ),
  for travel times, directions and route links. Distances and temperatures in metric or imperial units
  (**Settings → Appearance → Units**).
- During the trip: **Now & next** (what's on and when to leave for the next plan) and **What's near me**.
- A **Stay** plan with an address (your hotel) becomes the **home base**: days start and end there.
- **Photos** of places, **packing suggestions** from the forecast and your plans, **Add to calendar**,
  **tickets & bookings** attached to plans, and **booking emails** turned into plans by the AI Assistant.
- Works offline once it has been opened one time.

## Files

| File | What it does |
|------|--------------|
| `index.html` | The page structure (what's on screen). |
| `theme.js` | Picks light or dark before the page shows. |
| `styles.css` | The look: colors, spacing, fonts. |
| `app.js` | The behavior: adding plans, saving, switching trips. |
| `places.js` | Finds a trip's place (OpenStreetMap) and builds a guide for it (Wikivoyage, Wikipedia). |
| `sync.js` | Sign-in and syncing plans between devices (Firebase). |
| `share.js` | Planning a trip together: invitations, who is on a trip, the Share sheet. |
| `firebase-config.js` | Your Firebase project's settings (see below). |
| `firestore.rules` | Database rules: each account only sees its own plans, and the trips it was invited to. |
| `vendor/firebase/` | Firebase library, stored in the app. |
| `maps.js` | Day and trip maps, Optimize route, address lookup, sharing. |
| `mapstyle.js` | The look of the map: landmark labels and the dark (night) version. |
| `vendor/maplibre/` | MapLibre GL, the library that draws the detailed map (BSD-3 license), stored in the app. |
| `weather.js` | The forecast for each trip day (Open-Meteo). |
| `essentials.js` | The Essentials sheet (Wikidata facts, Wikivoyage tips). |
| `hours.js` | Opening hours and "usually closed" warnings (OpenStreetMap). |
| `drag.js` | Hold and drag plans and ideas onto days. |
| `assistant.js` | The AI assistant chat (Gemini through Firebase, or the Claude / Gemini app). |
| `today.js` | Home base (your hotel), "Now & next" during the trip, and "What's near me". |
| `calendar.js` | Add plans to Google Calendar, or the whole trip as a calendar file. |
| `files.js` | Tickets & bookings attached to plans (kept on the phone). |
| `packing.js` | Packing suggestions for the Checklist. |
| `info.js` | "About this place" for a plan: what it is, hours, photos, what to know (Wikivoyage, Wikipedia). |
| `vendor/leaflet/` | Leaflet map library (BSD-2 license), stored in the app. |
| `fonts/`, `icons/sprite.svg` | Google Sans Flex and Material Symbols, stored for offline use (`tools/fetch-assets.ps1`). |
| `manifest.webmanifest` | Tells the phone the app's name, icon and colors so it can be installed. |
| `sw.js` | The "service worker": keeps a copy of the app so it opens offline. |
| `vote.js` | Voting for new features, and suggesting your own (Settings → About). |
| `version.js` | The app's version number and the list of what changed in each version ("What's new"). |
| `selfcheck.js` | A self-check of the parts that must not break (see "Updating the app later"). |
| `icons/` | The logo and the app icons for the home screen. |
| `serve.ps1` | A tiny local web server for testing on this computer. |
| `tools/make-icons.ps1` | Draws the logo (`icons/logo.svg`) and the app icons from it (needs Microsoft Edge). |
| `tools/fake-firebase.js` | A pretend Firebase, to test sign-in, sync and shared trips on this computer without real accounts. The app never loads it. |

## Try it on this computer

In PowerShell, in this folder, run `.\serve.ps1`, then open <http://localhost:8080> in Chrome.
Press `F12` → the phone icon to see it at phone size.

## Put it on your Pixel

Phones only install apps from a secure (`https://`) web address, so the files need to be hosted
somewhere. Free option: GitHub Pages (upload this folder to a GitHub repository → Settings → Pages).
Then on the Pixel:

1. Open the `https://…` address in Chrome.
2. Go to **Settings → Install app** (or Chrome menu ⋮ → **Add to home screen → Install**).
3. Open it once while online. From then on it works offline.

On an **iPhone or iPad**: open the address in Safari, tap the **Share** button, then **Add to Home Screen**.

## Updating the app later

After changing files, the phone picks up the new version automatically: open the app while
online, then close and reopen it.

Every update gets a new **version number** and a few lines saying what changed, at the top of the list
in `version.js`. The app shows that list under **Settings → About → What's new**, back to the first
version, and offers it once after each update. A number has three parts, like `2.5.0`: the first changes
when the app looks or works differently, the second when something new is added, the third for fixes only.

Before sending an update out, run the **self-check**: add `?selfcheck` to the app's address
(on this computer: <http://localhost:8080/?selfcheck>). It tests dates, backups, syncing, AI answers
and opening hours on made-up plans (yours are not touched) and shows what passed. If a line is red,
don't ship. It is also a quick first test on a new kind of phone.

## Planning a trip together

Each person has **their own account**, and a trip can be on several accounts at once.

1. Open the trip, tap **Share** on its card, then **Invite people**. The trip gets an **invitation link**.
2. Send the link (WhatsApp, email…). Whoever opens it, and signs in or creates an account, **joins the trip**.
   They can also paste it under **Settings → Trips → Join a trip** (the way to go on an iPhone when the
   app is on the home screen, because a tapped link opens in Safari instead).
3. From then on everyone sees the same days, plans and ideas, and anyone can change them. A change
   shows up on the others' phones within a second or two.

Good to know:
- The Share sheet lists **who is on the trip**, by email address. Only the people on the trip see that list.
- The person who started it can **remove** someone (the link is then replaced, so the old one stops working)
  and can **delete the trip for everyone**. The others can **leave**; the trip then goes away from their devices only.
- Shared: the trip, its plans and ideas. **Not** shared: the checklist, tickets & bookings, AI Assistant chats,
  and your other trips.
- Twenty people at most on one trip.
- Did the two of you use **one account** until now? It still works. To move to an account each: one of you signs
  out, creates their own account, and is then invited to the trips. If their phone still has a copy of a trip,
  the app asks before replacing it with the shared one.
- **Share → Send as text** still sends the plan as plain text, to read in any app.

**One step for you, once:** shared trips are kept in your Firebase project, and its rules must allow it.
In the [Firebase console](https://console.firebase.google.com): **Firestore Database → Rules**, replace
everything with the contents of `firestore.rules`, and **Publish**. Until then the Share sheet says
"Planning together isn't switched on for this copy of the app yet". Everything else works as before.

To see the shared trips in the console: **Firestore Database → Data**, collection `shared`. Each entry lists
the accounts on the trip, and holds the trip's plans under `docs`.

## Voting for new features

**Settings → About → What should come next?** shows a list of features that could be built. Everyone who is
signed in can vote for as many as they like, and send up to five suggestions of their own. Nobody's name
or email is shown. The app's own proposals are the list at the top of `vote.js`.

**One step for you, once:** the votes are kept in your Firebase project, and its rules must allow it.
In the [Firebase console](https://console.firebase.google.com): **Firestore Database → Rules**, replace
everything with the contents of `firestore.rules`, and **Publish**. Until then the sheet says
"Voting isn't switched on for this copy of the app yet".

To look at the results or remove a suggestion you don't want: **Firestore Database → Data**, collections
`featureVotes` (one entry per person) and `featureIdeas` (the suggestions; delete an entry to remove it).

## Report a problem

The app has no server of its own, so it can't send email by itself. A free service,
[Web3Forms](https://web3forms.com), does it: the app hands it the report, and it emails you.
Free for 250 reports a month, no card. One-time setup, about a minute:

1. Go to <https://web3forms.com>, type your email address and ask for an **access key**.
2. The key arrives by email (a long code with dashes). Put it in `firebase-config.js`:
   `window.REPORT_KEY = 'your-key-here';`
3. Upload the changed file.

The key is not secret: all it can do is send a message to your inbox, and it keeps your address out
of the app's files. Until the key is there (or if sending fails), the form hands the report to the
phone's Share menu instead, so it can still reach you by any messaging app.

## For the people you share the app with

- To plan a trip with someone, they need the app and an account of their own: see "Planning a trip together".
- **Settings → About → Privacy** explains where plans are kept and what is sent to which service.
- **Settings → About → Report a problem** is a form: they write what went wrong and can add their
  email for an answer. The version, the kind of device and the app's last errors go with it, never
  their plans (the form shows exactly what is sent). See "Report a problem" below to get these by email.
- A new account gets an email with a link to **confirm the address**. Nothing is blocked without it;
  it makes sure "Forgot password?" can reach them. The email comes from Firebase and may land in spam.

## Your data

Plans are stored in the app on your phone (and, when signed in, in your Firebase account). Use **Settings → Save backup file** before the trip,
and **Restore from backup file** to bring plans back or move them to another phone.

**Settings → Erase everything** removes the trips, plans and checklist, and also what is kept on that device only:
tickets and bookings, AI Assistant chats, and the saved guides and forecasts. Trips you invited people to are
deleted for them too, and you leave the trips you were invited to (the app says so before erasing).
**Restore from backup** never touches a trip you plan with other people.

Safety: the app only runs its own code. Text that comes from outside (travel guides, a backup file, the AI Assistant,
another device) is always shown as plain text, and tickets can only be photos or PDFs.

## Sync between devices

Your phones sign in with the **same email and password**; then a plan added on one phone
appears on the other within a second or two (or as soon as it is back online).
(Two people with an account each share single trips instead: see "Planning a trip together".)
This uses a free Firebase project (Google). One-time setup, about 5 minutes:

1. Go to <https://console.firebase.google.com> → **Create a project** (any name; Analytics not needed).
2. **Build → Authentication → Get started → Email/Password → Enable → Save.**
3. **Build → Firestore Database → Create database** → pick a location near you → start in
   **production mode**. Then open the **Rules** tab, replace everything with the contents of
   `firestore.rules`, and **Publish**.
4. **Project settings** (gear icon) → **Your apps → Web (`</>`)** → register an app (no hosting).
   Copy the `firebaseConfig = { … }` values into `firebase-config.js`
   (replace `window.FIREBASE_CONFIG = null;` with `window.FIREBASE_CONFIG = { … };`).
5. **Authentication → Settings → Authorized domains → Add domain**: your GitHub Pages address,
   e.g. `yourname.github.io` (`localhost` is already there).
6. Upload the changed files. In the app: **Settings → Sign in to sync → Create account** on the
   first phone, then **Sign in** with the same email and password on the second phone.

Notes:
- The values in `firebase-config.js` are not secret; the rules keep each account's plans private.
- The first time a phone signs in to an account that already has plans, it asks whether to
  add that phone's own trips too. Appearance settings stay separate on each phone.
- Signing out keeps a copy of the plans on the phone, but it stops syncing.
- Under **Settings → Account** you can see whether everything is saved (and how many changes are
  still waiting while offline), **change the password** (the other phones then have to sign in
  again) and **delete the account**. Deleting removes the login and the plans stored in it; the
  phone you delete it from keeps its copy of the plans. Trips that account invited people to are
  deleted for them too.

## Suggestions for any city or country

When you add a trip, type the place and pick it from the list (or just type it and save: the
best match is used). The app then fetches that place's
[Wikivoyage](https://en.wikivoyage.org) guide once and saves it on the phone:

- **A city** → sights, food, drinks and shopping, grouped by neighborhood, shown under each
  day and in **Ideas → Explore**.
- **A country or region** → its main cities and destinations.
- No Wikivoyage page → the best-known places nearby from Wikipedia.


## Weather, essentials and opening hours

All free services, no account or key needed:

- **Weather** (Open-Meteo) shows up to about 16 days ahead. Days already fetched stay visible offline.
  Temperatures follow **Settings → Appearance → Units** (°C or °F).
- **Essentials** (the button on the trip's card) are fetched once while online and kept on the phone.
- **Opening hours** come from OpenStreetMap, or the travel guide. They're hints: always check before
  going. Turn off **Settings → Find addresses and opening hours** to stop these lookups.

## AI Assistant

Tap the **AI Assistant** button (the sparkle above the **+** button on a phone, in the sidebar on a computer) and ask in your own words, e.g. "Plan Saturday around Belém,
nothing before 10" or "Move the museum to Monday". The assistant shows the changes first; nothing
changes until you tap **Apply** (and **Undo** puts things back).

It uses Google's Gemini through your Firebase project, on the **free** tier:
- **Gemini 3.8 Flash**, about 20 requests a day (shared by both phones). When that's used up,
  it switches by itself to **Gemini 3.5 Flash-Lite** (about 500 a day) until the next day.
- It can't cost anything: the Firebase project has no billing account. At worst it pauses until tomorrow.
- On the free tier, Google may use what you send (your trip and requests) to improve its products.

Prefer another AI app (for example one you have a subscription for)? In the assistant, tap **Use another
AI app instead**: copy the request, paste it into that app, then paste its answer back.

### One-time setup (about 10 minutes)

1. **Switch on AI Logic.** <https://console.firebase.google.com> → your project → **AI Logic**
   (under "AI services" in the menu) → **Get started** → choose **Gemini Developer API** (the no-cost one)
   → follow the steps to the end. It switches on the needed services. Don't add a billing account.
2. **Create a reCAPTCHA key** (Google's free bot check, which proves requests come from your app):
   <https://console.cloud.google.com/security/recaptcha> → pick the same project at the top →
   **Create key** → Platform **Website** → domains: `nikwakwa.github.io` and `localhost` → **Create**.
   Copy the **key ID**.
3. **Connect it to App Check.** Firebase console → **App Check** (under "Security" in the menu) → **Apps** →
   your web app → **reCAPTCHA Enterprise** → paste the key ID → **Save**.
4. **Put the key ID in the app:** in `firebase-config.js`, replace `window.RECAPTCHA_SITE_KEY = null;` with
   `window.RECAPTCHA_SITE_KEY = 'your-key-id';` (it isn't secret), and upload the change.

Notes:
- From 2 November 2026, Firebase requires App Check for the assistant, so steps 2–4 aren't optional.
- reCAPTCHA is free up to 10,000 checks a month, far more than the assistant uses.
- Testing on this computer (`localhost`) needs one more step: the browser console prints an
  "App Check debug token" — add it in Firebase → App Check → your web app → **Manage debug tokens**.

## Tickets, calendar and location

- **Tickets & bookings**: edit a plan → **Attach** a photo or PDF (boarding pass, museum ticket…). They're saved on
  that phone only — not synced to the other phone and not in backup files — and open offline.
- **Add to calendar**: the **Calendar** button on a plan opens Google Calendar with it filled in. For the whole trip,
  **Settings → Calendar file for …** saves a file to import (Google Calendar on a computer: Settings → Import & export).
- **What's near me** asks the phone for its location once; nothing is sent anywhere (the guide is already on the phone).
- **Booking emails**: in the AI Assistant, tap **Add from a booking email**, paste the confirmation and send. As with
  everything the AI Assistant does, you see the plans first and tap **Apply**.

## On a computer

Open the same address in a browser on your computer. On a wide window the app switches to a desktop layout by
itself: a sidebar on the left (New plan, the sections, the AI Assistant and your trip's days), your plan in the
middle, and the trip's map always in view on the right. Click a day in the sidebar, or a day's **Map** button, to see
that day's route; click a pin to find its plan in the list. Make the window narrow and it's the phone layout again.
In Chrome or Edge, the install icon in the address bar makes it a desktop app.

Your trips are per device: **sign in (Settings → Sign in to sync)** with the same account as on your phone to see the
same trips. Tickets & bookings and appearance settings stay on the device where you set them.

## Map style

The maps are detailed "vector" maps, the kind Google Maps uses: street and neighborhood names, stations, and
landmarks, shops and restaurants as you zoom in. The map data comes from OpenStreetMap through
[OpenFreeMap](https://openfreemap.org) (free, no account or key), drawn by the MapLibre library stored in the app.
The app adjusts the style itself (`mapstyle.js`): landmarks show up earlier, and in dark mode the same map is drawn
in night colors, following the app's light/dark setting.

Map areas you've viewed are kept on the phone for offline use.

If the vector map can't load (a very old browser, or offline before it was ever opened), the app falls back to a
simpler picture map: CARTO's style if `window.CARTO_KEY` is set in `firebase-config.js` (a free key from
<https://carto.com/basemaps/apikey>), otherwise the standard OpenStreetMap one.
