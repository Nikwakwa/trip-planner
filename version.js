/* The app's versions, newest first: what "What's new" in Settings shows.
   The first entry is the current version. The service worker (sw.js) reads it too, to tell
   installed devices there is something new. So every update that ships gets an entry on top:
     first number   the app looks or works differently
     second number  something new was added
     third number   fixes only
   Written for the people who use the app, and kept short: what is new for them, one short line
   each, five at most. Fixes are not listed one by one: a single line, "Bug fixes". */
const CHANGELOG = [
  { v: '2.11.0', date: '2026-10-10', items: [
    'A trip you plan together has a list of its own in the Checklist, for everyone on the trip',
    'Your own checklist stays yours, right below it',
    'Tickets and other files stay on your device: the app now says they can’t be shared',
  ] },
  { v: '2.10.0', date: '2026-10-10', items: [
    'Plan a trip together: a trip’s Share button invites people with a link',
    'Everyone on the trip changes it from their own account, and sees who else is on it',
    'Join a trip from an invitation link, or under Settings → Trips',
  ] },
  { v: '2.9.1', date: '2026-10-10', items: [
    'A shorter “What’s new”: the latest versions first, earlier ones a tap away',
  ] },
  { v: '2.9.0', date: '2026-10-09', items: [
    'Save stays in view at the bottom of the plan and trip forms',
    'On a phone, the + and AI buttons step aside while you scroll down',
    'A tidier look for plan cards, suggestions, Explore and Settings',
    'Bug fixes',
  ] },
  { v: '2.8.2', date: '2026-10-09', items: [
    'Bug fixes',
  ] },
  { v: '2.8.1', date: '2026-10-09', items: [
    'On the day you check in, your stay keeps its hotel icon, on its card and on the map',
  ] },
  { v: '2.8.0', date: '2026-10-09', items: [
    'Moving to another stay: the day starts with “Check out” and ends with “Check in”',
    'A stay can have a check-out day, and shows its number of nights',
  ] },
  { v: '2.7.2', date: '2026-10-09', items: [
    'Bug fixes',
  ] },
  { v: '2.7.1', date: '2026-10-08', items: [
    'On a phone, swipe a sheet down to close it',
    'Bug fixes',
  ] },
  { v: '2.7.0', date: '2026-10-07', items: [
    '“Report a problem” is now a form, with your email if you’d like an answer',
  ] },
  { v: '2.6.0', date: '2026-10-07', items: [
    'Vote for the features you’d like next, or suggest your own: “What should come next?” in Settings',
  ] },
  { v: '2.5.2', date: '2026-10-07', items: [
    'Bug fixes',
  ] },
  { v: '2.5.1', date: '2026-10-07', items: [
    'On a phone, the AI Assistant has its own button, above the + button',
  ] },
  { v: '2.5.0', date: '2026-10-07', items: [
    '“What’s new”, with the version number in Settings',
    'A privacy note, and “Report a problem”',
    'Help to install the app on an iPhone or iPad',
  ] },
  { v: '2.4.0', date: '2026-10-06', items: [
    'Change your password, or delete your account',
    'The sync status says when everything is saved',
  ] },
  { v: '2.3.0', date: '2026-10-06', items: [
    '“More” is now called “Settings”',
    'The Back button returns to the Plan, and each section reopens where you left it',
  ] },
  { v: '2.2.1', date: '2026-10-05', items: [
    'Bug fixes',
  ] },
  { v: '2.2.0', date: '2026-10-04', items: [
    'Auto-fill day: fills a day with the most interesting sights nearby',
    '“Book ahead” on plans known to sell out',
    'A color for each day, in the plan and on the map',
  ] },
  { v: '2.1.0', date: '2026-10-04', items: [
    'The plan form suggests real places as you type',
    'A button to remove a plan’s time',
  ] },
  { v: '2.0.0', date: '2026-10-04', items: [
    'The app is now called Dotted Line',
    'A new look: numbered stops with photos, and the travel time between them',
    '“About this place” on every plan',
    'Ideas near your plans, for trips to a country or region',
  ] },
  { v: '1.12.1', date: '2026-10-03', items: [
    'Bug fixes',
  ] },
  { v: '1.12.0', date: '2026-10-03', items: [
    'Choose the date order (31 Oct or Oct 31) and a 24-hour or 12-hour clock',
  ] },
  { v: '1.11.0', date: '2026-10-03', items: [
    'A smaller trip card, and a strip of days to jump from one to another',
    '“Add to a day” on ideas',
    'A new logo',
  ] },
  { v: '1.10.0', date: '2026-10-03', items: [
    'A detailed map with the names of streets and landmarks, and a night version',
  ] },
  { v: '1.9.0', date: '2026-10-03', items: [
    'On a computer: a sidebar with the trip’s days, and the map beside the plan',
  ] },
  { v: '1.8.0', date: '2026-10-02', items: [
    'Now & next: what is on, and when to leave for the next plan',
    'Days start and end at your stay',
    'What’s near me, photos of places and packing suggestions',
    'Tickets attached to plans, and add to calendar',
    'AI Assistant: turns a booking email into plans, and takes voice input',
  ] },
  { v: '1.7.0', date: '2026-10-02', items: [
    'Metric or imperial units',
    'Get around by public transit or by car',
  ] },
  { v: '1.6.0', date: '2026-10-02', items: [
    'AI Assistant: ask questions and get changes proposed for your trip; nothing changes until you tap Apply',
  ] },
  { v: '1.5.0', date: '2026-10-01', items: [
    'Tap a suggestion to read its full description',
  ] },
  { v: '1.4.0', date: '2026-09-30', items: [
    'The weather forecast on each day',
    'Essentials: emergency number, plugs, currency, local time and tips',
    'Opening hours on plans',
    'Hold a plan or an idea and drag it onto a day',
  ] },
  { v: '1.3.0', date: '2026-09-28', items: [
    'Sign in to share your trips between devices',
    'Any city or country, with a travel guide and suggestions',
  ] },
  { v: '1.2.0', date: '2026-09-27', items: [
    'A map of each day and of the whole trip',
    'Optimize route: the shortest order for a day’s stops',
    'Share a trip’s plan as text',
  ] },
  { v: '1.1.0', date: '2026-09-27', items: [
    'Light or dark appearance',
    'Suggestions under each day, and a guide to explore',
    'Travel time between plans',
  ] },
  { v: '1.0.0', date: '2026-09-27', items: [
    'Trips with a plan for each day, ideas and a checklist',
    'Works offline, and installs on the home screen',
    'A backup file to save and restore',
  ] },
];
const APP_VERSION = CHANGELOG[0].v;
