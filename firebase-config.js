/* Sync between phones: paste your Firebase project's web app settings here.
   See "Sync between phones" in README.md for the 5-minute setup.
   These values are not secret — they identify the project, and the database
   rules (firestore.rules) make sure each account only sees its own plans.
   Leave it as null to use the app without sync. */
window.FIREBASE_CONFIG = {

  apiKey: "AIzaSyDH-NsZev3GT4SG7P6LuTY7tfg0LwF2DCM",

  authDomain: "first-app-trip-planner.firebaseapp.com",

  projectId: "first-app-trip-planner",

  storageBucket: "first-app-trip-planner.firebasestorage.app",

  messagingSenderId: "704808563206",

  appId: "1:704808563206:web:98c35099d8a9c697418987",

  measurementId: "G-NE54WHEQ4K"

};

/* AI assistant: the reCAPTCHA Enterprise "site key" that App Check uses to prove requests come
   from this app (see "AI assistant" in README.md). Not secret either. Leave null until it's set up. */
window.RECAPTCHA_SITE_KEY = '6Le14NotAAAAAGl2udC2aSPkAw8-VDJa03WxH0K8';

/* Nicer maps: a CARTO basemaps key (free for personal use, see "Map style" in README.md).
   Not secret either: it travels in every map image address. Leave null to keep the standard map. */
window.CARTO_KEY = 'cb1_48dz_1_9c0fedddd14c506fe4c10c54';

/* Example (yours will have different values):
window.FIREBASE_CONFIG = {
  apiKey: 'AIza…',
  authDomain: 'my-trip-planner.firebaseapp.com',
  projectId: 'my-trip-planner',
  storageBucket: 'my-trip-planner.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abc123',
};
*/
