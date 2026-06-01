// JARVIS — Apple Calendar Edge Function (iCloud CalDAV)
// Secrets: APPLE_CALDAV_USER, APPLE_CALDAV_PASSWORD (app-specific password)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CALDAV_BASE = 'https://caldav.icloud.com';

function basicAuth(user: string, pass: string) {
  return 'Basic ' + btoa(`${user}:${pass}`);
}

// Discover the actual calendar path via CalDAV PROPFIND
async function discoverCalendarPath(auth: string): Promise<string> {
  // Step 1: Find principal URL via well-known
  const step1 = await fetch(`${CALDAV_BASE}/.well-known/caldav`, {
    method: 'PROPFIND',
    headers: {
      'Authorization': auth,
      'Depth': '0',
      'Content-Type': 'application/xml',
      'Prefer': 'return-minimal',
    },
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
    redirect: 'follow',
  });

  const xml1 = await step1.text();

  // Extract principal href
  const principalMatch = xml1.match(/<d:href[^>]*>([^<]+)<\/d:href>/) ||
                         xml1.match(/<href[^>]*>([^<]+)<\/href>/);

  let principalPath = principalMatch?.[1] || '';

  // Step 2: Get calendar-home-set from principal
  if (principalPath) {
    const principalUrl = principalPath.startsWith('http')
      ? principalPath
      : `${CALDAV_BASE}${principalPath}`;

    const step2 = await fetch(principalUrl, {
      method: 'PROPFIND',
      headers: {
        'Authorization': auth,
        'Depth': '0',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
    });

    const xml2 = await step2.text();
    const homeMatch = xml2.match(/<cal:calendar-home-set[^>]*>[\s\S]*?<d:href[^>]*>([^<]+)<\/d:href>/) ||
                      xml2.match(/calendar-home-set[\s\S]*?<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/);
    if (homeMatch?.[1]) return homeMatch[1];
  }

  // Fallback: common iCloud path patterns
  return null;
}

function parseVEvents(vcal: string): any[] {
  const events: any[] = [];
  const blocks = vcal.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  for (const block of blocks) {
    const get = (key: string) => {
      const m = block.match(new RegExp(`(?:^|\\n)${key}[^:]*:(.+)`, 'm'));
      return m ? m[1].trim().replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\r/g, '') : '';
    };
    const dtstart = get('DTSTART');
    const dtend = get('DTEND');
    const allDay = !dtstart.includes('T');
    const parseDate = (dt: string) => {
      if (!dt) return '';
      if (!dt.includes('T')) return `${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`;
      const clean = dt.replace('Z', '').replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
      return clean;
    };
    const title = get('SUMMARY');
    if (!title) continue;
    events.push({
      uid: get('UID'),
      title,
      start: parseDate(dtstart),
      end: parseDate(dtend),
      location: get('LOCATION'),
      notes: get('DESCRIPTION'),
      allDay,
    });
  }
  return events;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const user = Deno.env.get('APPLE_CALDAV_USER') || '';
  const pass = Deno.env.get('APPLE_CALDAV_PASSWORD') || '';

  if (!user || !pass) return new Response(
    JSON.stringify({ error: 'APPLE_CALDAV_USER and APPLE_CALDAV_PASSWORD not set in Vault' }),
    { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
  );

  const auth = basicAuth(user, pass);
  const url = new URL(req.url);

  // GET — fetch events
  if (req.method === 'GET') {
    const start = url.searchParams.get('start') || new Date().toISOString().slice(0, 10);
    const end = url.searchParams.get('end') || start;

    try {
      // Discover calendar home path
      let calHome = await discoverCalendarPath(auth);

      if (!calHome) {
        // Fallback: try common iCloud patterns
        calHome = `/${user.split('@')[0]}/calendars/`;
      }

      const calUrl = calHome.startsWith('http') ? calHome : `${CALDAV_BASE}${calHome}`;
      const startDT = `${start.replace(/-/g, '')}T000000Z`;
      const endDT = `${end.replace(/-/g, '')}T235959Z`;

      const reportBody = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${startDT}" end="${endDT}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

      const report = await fetch(calUrl, {
        method: 'REPORT',
        headers: {
          'Authorization': auth,
          'Depth': '1',
          'Content-Type': 'application/xml; charset=utf-8',
        },
        body: reportBody,
      });

      if (!report.ok) {
        const errText = await report.text();
        return new Response(
          JSON.stringify({ error: `CalDAV ${report.status}: ${errText.slice(0, 200)}`, events: [] }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }

      const xml = await report.text();
      // Extract calendar-data content
      const dataBlocks = xml.match(/(?:cal:calendar-data|calendar-data)[^>]*>([\s\S]*?)(?:<\/cal:calendar-data|<\/calendar-data)/g) || [];
      const allVcal = dataBlocks.map(b => b.replace(/<[^>]*>/g, '')).join('\n');
      const events = parseVEvents(allVcal);

      return new Response(JSON.stringify({ ok: true, events }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message, events: [] }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  }

  // POST — create event
  if (req.method === 'POST') {
    try {
      const { title, start, end, location, notes, allDay } = await req.json();
      if (!title || !start) return new Response(
        JSON.stringify({ ok: false, error: 'title and start required' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );

      let calHome = await discoverCalendarPath(auth);
      if (!calHome) calHome = `/${user.split('@')[0]}/calendars/`;

      const uid = crypto.randomUUID();
      const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
      const fmtDT = (dt: string) => new Date(dt).toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

      const vcal = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JARVIS//EN', 'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        `UID:${uid}@jarvis`,
        `DTSTAMP:${now}`,
        allDay
          ? `DTSTART;VALUE=DATE:${new Date(start).toISOString().slice(0,10).replace(/-/g,'')}`
          : `DTSTART:${fmtDT(start)}`,
        allDay
          ? `DTEND;VALUE=DATE:${new Date(end||start).toISOString().slice(0,10).replace(/-/g,'')}`
          : `DTEND:${fmtDT(end||start)}`,
        `SUMMARY:${title}`,
        location ? `LOCATION:${location}` : null,
        notes ? `DESCRIPTION:${notes}` : null,
        'END:VEVENT', 'END:VCALENDAR',
      ].filter(Boolean).join('\r\n');

      const calUrl = (calHome.startsWith('http') ? calHome : `${CALDAV_BASE}${calHome}`) + `${uid}.ics`;
      const put = await fetch(calUrl, {
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
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      const errText = await put.text();
      return new Response(
        JSON.stringify({ ok: false, error: `CalDAV ${put.status}: ${errText.slice(0, 200)}` }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
