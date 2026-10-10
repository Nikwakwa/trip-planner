'use strict';

/* =========================================================
   Weather for each trip day (Open-Meteo: free, no account needed).
   The forecast reaches about 16 days ahead. It is saved on the phone,
   so days already fetched still show while offline.
   Functions here use helpers from app.js, which is loaded after this file.
   ========================================================= */

const WEATHER_KEY = 'tripPlanner.weather';
const WEATHER_MAX_AGE = 3 * 3600e3;     // fetch a fresh forecast every 3 hours
const FORECAST_DAYS = 16;

// Open-Meteo's weather codes (WMO), grouped.
function weatherLook(code) {
  if (code === 0) return { icon: 'sunny', text: 'Clear' };
  if (code <= 2) return { icon: 'partly_cloudy_day', text: 'Partly cloudy' };
  if (code === 3) return { icon: 'cloud', text: 'Cloudy' };
  if (code === 45 || code === 48) return { icon: 'foggy', text: 'Fog' };
  if (code >= 51 && code <= 57) return { icon: 'rainy', text: 'Drizzle', wet: true };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: 'rainy', text: code >= 80 ? 'Showers' : 'Rain', wet: true };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: 'weather_snowy', text: 'Snow', wet: true };
  if (code >= 95) return { icon: 'thunderstorm', text: 'Storms', wet: true };
  return { icon: 'cloud', text: 'Cloudy' };
}

const weather = {
  saved: (() => { try { return JSON.parse(localStorage.getItem(WEATHER_KEY)) || {}; } catch { return {}; } })(),
  loading: new Set(),
  retryAt: new Map(),   // place → time a failed fetch may be tried again
};

// Where to ask about for a day: the trip's city. A country or a region is too big for one forecast,
// and a city's day trip can be far away: then it is where that day is spent, taken from the day's
// plans and its stay (the one with the others closest around it; the stay when it's a tie).
// Days spent near one stay share its spot, so they share one forecast.
const WEATHER_NEAR = 25;   // miles
function weatherSpot(trip, day, guide = guideFor(trip)) {
  const city = trip.place && trip.place.kind === 'city' ? trip.place : null;
  const base = baseFor(trip, day, guide);
  const spots = trip.items.filter(i => i.date === day).map(i => coordsOf(i, guide)).filter(Boolean);
  if (base) spots.unshift(base.c);
  if (!spots.length) return city;
  const spread = p => spots.reduce((sum, q) => sum + miles(p, q), 0);
  const mid = spots.reduce((best, p) => (spread(p) < spread(best) ? p : best));
  const stays = trip.items.filter(i => i.category === 'stay').map(i => coordsOf(i, guide)).filter(Boolean);
  return [city, ...stays].find(a => a && miles(a, mid) < WEATHER_NEAR)
    || { lat: Math.round(mid.lat * 10) / 10, lng: Math.round(mid.lng * 10) / 10 };
}
const spotKey = s => `${s.lat.toFixed(2)},${s.lng.toFixed(2)}`;

// The forecast for one day of a trip, or null. Starts a fresh fetch when needed.
function dayWeather(trip, day) {
  const spot = weatherSpot(trip, day);
  if (!spot) return null;
  const entry = weather.saved[spotKey(spot)];
  refreshWeather(day, spot, entry);
  const d = entry && entry.days[day];
  return d ? { ...d, ...weatherLook(d.code) } : null;
}

// Rain, snow or storms likely: suggestions prefer indoor places.
function isWetDay(trip, day) {
  const w = dayWeather(trip, day);
  return !!w && (w.wet || w.rain >= 60);
}

function refreshWeather(day, spot, entry) {
  const key = spotKey(spot);
  if (!navigator.onLine || weather.loading.has(key) || Date.now() < (weather.retryAt.get(key) || 0)) return;
  if (entry && Date.now() - entry.fetched < WEATHER_MAX_AGE) return;
  // Only for a day within the forecast's reach.
  if (day < todayISO() || day > toISO(new Date(Date.now() + (FORECAST_DAYS - 1) * 864e5))) return;

  weather.loading.add(key);
  const params = new URLSearchParams({
    latitude: spot.lat, longitude: spot.lng, timezone: 'auto', forecast_days: FORECAST_DAYS,
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  });
  fetch('https://api.open-meteo.com/v1/forecast?' + params)
    .then(res => (res.ok ? res.json() : Promise.reject(new Error('weather ' + res.status))))
    .then((data) => {
      const d = data.daily;
      // Keep earlier days (the forecast they had), drop ones over a month old.
      const days = { ...(entry ? entry.days : {}) };
      const oldest = toISO(new Date(Date.now() - 30 * 864e5));
      for (const k of Object.keys(days)) if (k < oldest) delete days[k];
      d.time.forEach((day, i) => {
        if (d.weather_code[i] === null) return;
        days[day] = {
          code: d.weather_code[i],
          hi: Math.round(d.temperature_2m_max[i]),
          lo: Math.round(d.temperature_2m_min[i]),
          rain: d.precipitation_probability_max[i] ?? 0,
        };
      });
      weather.saved[key] = { fetched: Date.now(), days };
      // Only the 24 most recently used places are kept (a trip on the road has one a day, 16 days ahead).
      const keys = Object.keys(weather.saved).sort((a, b) => weather.saved[b].fetched - weather.saved[a].fetched);
      for (const old of keys.slice(24)) delete weather.saved[old];
      try { localStorage.setItem(WEATHER_KEY, JSON.stringify(weather.saved)); } catch { /* storage full: keep in memory */ }
      renderSoon();
    })
    .catch((err) => {
      console.warn('No weather', err);
      weather.retryAt.set(key, Date.now() + 5 * 60e3);
    })
    .finally(() => weather.loading.delete(key));
}

// °F or °C, following Settings → Appearance → Units.
const temp = c => `${Math.round(imperial() ? c * 9 / 5 + 32 : c)}°`;

// The little forecast shown in each day's header.
function weatherHTML(trip, day) {
  const w = dayWeather(trip, day);
  if (!w) return '';
  const rain = w.rain >= 30 ? `<span class="wx-rain">${icon('water_drop')}${w.rain}%</span>` : '';
  const label = `${w.text}, high ${temp(w.hi)}, low ${temp(w.lo)}${w.rain >= 30 ? `, ${w.rain}% chance of rain` : ''}`;
  return `
    <span class="wx ${w.wet ? 'wet' : ''}" role="img" aria-label="${esc(label)}" title="${esc(label)}">
      ${icon(w.icon)}<span class="wx-t"><b>${temp(w.hi)}</b><small>${temp(w.lo)}</small></span>${rain}
    </span>`;
}
