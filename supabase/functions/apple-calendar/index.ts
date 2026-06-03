// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — apple-calendar Edge Function                   ║
// ║  Read + create Apple Calendar events via iCloud CalDAV   ║
// ║                                                          ║
// ║  GET    ?start=YYYY-MM-DD&end=YYYY-MM-DD                 ║
// ║    → { events: [{id,title,start,end,location,notes,...}] }║
// ║  POST   { title, start, end, notes?, location?, allDay? }║
// ║    → { ok: true, uid }                                   ║
// ║  DELETE { uid }                                          ║
// ║    → { ok: true }                                        ║
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
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

const authHeader = () => ({
  'Authorization': 'Basic ' + btoa(`${APPLE_USER}:${APPLE_PASS}`),
  'Content-Type': 'application/xml; charset=utf-8',
});

// ── Discover iCloud calendar home URL ────────────────────────────────────────
async function getCalendarHome(): Promise<string> {
  const auth = authHeader()['Authorization'];
  const headers = {
    'Authorization': auth,
    'Depth': '0',
    'Content-Type': 'application/xml; charset=utf-8',
  };

  // Step 1: well-known PROPFIND
  const wk = await fetch('https://caldav.icloud.com/.well-known/caldav', {
    method: 'PROPFIND',
    headers,
    body: `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop><D:current-user-principal/></D:prop>
</D:propfind>`,
  });
  const wkText = await wk.text();
  console.log('[calendar] well-known status:', wk.status);

  // Extract principal path (same regex as apple-remind)
  const principalMatch = wkText.match(/<D:href>([^<]+principal[^<]*)<\/D:href>/i)
    || wkText.match(/<href>([^<]+principal[^<]*)<\/href>/i);

  let principalUrl: string;
  if (principalMatch) {
    const p = principalMatch[1];
    principalUrl = p.startsWith('http') ? p : `https://caldav.icloud.com${p}`;
  } else {
    // Fallback: derive from email prefix (same as apple-remind)
    const prefix = APPLE_USER.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
    principalUrl = `https://caldav.icloud.com/${prefix}/principal/`;
  }
  console.log('[calendar] principalUrl:', principalUrl);

  // Step 2: PROPFIND to get calendar-home-set
  const ph = await fetch(principalUrl, {
    method: 'PROPFIND',
    headers,
    body: `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><C:calendar-home-set/></D:prop>
</D:propfind>`,
  });
  const phText = await ph.text();
  console.log('[calendar] home propfind status:', ph.status, phText.slice(0, 300));

  // Must find href INSIDE <calendar-home-set>, not just any first href
  const homeMatch = phText.match(/calendar-home-set[\s\S]*?<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/i)
    || phText.match(/<C:calendar-home-set[^>]*>[\s\S]*?<D:href>([^<]+)<\/D:href>/i)
    || phText.match(/<calendar-home-set[^>]*>[\s\S]*?<href>([^<]+)<\/href>/i);

  if (!homeMatch) {
    // Fallback: derive calendars URL from principal
    const fallback = principalUrl.replace('/principal/', '/calendars/').replace('/principal', '/calendars/');
    console.log('[calendar] using fallback homeUrl:', fallback);
    return fallback;
  }

  const homePath = homeMatch[1];
  const homeUrl = homePath.startsWith('http') ? homePath : `https://caldav.icloud.com${homePath}`;
  console.log('[calendar] homeUrl:', homeUrl);
  return homeUrl;
}

