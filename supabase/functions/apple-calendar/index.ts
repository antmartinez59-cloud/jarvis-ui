// JARVIS — Apple Calendar Edge Function
// Reads and creates events via iCloud CalDAV
// Secrets: APPLE_CALDAV_USER, APPLE_CALDAV_PASSWORD (app-specific password)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CALDAV_BASE = 'https://caldav.icloud.com';

function basicAuth(user: string, pass: string): string {
  return 'Basic ' + btoa(`${user}:${pass}`);
}

function parseVEvents(vcal: string): any[] {
  const events: any[] = [];
  const eventBlocks = vcal.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  for (const block of eventBlocks) {
    const get = (key: string) => {
      const match = block.match(new RegExp(`${key}[^:]*:(.+)`));
      return match ? match[1].trim().replace(/\\n/g, '\n').replace(/\\,/g, ',') : '';
    };
    const dtstart = get('DTSTART');
    const dtend   = get('DTEND');
    const allDay  = dtstart.length === 8; // YYYYMMDD = all day
    const parseDate = (dt: string) => {
      if (!dt) return '';
      if (dt.length === 8) return `${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`;
      return dt.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/, '$1-$2-$3T$4:$5:$6');
    };
    events.push({
      uid:      get('UID'),
      title:    get('SUMMARY'),
      start:    parseDate(dtstart),
      end:      parseDate(dtend),
      location: get('LOCATION'),
      notes:    get('DESCRIPTION'),
      allDay,
    });
  }
  return events;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const user = Deno.env.get('APPLE_CALDAV_USER') || '';
  const pass = Deno.env.get('APPLE_CALDAV_PASSWORD') || '';
  if (!user || !pass) return new Response(
    JSON.stringify({ error: 'APPLE_CALDAV_USER and APPLE_CALDAV_PASSWORD not set in Vault' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

  const auth = basicAuth(user, pass);
  const url  = new URL(req.url);

  // GET — fetch events for date range
  if (req.method === 'GET') {
    const start = url.searchParams.get('start') || new Date().toISOString().slice(0,10);
    const end   = url.searchParams.get('end')   || start;

    try {
      // Discover calendar home
      const propfind = await fetch(`${CALDAV_BASE}/`, {
        method: 'PROPFIND',
        headers: { 'Authorization': auth, 'Depth': '0', 'Content-Type': 'application/xml' },
        body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
      });

      // Build time range query
      const startDT = `${start.replace(/-/g,'')}T000000Z`;
      const endDT   = `${end.replace(/-/g,'')}T235959Z`;
      const reportBody = `<?xml version="1.0"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR">
    <c:comp-filter name="VEVENT">
      <c:time-range start="${startDT}" end="${endDT}"/>
    </c:comp-filter>
  </c:comp-filter></c:filter>
</c:calendar-query>`;

      const calPath = `/dav/${user}/home/`;
      const report = await fetch(`${CALDAV_BASE}${calPath}`, {
        method: 'REPORT',
        headers: {
          'Authorization': auth, 'Depth': '1',
          'Content-Type': 'application/xml', 'Prefer': 'return-minimal',
        },
        body: reportBody,
      });

      const xml = await report.text();
      // Extract calendar-data sections
      const calDataBlocks = xml.match(/<cal:calendar-data[^>]*>([\s\S]*?)<\/cal:calendar-data>/g) || [];
      const allVcal = calDataBlocks.map(b => b.replace(/<[^>]*>/g, '')).join('\n');
      const events = parseVEvents(allVcal);

      return new Response(JSON.stringify({ ok: true, events }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message, events: [] }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // POST — create event
  if (req.method === 'POST') {
    try {
      const { title, start, end, location, notes, allDay } = await req.json();
      if (!title || !start) return new Response(
        JSON.stringify({ ok: false, error: 'title and start required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

      const uid = crypto.randomUUID();
      const now = new Date().toISOString().replace(/[-:.]/g,'').slice(0,15) + 'Z';
      const fmtDT = (dt: string) => dt.replace(/[-:]/g,'').replace('T','T').slice(0,15) + 'Z';

      const vcal = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JARVIS//EN',
        'BEGIN:VEVENT',
        `UID:${uid}@jarvis`,
        `DTSTAMP:${now}`,
        allDay ? `DTSTART;VALUE=DATE:${start.replace(/-/g,'')}` : `DTSTART:${fmtDT(start)}`,
        allDay ? `DTEND;VALUE=DATE:${(end||start).replace(/-/g,'')}` : `DTEND:${fmtDT(end||start)}`,
        `SUMMARY:${title}`,
        location ? `LOCATION:${location}` : '',
        notes    ? `DESCRIPTION:${notes}` : '',
        'END:VEVENT', 'END:VCALENDAR',
      ].filter(Boolean).join('\r\n');

      const calPath = `/dav/${user}/home/${uid}.ics`;
      const put = await fetch(`${CALDAV_BASE}${calPath}`, {
        method: 'PUT',
        headers: {
          'Authorization': auth,
          'Content-Type': 'text/calendar; charset=utf-8',
          'If-None-Match': '*',
        },
        body: vcal,
      });

      if (put.status === 201 || put.status === 204) {
        return new Response(JSON.stringify({ ok: true, uid }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errText = await put.text();
      return new Response(JSON.stringify({ ok: false, error: `CalDAV ${put.status}: ${errText.slice(0,200)}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
