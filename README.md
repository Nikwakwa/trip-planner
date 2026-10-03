# Trip Planner

A small, installable web app (PWA) for planning a trip on your phone — and on your computer:
the same address shows a desktop layout on a wide screen, by itself.

- Plain HTML, CSS and JavaScript — no frameworks, no server of your own.
- Everything you type is saved on the phone itself (browser storage).
- Optional: sign in to share trips between phones (e.g. yours and your partner's).
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
  (**More → Appearance → Units**).
- During the trip: **Now & next** (what's on and when to leave for the next plan) and **What's near me**.
- A **Stay** plan with an address (your hotel) becomes the **home base**: days start and end there.
- **Photos** of places, **packing suggestions** from the forecast and your plans, **Add to calendar**,
  **tickets & bookings** attached to plans, and **booking emails** turned into plans by the AI Assistant.
- Works offline once it has been opened one time.

## Files

| File | What it does |
|------|--------------|
| `index.html` | The page structure (what's on screen). |
| `styles.css` | The look: colors, spacing, fonts. |
| `app.js` | The behavior: adding plans, saving, switching trips. |
| `guides.js` | Built-in Boston and NYC guides used for suggestions and Explore. |
| `places.js` | Finds a trip's place (OpenStreetMap) and builds a guide for it (Wikivoyage, Wikipedia). |
| `sync.js` | Sign-in and syncing plans between phones (Firebase). |
| `firebase-config.js` | Your Firebase project's settings (see below). |
| `firestore.rules` | Database rules: each account only sees its own plans. |
| `vendor/firebase/` | Firebase library, stored in the app. |
| `maps.js` | Day and trip maps, Optimize route, address lookup, sharing. |
| `weather.js` | The forecast for each trip day (Open-Meteo). |
| `essentials.js` | The Essentials sheet (Wikidata facts, Wikivoyage tips). |
| `hours.js` | Opening hours and "usually closed" warnings (OpenStreetMap). |
| `drag.js` | Hold and drag plans and ideas onto days. |
| `assistant.js` | The AI assistant chat (Gemini through Firebase, or the Claude / Gemini app). |
| `today.js` | Home base (your hotel), "Now & next" during the trip, and "What's near me". |
| `calendar.js` | Add plans to Google Calendar, or the whole trip as a calendar file. |
| `files.js` | Tickets & bookings attached to plans (kept on the phone). |
| `packing.js` | Packing suggestions for the Checklist. |
| `vendor/leaflet/` | Leaflet map library (BSD-2 license), stored in the app. |
| `fonts/`, `icons/sprite.svg` | Google Sans Flex and Material Symbols, stored for offline use (`tools/fetch-assets.ps1`). |
| `manifest.webmanifest` | Tells the phone the app's name, icon and colors so it can be installed. |
| `sw.js` | The "service worker": keeps a copy of the app so it opens offline. |
| `icons/` | App icons for the home screen. |
| `serve.ps1` | A tiny local web server for testing on this computer. |
| `tools/make-icons.ps1` | Redraws the icons if you want a different color. |

## Try it on this computer

In PowerShell, in this folder, run `.\serve.ps1`, then open <http://localhost:8080> in Chrome.
Press `F12` → the phone icon to see it at phone size.

## Put it on your Pixel

Phones only install apps from a secure (`https://`) web address, so the files need to be hosted
somewhere. Free option: GitHub Pages (upload this folder to a GitHub repository → Settings → Pages).
Then on the Pixel:

1. Open the `https://…` address in Chrome.
2. Go to **More → Install app** (or Chrome menu ⋮ → **Add to home screen → Install**).
3. Open it once while online. From then on it works offline.

## Updating the app later

After changing files, the phone picks up the new version automatically: open the app while
online, then close and reopen it.

## Your data

Plans are stored in the app on your phone (and, when signed in, in your Firebase account). Use **More → Save backup file** before the trip,
and **Restore from backup file** to bring plans back or move them to another phone.

## Sync between phones

Both phones sign in with the **same email and password**; then a plan added on one phone
appears on the other within a second or two (or as soon as it is back online).
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
6. Upload the changed files. In the app: **More → Sign in to sync → Create account** on the
   first phone, then **Sign in** with the same email and password on the second phone.

Notes:
- The values in `firebase-config.js` are not secret; the rules keep each account's plans private.
- The first time a phone signs in to an account that already has plans, it asks whether to
  add that phone's own trips too. Appearance settings stay separate on each phone.
- Signing out keeps a copy of the plans on the phone, but it stops syncing.

## Suggestions for any city or country

When you add a trip, type the place and pick it from the list (or just type it and save: the
best match is used). The app then fetches that place's
[Wikivoyage](https://en.wikivoyage.org) guide once and saves it on the phone:

- **A city** → sights, food, drinks and shopping, grouped by neighborhood, shown under each
  day and in **Ideas → Explore**.
- **A country or region** → its main cities and destinations.
- No Wikivoyage page → the best-known places nearby from Wikipedia.

Boston and New York keep their hand-picked built-in guides.

## Weather, essentials and opening hours

All free services, no account or key needed:

- **Weather** (Open-Meteo) shows up to about 16 days ahead. Days already fetched stay visible offline.
  Temperatures follow **More → Appearance → Units** (°C or °F).
- **Essentials** (the button on the trip's card) are fetched once while online and kept on the phone.
- **Opening hours** come from OpenStreetMap, or the travel guide. They're hints: always check before
  going. Turn off **More → Find addresses and opening hours** to stop these lookups.

## AI Assistant

Tap **AI Assistant** on the trip's card and ask in your own words, e.g. "Plan Saturday around Belém,
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
  **More → Calendar file for …** saves a file to import (Google Calendar on a computer: Settings → Import & export).
- **What's near me** asks the phone for its location once; nothing is sent anywhere (the guide is already on the phone).
- **Booking emails**: in the AI Assistant, tap **Add from a booking email**, paste the confirmation and send. As with
  everything the AI Assistant does, you see the plans first and tap **Apply**.

## On a computer

Open the same address in a browser on your computer. On a wide window the app switches to a desktop layout by
itself: a sidebar on the left (New plan, the sections, the AI Assistant and your trip's days), your plan in the
middle, and the trip's map always in view on the right. Click a day in the sidebar, or a day's **Map** button, to see
that day's route; click a pin to find its plan in the list. Make the window narrow and it's the phone layout again.
In Chrome or Edge, the install icon in the address bar makes it a desktop app.

Your trips are per device: **sign in (More → Sign in to sync)** with the same account as on your phone to see the
same trips. Tickets & bookings and appearance settings stay on the device where you set them.
