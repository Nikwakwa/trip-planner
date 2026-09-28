# Trip Planner

A small, installable web app (PWA) for planning a trip on your phone.

- Plain HTML, CSS and JavaScript — no frameworks, no server of your own.
- Everything you type is saved on the phone itself (browser storage).
- Optional: sign in to share trips between phones (e.g. yours and your partner's).
- Type a city or country for a new trip: the app finds the real place and suggests
  things to do there (from the Wikivoyage travel guide).
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
