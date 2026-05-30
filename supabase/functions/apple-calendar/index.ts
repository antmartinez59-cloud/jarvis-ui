// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — apple-calendar Edge Function                   ║
// ║  Read + create Apple Calendar events via iCloud CalDAV   ║
// ║                                                          ║
// ║  GET  ?start=YYYY-MM-DD&end=YYYY-MM-DD                  ║
// ║    → { events: [{id,title,start,end,location,notes,...}] }║
// ║  POST { title, start, end, notes?, location?, allDay? }  ║
// ║    → { ok: true, uid }                                   ║
// ║                                                          ║
// ║  Secrets: APPLE_CALDAV_USER, APPLE_CALDAV_PASSWORD       ║
// ╚══════════════════════════════════════════════════════════╝

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const _db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const APPLE_USER = Deno.env.get('APPLE_CALDAV_USER') || '';
const APPLE_PASS = Deno.env.get('APPLE_CALDAV_PASSWORD') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const authHeader = () => ({
  'Authorization': 'Basic ' + btoa(`${APPLE_USER}:${APPLE_PASS}`),
  'Content-Type': 'application/xml; charset=utf-8',
});

// ── Discover iCloud calendar home URL ────────────────────────────────────────
async function getCalendarHome(): Promise<string> {
  // Step 1: well-known redirect
  const wk = await fetch('https://caldav.icloud.com/.well-known/caldav', {
    method: 'PROPFIND',
    headers: { ...authHeader(), Depth: '0' },
    body: `<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
    redirect: 'follow',
  });
  const wkText = await wk.text();

  // Extract principal path
  const principalMatch = wkText.match(/<d:href[^>]*>([^<]+current-user[^<]*)<\/d:href>/i)
    || wkText.match(/<current-user-principal[^>]*>\s*<href[^>]*>([^<]+)<\/href>/i);

  let principalUrl: string;
  if (principalMatch) {
    const path = principalMatch[1].trim();
    principalUrl = path.startsWith('http') ? path : `https://caldav.icloud.com${path}`;
  } else {
    // Fallback: derive from username
    const parts = APPLE_USER.split('@')[0];
    principalUrl = `https://caldav.icloud.com/${parts}/principal/`;
  }

  // Step 2: get calendar-home-set
  const ph = await fetch(principalUrl, {
    method: 'PROPFIND',
    headers: { ...authHeader(), Depth: '0' },
    body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:prop><c:calendar-home-set/></d:prop>
    </d:propfind>`,
  });
  const phText = await ph.text();
  const homeMatch = phText.match(/<[^:]*:href>([^<]+)<\/[^:]*:href>/i);
  if (!homeMatch) throw new Error('Could not find calendar-home-set');

  const homePath = homeMatch[1].trim();
  return homePath.startsWith('http') ? homePath : `https://caldav.icloud.com${homePath}`;
}

// ── List all calendar collections ────────────────────────────────────────────
async function listCalendars(homeUrl: string): Promise<string[]> {
  const resp = await fetch(homeUrl, {
    method: 'PROPFIND',
    headers: { ...authHeader(), Depth: '1' },
    body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:prop>
        <d:resourcetype/>
        <d:displayname/>
      </d:prop>
    </d:propfind>`,
  });
  const text = await resp.text();
  const urls: string[] = [];
  // Find all responses that are calendar collections
  const responses = text.match(/<d:response>[\s\S]*?<\/d:response>/gi) || [];
  for (const r of responses) {
    if (r.includes('calendar') || r.includes('Calendar')) {
      const hrefMatch = r.match(/<d:href>([^<]+)<\/d:href>/i);
      if (hrefMatch) {
        const path = hrefMatch[1].trim();
        const url = path.startsWith('http') ? path : `https://caldav.icloud.com${path}`;
        if (url !== homeUrl && url !== homeUrl + '/') urls.push(url);
      }
    }
  }
  return urls.length ? urls : [homeUrl];
}

// ── Fetch events from a calendar in a date range ──────────────────────────────
async function fetchEvents(calUrl: string, startDate: string, endDate: string): Promise<any[]> {
  // Format for CalDAV time-range: YYYYMMDDTHHMMSSZ
  const toCalDAV = (d: string, isEnd = false) => {
    const dt = new Date(d + (isEnd ? 'T23:59:59Z' : 'T00:00:00Z'));
    return dt.toISOString().replace(/[-:]/g, '').replace('.000', '');
  };

  const body = `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:prop>
      <d:getetag/>
      <c:calendar-data/>
    </d:prop>
    <c:filter>
      <c:comp-filter name="VCALENDAR">
        <c:comp-filter name="VEVENT">
          <c:time-range start="${toCalDAV(startDate)}" end="${toCalDAV(endDate, true)}"/>
        </c:comp-filter>
      </c:comp-filter>
    </c:filter>
  </c:calendar-query>`;

  const resp = await fetch(calUrl, {
    method: 'REPORT',
    headers: { ...authHeader(), Depth: '1' },
    body,
  });

  if (!resp.ok) return [];
  const text = await resp.text();

  // Extract calendar-data blocks
  const dataBlocks = text.match(/<[^:]*:calendar-data[^>]*>([\s\S]*?)<\/[^:]*:calendar-data>/gi) || [];
  const events: any[] = [];

  for (const block of dataBlocks) {
    const ical = block.replace(/<[^>]+>/g, '').trim();
    const parsed = parseVEvent(ical);
    if (parsed) events.push(parsed);
  }

  return events;
}

// ── Parse a VCALENDAR/VEVENT string into a clean object ──────────────────────
function parseVEvent(ical: string): any | null {
  // Unfold lines (iCal wraps long lines with \r\n + space)
  const unfolded = ical.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const lines = unfolded.split('\n');
  const inEvent: Record<string, string> = {};
  let insideEvent = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === 'BEGIN:VEVENT') { insideEvent = true; continue; }
    if (line === 'END:VEVENT') { insideEvent = false; break; }
    if (!insideEvent) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).split(';')[0].toUpperCase();
    const val = line.slice(colonIdx + 1).trim();
    inEvent[key] = val;
  }

  if (!inEvent['SUMMARY'] && !inEvent['UID']) return null;

  const parseDate = (s: string): string => {
    if (!s) return '';
    // All-day: YYYYMMDD
    if (/^\d{8}$/.test(s)) return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);
    // With time: YYYYMMDDTHHMMSSZ or local
    const clean = s.replace('Z','').replace('T',' ');
    const y=clean.slice(0,4), mo=clean.slice(4,6), d=clean.slice(6,8);
    const h=clean.slice(9,11)||'00', mi=clean.slice(11,13)||'00';
    return `${y}-${mo}-${d}T${h}:${mi}`;
  };

  const startRaw = inEvent['DTSTART'] || '';
  const endRaw   = inEvent['DTEND']   || '';
  const allDay   = /^\d{8}$/.test(startRaw);

  return {
    id:       inEvent['UID'] || crypto.randomUUID(),
    title:    inEvent['SUMMARY']     || 'Untitled Event',
    start:    parseDate(startRaw),
    end:      parseDate(endRaw),
    location: inEvent['LOCATION']    || null,
    notes:    inEvent['DESCRIPTION'] || null,
    allDay,
    uid:      inEvent['UID']         || '',
  };
}

