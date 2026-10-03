'use strict';

/* =========================================================
   The look of the map: OpenFreeMap's "liberty" style (free, no key; vector
   map data from OpenStreetMap), adjusted here to feel closer to Google Maps:
   - landmarks, shops, restaurants and stations are named earlier when zooming in;
   - a dark version made from the same style (same details, night colors),
     used when the app is in dark mode.
   ========================================================= */

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

// Any CSS color → [r, g, b, a], using the browser's own parser.
const colorProbe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function parseColor(str) {
  colorProbe.clearRect(0, 0, 1, 1);
  colorProbe.fillStyle = '#000';
  colorProbe.fillStyle = str;
  colorProbe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = colorProbe.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const looksLikeColor = v => typeof v === 'string' && /^(#[0-9a-f]{3,8}$|rgba?\(|hsla?\()/i.test(v.trim());

// Night colors: light surfaces become dark and dark text becomes light, keeping each color's hue.
// kind: what the color is used for, so roads stay visible and labels stay readable.
function nightColor(str, kind) {
  const [r, g, b, a] = parseColor(str);
  let [h, s, l] = rgbToHsl(r, g, b);
  if (kind === 'text') { l = 0.62 + (1 - l) * 0.3; s *= 0.5; }            // labels: light
  else if (kind === 'halo') { l = 0.1; s *= 0.3; }                        // their outline: dark
  else if (kind === 'road') { l = 0.3 + (1 - l) * 0.25; s *= 0.55; }      // roads: lighter than the ground
  else if (kind === 'casing') { l = 0.13; s *= 0.3; }
  else if (kind === 'water') { l = 0.2; s = Math.min(s, 0.45); h = 215; }
  else {                                                                  // ground, parks, buildings: muted
    l = 0.13 + (1 - l) * 0.5;
    s = Math.min(s * 0.55, 0.24);
    if (h > 15 && h < 65) s *= 0.25;                                      // beige ground → neutral grey, not brown
  }
  return `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${Math.round(a * 100) / 100})`;
}

// Walks a paint value (plain color, zoom stops, or an expression) and recolors every color in it.
function recolor(value, kind) {
  if (looksLikeColor(value)) return nightColor(value, kind);
  if (Array.isArray(value)) return value.map(v => recolor(v, kind));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, recolor(v, kind)]));
  return value;
}

// The style, adjusted. theme: 'light' or 'dark'.
function tuneMapStyle(style, theme) {
  const out = JSON.parse(JSON.stringify(style));
  for (const layer of out.layers) {
    // Landmarks and places appear about one zoom level earlier.
    if (layer.id === 'poi_r1') layer.minzoom = 13.5;
    if (layer.id === 'poi_r7') layer.minzoom = 15;
    if (layer.id === 'poi_r20') layer.minzoom = 16;
    // Bus stops only once zoomed in to street level: at city level they crowd out everything else.
    if (layer.id === 'poi_transit') layer.filter = ['all', layer.filter, ['any', ['!=', ['get', 'class'], 'bus'], ['>=', ['zoom'], 15]]];
    if (theme !== 'dark') continue;

    if (layer.type === 'raster') { layer.layout = { ...layer.layout, visibility: 'none' }; continue; }   // shaded relief: daytime only
    const id = layer.id;
    const isRoad = layer.type === 'line' && /road|highway|bridge|tunnel|street|path|rail|aeroway/.test(id);
    const kind = /water|ocean|river|lake/.test(id) && layer.type !== 'symbol' ? 'water'
      : isRoad ? (/casing|outline/.test(id) ? 'casing' : 'road') : 'fill';
    const paint = layer.paint || {};
    for (const key of Object.keys(paint)) {
      if (key === 'text-color' || key === 'icon-color') paint[key] = recolor(paint[key], 'text');
      else if (key === 'text-halo-color' || key === 'icon-halo-color') paint[key] = recolor(paint[key], 'halo');
      else if (/color$/.test(key)) paint[key] = recolor(paint[key], kind);
    }
    // Hatched areas (pedestrian squares, wetlands) use light drawings: a plain dark fill instead.
    if (paint['fill-pattern']) {
      delete paint['fill-pattern'];
      paint['fill-color'] = /wetland/.test(id) ? 'hsl(190, 20%, 16%)' : 'hsl(30, 4%, 19%)';
    }
    // Labels without a set color are black by default: make them light, with a dark outline.
    if (layer.type === 'symbol') {
      if (!('text-color' in paint)) paint['text-color'] = 'hsl(0, 0%, 85%)';
      if (!('text-halo-color' in paint)) { paint['text-halo-color'] = 'hsl(0, 0%, 10%)'; paint['text-halo-width'] = paint['text-halo-width'] || 1; }
    }
    if (layer.type === 'fill-extrusion') paint['fill-extrusion-opacity'] = 0.6;
    layer.paint = paint;
  }
  return out;
}

// Fetched once, then kept (the service worker also keeps a copy for offline use).
let mapStyleLoading = null;
function loadMapStyle() {
  mapStyleLoading = mapStyleLoading || fetch(MAP_STYLE_URL)
    .then(res => (res.ok ? res.json() : Promise.reject(new Error('map style ' + res.status))))
    .catch((e) => { mapStyleLoading = null; throw e; });
  return mapStyleLoading;
}
