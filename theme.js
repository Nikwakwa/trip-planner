/* Picks light or dark before the page is drawn, so it never flashes the wrong color.
   It reads the choice saved by the app (More → Appearance). It is a file of its own, not
   written inside index.html: the page only runs scripts that come from the app's files. */
(function () {
  var pick;
  try {
    var saved = JSON.parse(localStorage.getItem('tripPlanner.v1'));
    pick = saved && saved.settings && saved.settings.theme;
  } catch (e) { /* nothing saved yet */ }
  document.documentElement.dataset.theme = (pick === 'light' || pick === 'dark') ? pick
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
})();