// ── Create a VEVENT and PUT to calendar ──────────────────────────────────────
async function createEvent(calUrl: string, event: any): Promise<string> {
  const uid = crypto.randomUUID() + '@jarvis.local';
  const now = new Date().toISOString().replace(/[-:]/g, '').replace('.000', '');

  const fmtDT = (s: string, allDay: boolean) => {
    if (allDay) return s.replace(/-/g, '');
    return s.replace(/[-:]/g, '').replace('T', 'T').slice(0,15) + 'Z';
  };

  const vevent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//JARVIS//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    event.allDay ? `DTSTART;VALUE=DATE:${fmtDT(event.start, true)}`
                 : `DTSTART:${fmtDT(event.start, false)}`,
    event.allDay ? `DTEND;VALUE=DATE:${fmtDT(event.end || event.start, true)}`
                 : `DTEND:${fmtDT(event.end || event.start, false)}`,
    `SUMMARY:${event.title}`,
    event.location ? `LOCATION:${event.location}` : null,
    event.notes    ? `DESCRIPTION:${event.notes}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  const putUrl = calUrl.endsWith('/') ? calUrl + uid + '.ics' : calUrl + '/' + uid + '.ics';
  const resp = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      ...authHeader(),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*',
    },
    body: vevent,
  });

  if (!resp.ok && resp.status !== 201 && resp.status !== 204) {
    throw new Error(`PUT failed: ${resp.status}`);
  }
  return uid;
}

// ── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (!APPLE_USER || !APPLE_PASS) {
      return new Response(JSON.stringify({
        ok: false, error: 'APPLE_CALDAV_USER or APPLE_CALDAV_PASSWORD not set in Vault'
      }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const url = new URL(req.url);
    const homeUrl = await getCalendarHome();
    const calendars = await listCalendars(homeUrl);

    // ── GET: fetch events ──────────────────────────────────────────────────
    if (req.method === 'GET') {
      const start = url.searchParams.get('start') || new Date().toISOString().slice(0,10);
      const end   = url.searchParams.get('end')   || start;

      const allEvents: any[] = [];
      for (const cal of calendars) {
        try {
          const evts = await fetchEvents(cal, start, end);
          allEvents.push(...evts);
        } catch (_) { /* skip bad calendars */ }
      }

      // Sort by start time
      allEvents.sort((a, b) => (a.start || '').localeCompare(b.start || ''));

      return new Response(JSON.stringify({ ok: true, events: allEvents, count: allEvents.length }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── POST: create event ─────────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = await req.json();
      const { title, start, end, notes, location, allDay = false } = body;

      if (!title || !start) {
        return new Response(JSON.stringify({ ok: false, error: 'title and start are required' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      // Use first calendar (personal)
      const calUrl = calendars[0] || homeUrl;
      const uid = await createEvent(calUrl, { title, start, end: end || start, notes, location, allDay });

      return new Response(JSON.stringify({ ok: true, uid }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Method not allowed', { status: 405, headers: CORS });

  } catch (err) {
    console.error('[apple-calendar] Error:', err);
    await _db.from('jarvis_errors').insert({
      source: 'edge:apple-calendar', error_type: 'edge_fn',
      message: String(err).slice(0, 500)
    }).catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
