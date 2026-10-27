'use strict';

/* =========================================================
   Add to calendar.
   - One plan: opens Google Calendar with the event filled in (the phone's
     Calendar app on Android), in the destination's time zone.
   - The whole trip: a calendar file (.ics) with every plan that has a day,
     for Google Calendar's "Import" or any calendar app.
   A plan with a time lasts as long as a visit usually takes; one without a time is all-day.
   Functions here also use the screen's files (ui.js … app.js), which load after this one.
   ========================================================= */

// The time zone where a day of the trip is spent. It comes with the forecast for that day's spot
// (weather.js): a country can have several, and its middle isn't where the plans are. Failing that,
// the trip's place (saved with its Essentials). '' when not known: the calendar then uses its own.
function findTimeZone(trip, day) {
  const zoneOn = (d) => {
    const spot = d && weatherSpot(trip, d);
    const w = spot && weather.saved[spotKey(spot)];
    return (w && w.tz) || '';
  };
  let tz = zoneOn(day);
  // A day whose spot isn't known (yet), away from a single city: the zone of the nearest day that has one.
  if (!tz && day && !(trip.place && trip.place.kind === 'city')) {
    const days = tripDays(trip).sort((a, b) => Math.abs(daysBetween(day, a)) - Math.abs(daysBetween(day, b)));
    for (const d of days) if ((tz = zoneOn(d))) break;
  }
  const e = trip.place && essentials.saved[placeKey(trip.place)];
  return tz || (e && e.tz) || '';
}
// Asked for every plan of a day while the screen is drawn: worked out once per day, until the next redraw.
const zoneMemo = new Map();
function tripTimeZone(trip, day) {
  const key = `${trip.id}|${day}`;
  if (!zoneMemo.size) setTimeout(() => zoneMemo.clear(), 0);
  if (!zoneMemo.has(key)) zoneMemo.set(key, findTimeZone(trip, day));
  return zoneMemo.get(key);
}

const pad2 = n => String(n).padStart(2, '0');
const calDate = d => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
const calDateTime = d => `${calDate(d)}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;

// Start and end, as local times at the destination (or whole days).
function eventTimes(item, guide) {
  const start = parseDate(item.date);
  if (!item.time) {
    // A stay with a check-out day (today.js) covers every day up to and including it.
    const end = parseDate(stayUntil(item) || item.date);
    end.setDate(end.getDate() + 1);
    return { allDay: true, start, end };
  }
  const [h, m] = item.time.split(':').map(Number);
  start.setHours(h, m);
  const end = new Date(start.getTime() + planLength(item, guide) * 60e3);
  return { allDay: false, start, end };
}

function eventDetails(item, trip) {
  return [item.notes, safeUrl(item.link), `${trip.name} — Dotted Line`].filter(Boolean).join('\n\n');
}

function calendarUrl(item, trip) {
  const t = eventTimes(item, guideFor(trip));
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: item.title,
    dates: t.allDay ? `${calDate(t.start)}/${calDate(t.end)}` : `${calDateTime(t.start)}/${calDateTime(t.end)}`,
    details: eventDetails(item, trip),
    location: item.place ? `${item.place}, ${placeLabel(trip)}` : placeLabel(trip),
  });
  const tz = t.allDay ? '' : tripTimeZone(trip, item.date);
  if (tz) params.set('ctz', tz);
  return 'https://calendar.google.com/calendar/render?' + params;
}

// Text in a calendar file: commas, semicolons and new lines are escaped, long lines folded.
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsLine(line) {
  const out = [];
  while (line.length > 74) {
    // Not in the middle of an emoji (which takes two places).
    const cut = /[\uD800-\uDBFF]/.test(line[73]) ? 73 : 74;
    out.push(line.slice(0, cut));
    line = ' ' + line.slice(cut);
  }
  out.push(line);
  return out.join('\r\n');
}

function downloadTripCalendar(trip) {
  const guide = guideFor(trip);
  const plans = trip.items.filter(i => i.date);
  if (!plans.length) { snackbar(T('No plans with a day yet')); return; }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dotted Line//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(trip.name)}`];
  for (const item of plans) {
    const t = eventTimes(item, guide);
    const tz = t.allDay ? '' : tripTimeZone(trip, item.date);
    lines.push('BEGIN:VEVENT', `UID:${item.id}@trip-planner`, `DTSTAMP:${stamp}`,
      t.allDay ? `DTSTART;VALUE=DATE:${calDate(t.start)}` : `DTSTART${tz ? `;TZID=${tz}` : ''}:${calDateTime(t.start)}`,
      t.allDay ? `DTEND;VALUE=DATE:${calDate(t.end)}` : `DTEND${tz ? `;TZID=${tz}` : ''}:${calDateTime(t.end)}`,
      `SUMMARY:${icsText(item.title)}`,
      `LOCATION:${icsText(item.place ? `${item.place}, ${placeLabel(trip)}` : placeLabel(trip))}`,
      `DESCRIPTION:${icsText(eventDetails(item, trip))}`,
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.map(icsLine).join('\r\n') + '\r\n'], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${trip.name.replace(/[^\w\- ]+/g, '').trim() || 'trip'}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  snackbar(Tn(plans.length, 'Calendar file saved — {n} plan', 'Calendar file saved — {n} plans'));
}

onAction('trip-calendar', () => downloadTripCalendar(activeTrip()));
