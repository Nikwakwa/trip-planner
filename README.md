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
| `manifest.webmanifest` | Tells the phone the app's name, icon and colors so it can be installed. |
| `sw.js` | The "service worker": keeps a copy of the app so it opens offline. |
| `icons/` | App icons for the home screen. |
| `serve.ps1` | A tiny local web server for testing on this computer. |
