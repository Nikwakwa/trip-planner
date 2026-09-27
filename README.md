# Trip Planner (Boston + NYC)

A small, installable web app (PWA) for planning a trip on your phone.

- Plain HTML, CSS and JavaScript — no frameworks, no server.
- Everything you type is saved on the phone itself (browser storage).
- Works offline once it has been opened one time.

## Files

| File | What it does |
|------|--------------|
| `index.html` | The page structure (what's on screen). |
| `styles.css` | The look: colors, spacing, fonts. |
| `app.js` | The behavior: adding plans, saving, switching trips. |
| `guides.js` | Built-in Boston and NYC guides used for suggestions and Explore. |
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

Plans are stored only in the app on your phone. Use **More → Save backup file** before the trip,
and **Restore from backup file** to bring plans back or move them to another phone.
