'use strict';

/* =========================================================
   Add to calendar.
   - One plan: opens Google Calendar with the event filled in (the phone's
     Calendar app on Android), in the destination's time zone.
   - The whole trip: a calendar file (.ics) with every plan that has a day,
     for Google Calendar's "Import" or any calendar app.
   A plan with a time lasts as long as a visit usually takes; one without a time is all-day.
   Functions here use helpers from app.js, which is loaded after this file.
   ========================================================= */

// The destination's time zone (saved with the trip's Essentials), or the phone's own.
function tripTimeZone(trip) {
  const e = trip.place && essentials.saved[placeKey(trip.place)];
  return (e && e.tz) || Intl.DateTimeFormat().resolvedOptions().timeZone || '';
}

const pad2 = n => String(n).padStart(2, '0');
const calDate = d => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
const calDateTime = d => `${calDate(d)}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;

// Start and end, as local times at the destination (or whole days).
function eventTimes(item, guide) {
  const start = parseDate(item.date);
  if (!item.time) {
    const end = parseDate(item.date);
    end.setDate(end.getDate() + 1);
    return { allDay: true, start, end };
  }
  const [h, m] = item.time.split(':').map(Number);
  start.setHours(h, m);
  const end = new Date(start.getTime() + planLength(item, guide) * 60e3);
  return { allDay: false, start, end };
}

function eventDetails(item, trip) {
  return [item.notes, safeUrl(item.link), `${trip.name} — Trip Planner`].filter(Boolean).join('\n\n');
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
  const tz = tripTimeZone(trip);
  if (tz && !t.allDay) params.set('ctz', tz);
  return 'https://calendar.google.com/calendar/render?' + params;
}

// Text in a calendar file: commas, semicolons and new lines are escaped, long lines folded.
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsLine(line) {
  const out = [];
  while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
  out.push(line);
  return out.join('\r\n');
}

function downloadTripCalendar(trip) {
  const guide = guideFor(trip);
  const tz = tripTimeZone(trip);
  const plans = trip.items.filter(i => i.date);
  if (!plans.length) { snackbar('No plans with a day yet'); return; }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Trip Planner//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(trip.name)}`];
  for (const item of plans) {
    const t = eventTimes(item, guide);
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
  snackbar(`Calendar file saved — ${plural(plans.length, 'plan')}`);
}
