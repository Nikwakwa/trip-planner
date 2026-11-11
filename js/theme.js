/* Picks light or dark before the page is drawn, so it never flashes the wrong color.
   It reads the choice saved by the app (Settings → Appearance). It is a file of its own, not
   written inside index.html: the page only runs scripts that come from the app's files. */
(function () {
  // Inside a frame on another site, the app could be covered with something else to trick taps out of
  // someone ("clickjacking"): there it shows nothing. (The host can't send the header that forbids framing.)
  var framed = false;
  try { framed = window.top !== window.self && window.top.location.origin !== window.location.origin; } catch (e) { framed = true; }
  if (framed) document.documentElement.style.display = 'none';
  var pick;
  try {
    var saved = JSON.parse(localStorage.getItem('tripPlanner.v1'));
    pick = saved && saved.settings && saved.settings.theme;
  } catch (e) { /* nothing saved yet */ }
  document.documentElement.dataset.theme = (pick === 'light' || pick === 'dark') ? pick
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
})();