// ── List all calendar collections ────────────────────────────────────────────
async function listCalendars(homeUrl: string): Promise<string[]> {
  const resp = await fetch(homeUrl, {
    method: 'PROPFIND',
    headers: { ...authHeader(), Depth: '1' },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <prop><resourcetype/><C:supported-calendar-component-set/></prop>
</propfind>`,
  });
  const text = await resp.text();

  // iCloud uses UUID paths for actual calendar collections — most reliable pattern
  const uuidRe = /\/([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\//gi;
  const seen   = new Set<string>();
  const urls: string[] = [];

  // Build absolute base from homeUrl directly (avoid URL normalization stripping :443)
  const proto = homeUrl.startsWith('https') ? 'https' : 'http';
  const hostWithPort = homeUrl.split('/')[2]; // e.g. "p171-caldav.icloud.com:443"
  const base = `${proto}://${hostWithPort}`;
  const homePath = '/' + homeUrl.split('/').slice(3).join('/'); // e.g. "/17710551327/calendars/"

  for (const m of text.matchAll(uuidRe)) {
    const uuid = m[1].toUpperCase();
    if (seen.has(uuid)) continue;
    seen.add(uuid);
    // Only include if this UUID calendar supports VEVENT
    const idx = text.indexOf(uuid);
    const block = text.slice(Math.max(0, idx - 100), idx + 800);
    if (block.includes("name='VEVENT'") || block.includes('name="VEVENT"')) {
      urls.push(`${base}${homePath}${uuid}/`);
      const nameMatch = block.match(/<displayname[^>]*>([^<]*)<\/displayname>/i);
      const calName = nameMatch ? nameMatch[1].trim() : uuid;
      console.log('[calendar] found VEVENT calendar:', uuid, '— name:', calName);
    }
  }

  console.log('[calendar] VEVENT collections:', urls);
  return urls.length ? urls : [`${base}${homePath}`];
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

  // Extract response blocks (each has href + calendar-data)
  const responseBlocks = text.match(/<[^:]*:?response[^>]*>[\s\S]*?<\/[^:]*:?response>/gi) || [];
  const events: any[] = [];

  const proto = calUrl.startsWith('https') ? 'https' : 'http';
  const host  = calUrl.split('/')[2];

  for (const resp of responseBlocks) {
    const hrefMatch = resp.match(/<[^:]*:?href[^>]*>([^<]+\.ics)<\/[^:]*:?href>/i);
    const dataMatch = resp.match(/<[^:]*:?calendar-data[^>]*>([\s\S]*?)<\/[^:]*:?calendar-data>/i);
    if (!dataMatch) continue;
    const ical = dataMatch[1].replace(/<[^>]+>/g, '').trim();
    const parsed = parseVEvent(ical);
    if (parsed) {
      if (hrefMatch) {
        const hrefPath = hrefMatch[1].trim();
        parsed.href = hrefPath.startsWith('http') ? hrefPath : `${proto}://${host}${hrefPath}`;
      }
      events.push(parsed);
    }
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
  const uid = crypto.randomUUID();
  // DTSTAMP must be YYYYMMDDTHHMMSSZ — strip dashes, colons, milliseconds
  const now = new Date().toISOString().replace(/[-:.]/g,'').slice(0,15) + 'Z';

  const fmtDT = (s: string, allDay: boolean) => {
    if (allDay) return s.replace(/-/g, '').slice(0, 8);
    const d = new Date(s);
    if (isNaN(d.getTime())) return s.replace(/[-:]/g,'').replace('T','T').slice(0,15);
    const pad = (n: number) => String(n).padStart(2,'0');
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  };

  // Ensure end >= start; default to start + 1 hour
  let endDate = event.end ? new Date(event.end) : null;
  const startDate = new Date(event.start);
  if (!endDate || isNaN(endDate.getTime()) || endDate <= startDate) {
    endDate = new Date(startDate.getTime() + 60*60*1000);
  }
  const endStr = event.allDay
    ? endDate.toISOString().slice(0,10).replace(/-/g,'')
    : fmtDT(endDate.toISOString(), false);

  const vevent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//JARVIS//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    event.allDay ? `DTSTART;VALUE=DATE:${fmtDT(event.start, true)}`
                 : `DTSTART:${fmtDT(event.start, false)}`,
    event.allDay ? `DTEND;VALUE=DATE:${endStr}`
                 : `DTEND:${endStr}`,
    `SUMMARY:${event.title}`,
    event.location ? `LOCATION:${event.location}` : null,
    event.notes    ? `DESCRIPTION:${event.notes}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  const putUrl = (calUrl.endsWith('/') ? calUrl : calUrl + '/') + uid + '.ics';
  console.log('[calendar] PUT url:', putUrl);
  console.log('[calendar] VEVENT:', vevent);
  const resp = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      ...authHeader(),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*',
    },
    body: vevent,
  });

  const respBody = await resp.text().catch(() => '');
  const wwwAuth = resp.headers.get('WWW-Authenticate') || '';
  console.log('[calendar] PUT status:', resp.status, '| WWW-Auth:', wwwAuth, '| body:', respBody.slice(0,300));
  if (!resp.ok && resp.status !== 201 && resp.status !== 204) {
    throw new Error(`PUT failed ${resp.status}: ${respBody.slice(0,200)}`);
  }
  return uid;
}

// ── Find and delete an event by UID ──────────────────────────────────────────
async function deleteEvent(calendars: string[], uid: string, href?: string): Promise<boolean> {
  // Strategy 1: Use stored href directly (most reliable for all event sources)
  if (href) {
    console.log('[calendar] DELETE via stored href:', href);
    const del = await fetch(href, {
      method: 'DELETE',
      headers: { 'Authorization': authHeader()['Authorization'] },
    });
    console.log('[calendar] href DELETE status:', del.status);
    if (del.status === 204 || del.status === 200) return true;
  }

  // Strategy 2: Direct DELETE by constructing URL from UID (works for JARVIS-created events)
  const SKIP_UUIDS = ['3BD98F0E-5C87-4BBE-9791-E4778E866A2E']; // Reminders — fake-204s DELETE
  for (const calUrl of calendars.filter(c => !SKIP_UUIDS.some(s => c.toUpperCase().includes(s)))) {
    const directUrl = (calUrl.endsWith('/') ? calUrl : calUrl + '/') + uid + '.ics';
    console.log('[calendar] direct DELETE attempt:', directUrl);
    const del = await fetch(directUrl, {
      method: 'DELETE',
      headers: { 'Authorization': authHeader()['Authorization'] },
    });
    console.log('[calendar] direct DELETE status:', del.status, 'for', calUrl.split('/').slice(-2)[0]);
    if (del.status === 204 || del.status === 200) {
      console.log('[calendar] deleted via direct URL:', directUrl);
      return true;
    }
  }

  // Strategy 3: REPORT search across all calendars (works for iPhone-created events)
  for (const calUrl of calendars) {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:prop-filter name="UID">
          <c:text-match collation="i;octet">${uid}</c:text-match>
        </c:prop-filter>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

    const report = await fetch(calUrl, {
      method: 'REPORT',
      headers: { ...authHeader(), Depth: '1' },
      body,
    });
    if (!report.ok) continue;
    const text = await report.text();

    const hrefMatches = text.match(/<[^:]*:?href[^>]*>([^<]+\.ics)<\/[^:]*:?href>/gi) || [];
    for (const match of hrefMatches) {
      const path = match.replace(/<[^>]+>/g, '').trim();
      if (!path) continue;
      const deleteUrl = path.startsWith('http') ? path : `${proto_base(calUrl)}${path}`;
      const del = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { 'Authorization': authHeader()['Authorization'] },
      });
      if (del.status === 204 || del.status === 200) {
        console.log('[calendar] deleted event via REPORT search:', deleteUrl);
        return true;
      }
    }
  }

  console.warn('[calendar] event not found to delete (already deleted or not created by JARVIS):', uid);
  return true; // idempotent — treat not found as success
}

// ── Main request handler ──────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    if (!APPLE_USER || !APPLE_PASS) {
      return new Response(JSON.stringify({ ok: false, error: 'APPLE_CALDAV_USER or APPLE_CALDAV_PASSWORD not set' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const homeUrl = await getCalendarHome();
    const calendars = await listCalendars(homeUrl);

    // ── GET: fetch events for date range ────────────────────────────────
    if (req.method === 'GET') {
      const start = url.searchParams.get('start') || new Date().toISOString().slice(0,10);
      const end   = url.searchParams.get('end')   || start;
      const events: any[] = [];
      for (const calUrl of calendars) {
        const evts = await fetchEvents(calUrl, start, end);
        events.push(...evts);
      }
      events.sort((a,b)=> (a.start||'').localeCompare(b.start||''));
      return new Response(JSON.stringify({ ok: true, events }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── POST: create event ────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = await req.json();
      if (body.uid && !body.title) {
        // DELETE via POST fallback (some clients can't send DELETE with body)
        const deleted = await deleteEvent(calendars, body.uid);
        return new Response(JSON.stringify({ ok: deleted, error: deleted ? undefined : 'Event not found' }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      const { title, start, end, notes, location, allDay } = body;
      if (!title || !start) {
        return new Response(JSON.stringify({ ok: false, error: 'title and start are required' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      // Try each calendar until one accepts the PUT (skip Reminders/VTODO collections)
      const REMINDERS_UUID = '3BD98F0E-5C87-4BBE-9791-E4778E866A2E';
      const calTargets = calendars.filter(c => !c.toUpperCase().includes(REMINDERS_UUID));
      if (!calTargets.length) calTargets.push(...calendars);
      let uid = '';
      let createErr = '';
      for (const calTarget of calTargets) {
        console.log('[calendar] creating event in:', calTarget);
        try { uid = await createEvent(calTarget, { title, start, end, notes, location, allDay }); break; }
        catch(e) { createErr = String(e); console.warn('[calendar] create failed for', calTarget, String(e).slice(0,100)); }
      }
      if (!uid) throw new Error(createErr || 'All calendars rejected the event');
      return new Response(JSON.stringify({ ok: true, uid }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── DELETE: remove event by uid ───────────────────────────────────
    if (req.method === 'DELETE') {
      const body = await req.json().catch(() => ({}));
      const uid = body.uid;
      const href = body.href;
      if (!uid) {
        return new Response(JSON.stringify({ ok: false, error: 'uid required' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      const deleted = await deleteEvent(calendars, uid, href);
      return new Response(JSON.stringify({ ok: deleted, error: deleted ? undefined : 'Event not found or already deleted' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[calendar] handler error:', err);
    try { await _db.from('jarvis_errors').insert({ source: 'edge:apple-calendar', error_type: 'edge_fn', message: String(err).slice(0,500) }); } catch(_){}
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
