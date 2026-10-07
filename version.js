/* The app's versions, newest first: what "What's new" in Settings shows.
   The first entry is the current version. The service worker (sw.js) reads it too, to tell
   installed devices there is something new. So every update that ships gets an entry on top:
     first number   the app looks or works differently
     second number  something new was added
     third number   fixes only
   Written for the people who use the app: what changed for them, in plain words. */
const CHANGELOG = [
  { v: '2.5.1', date: '2026-10-07', items: [
    'On a phone, the AI Assistant moved from the trip’s card to its own button above the + button: always in reach, on Plan and on Ideas',
  ] },
  { v: '2.5.0', date: '2026-10-07', title: 'Ready to share', items: [
    '“What’s new”: this list, and the version number in Settings',
    'A privacy note: where your plans are kept and what is sent where',
    '“Report a problem” in Settings',
    'A new account gets an email to confirm its address',
    'Help to install the app on an iPhone or iPad',
  ] },
  { v: '2.4.0', date: '2026-10-06', title: 'Your account', items: [
    'Change your password, or delete your account',
    'The sync status says when everything is saved, and how many changes are still waiting',
    'A clearer sheet to sign in or create an account',
  ] },
  { v: '2.3.0', date: '2026-10-06', title: 'Getting around the app', items: [
    '“More” is now called “Settings”',
    'The device’s Back button returns to the Plan instead of closing the app',
    'Each section reopens where you left it',
  ] },
  { v: '2.2.1', date: '2026-10-05', items: [
    'Fixed: a street address in a big city was pinned at the city’s center',
    'Fixed: when an address exists in two places, the one near your other plans is picked',
  ] },
  { v: '2.2.0', date: '2026-10-04', title: 'Auto-fill and Book ahead', items: [
    'Auto-fill day: fills a day with the most interesting sights near its plans',
    '“Book ahead” on plans known to sell out, and on games, concerts and shows',
    'A color for each day, in the plan and on the map',
    'A fuller guide for very large cities such as New York',
  ] },
  { v: '2.1.0', date: '2026-10-04', items: [
    'The plan form lists real places as you type a name or an address',
    'A button to remove a plan’s time',
    'AI Assistant: no longer makes up times, and answers in paragraphs',
  ] },
  { v: '2.0.0', date: '2026-10-04', title: 'Dotted Line', items: [
    'The app is now called Dotted Line (it was Trip Planner)',
    'A new look for the plan: numbered stops with photos, dotted lines with the travel time between them, the stay at the top of each day',
    '“About this place” on every plan: what it is, photos and opening hours',
    'Trips to a country or region get ideas near their plans',
    'A plan with a time can be dragged among the others',
    'Better at finding an address with a house number',
  ] },
  { v: '1.12.1', date: '2026-10-03', title: 'Safety check and fixes', items: [
    'Backup files and synced plans are checked before they are used, and only the app’s own code can run',
    'Tickets can only be photos and PDFs',
    '“Erase everything” also clears tickets, chats and saved guides',
    'Fixed: plans are found on the map for trips to a country or region, and so are harder addresses',
    'The day map draws the route from the stay and back to it',
  ] },
  { v: '1.12.0', date: '2026-10-03', items: [
    'Dates and times are always written in English',
    'Settings for the date order (31 Oct or Oct 31) and a 24-hour or 12-hour clock',
  ] },
  { v: '1.11.0', date: '2026-10-03', title: 'Design pass', items: [
    'A smaller trip card, so today’s plans are on the first screen',
    'A strip of days to jump from one to another',
    'Ideas have “Add to a day”',
    'The plan form’s examples follow the trip’s destination',
    'A new logo',
  ] },
  { v: '1.10.0', date: '2026-10-03', title: 'A detailed map', items: [
    'A detailed map with the names of streets, stations and landmarks',
    'A night version of the map in dark mode',
  ] },
  { v: '1.9.0', date: '2026-10-03', title: 'On a computer', items: [
    'On a wide window: a sidebar with the trip’s days, and the map beside the plan',
    'Plans can be dragged with a mouse',
  ] },
  { v: '1.8.0', date: '2026-10-02', title: 'During the trip', items: [
    'Now & next: what is on, and when to leave for the next plan',
    'Home base: days start and end at your stay',
    'What’s near me',
    'Photos of places, packing suggestions, add to calendar, and tickets attached to plans',
    'AI Assistant: turns a booking email into plans, and takes voice input',
    'Fixed: a full address is looked up as it is written',
  ] },
  { v: '1.7.0', date: '2026-10-02', items: [
    'Metric or imperial units',
    'A trip gets around by public transit or by car, and a day can differ',
  ] },
  { v: '1.6.0', date: '2026-10-02', title: 'AI Assistant', items: [
    'A chat that answers questions and proposes changes to the trip; nothing changes until you tap Apply, and Apply can be undone',
    'Or copy the request to another AI app and paste its answer back',
  ] },
  { v: '1.5.0', date: '2026-10-01', items: [
    'Tap a suggestion to read its full description',
    'Fixed: cities named like their country (Luxembourg, Singapore) are found',
  ] },
  { v: '1.4.0', date: '2026-09-30', title: 'Weather, essentials and opening hours', items: [
    'The app starts empty and asks where you want to go',
    'The weather forecast on each day',
    'Essentials: emergency number, plugs, currency, local time and tips',
    'Hold a plan or an idea and drag it onto a day',
    'Opening hours on plans, and a warning when a place is usually closed that day',
  ] },
  { v: '1.3.0', date: '2026-09-28', title: 'Sync, and any destination', items: [
    'Sign in to share your trips between devices',
    'Search for any city or country',
    'A travel guide and suggestions for any destination',
  ] },
  { v: '1.2.0', date: '2026-09-27', title: 'Maps', items: [
    'A map of each day and of the whole trip',
    'Optimize route: the shortest order for a day’s stops',
    'Addresses are found on the map',
    'Share a trip’s plan as text',
  ] },
  { v: '1.1.0', date: '2026-09-27', items: [
    'Light or dark appearance',
    'Suggestions under each day, and a guide to explore',
    'Travel time between plans',
    'Updates reach an installed app quickly',
  ] },
  { v: '1.0.0', date: '2026-09-27', title: 'First version', items: [
    'Trips with a plan for each day, ideas and a checklist',
    'Saved on the device; installs on the home screen and works offline',
    'A backup file to save and restore',
    'Colors that follow each trip, in light and dark',
  ] },
];
const APP_VERSION = CHANGELOG[0].v;
