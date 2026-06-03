// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — apple-remind Edge Function                     ║
// ║  Creates reminders in Apple Reminders via iCloud CalDAV  ║
// ║                                                          ║
// ║  POST { title, notes?, dueDate?, dueMinutesFromNow?,     ║
// ║         priority? }                                      ║
// ║    → { ok: true, uid }                                   ║
// ║                                                          ║
// ║  Secrets: APPLE_CALDAV_USER, APPLE_CALDAV_PASSWORD       ║
// ╚══════════════════════════════════════════════════════════╝

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const _db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const APPLE_USER = Deno.env.get('APPLE_CALDAV_USER') || '';
const APPLE_PASS = Deno.env.get('APPLE_CALDAV_PASSWORD') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PRIORITY_MAP: Record<string, number> = {
  urgent: 1, high: 2, medium: 5, low: 9, none: 0,
};

function authHeader() {
  return { 'Authorization': 'Basic ' + btoa(`${APPLE_USER}:${APPLE_PASS}`) };
}

async function getCalendarHome(): Promise<string> {
  const headers = {
    ...authHeader(),
    'Depth': '0',
    'Content-Type': 'application/xml; charset=utf-8',
  };
  const wk = await fetch('https://caldav.icloud.com/.well-known/caldav', {
    method: 'PROPFIND',
    headers,
    body: `<?xml version="1.0" encoding="UTF-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`,
  });
  const wkText = await wk.text();
  const principalMatch = wkText.match(/<D:href>([^<]+principal[^<]*)<\/D:href>/i)
    || wkText.match(/<href>([^<]+principal[^<]*)<\/href>/i);
  let principalUrl: string;
  if (principalMatch) {
    const p = principalMatch[1];
    principalUrl = p.startsWith('http') ? p : `https://caldav.icloud.com${p}`;
  } else {
    principalUrl = `https://caldav.icloud.com/${APPLE_USER.split('@')[0]}/principal/`;
  }
  const ph = await fetch(principalUrl, {
    method: 'PROPFIND',
    headers,
    body: `<?xml version="1.0" encoding="UTF-8"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`,
  });
  const phText = await ph.text();
  const homeMatch = phText.match(/calendar-home-set[\s\S]*?<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/i)
    || phText.match(/<C:calendar-home-set[^>]*>[\s\S]*?<D:href>([^<]+)<\/D:href>/i)
    || phText.match(/<calendar-home-set[^>]*>[\s\S]*?<href>([^<]+)<\/href>/i);
  if (!homeMatch) {
    return principalUrl.replace('/principal/', '/calendars/').replace('/principal', '/calendars/');
  }
  const homePath = homeMatch[1];
  return homePath.startsWith('http') ? homePath : `https://caldav.icloud.com${homePath}`;
}

// Returns array of { url, name } for all VTODO collections
async function findVtodoCollections(homeUrl: string): Promise<{ url: string; name: string }[]> {
  const resp = await fetch(homeUrl, {
    method: 'PROPFIND',
    headers: { ...authHeader(), 'Content-Type': 'application/xml; charset=utf-8', Depth: '1' },
    body: `<?xml version="1.0" encoding="UTF-8"?><propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><resourcetype/><displayname/><C:supported-calendar-component-set/></prop></propfind>`,
  });
  const text = await resp.text();
  console.log('[remind] PROPFIND status:', resp.status, 'body length:', text.length);

  const proto = homeUrl.startsWith('https') ? 'https' : 'http';
  const hostWithPort = homeUrl.split('/')[2];
  const homePath = '/' + homeUrl.split('/').slice(3).join('/');
  const base = `${proto}://${hostWithPort}`;

  const uuidRe = /\/([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\//gi;
  const seen = new Set<string>();
  const results: { url: string; name: string }[] = [];

  for (const m of text.matchAll(uuidRe)) {
    const uuidRaw = m[1];
    const uuidKey = uuidRaw.toUpperCase();
    if (seen.has(uuidKey)) continue;
    seen.add(uuidKey);
    const idx = m.index ?? 0;
    const block = text.slice(Math.max(0, idx - 200), idx + 2000);
    if (block.includes("name='VTODO'") || block.includes('name="VTODO"')) {
      const url = `${base}${homePath}${uuidRaw}/`;
      const nameMatch = block.match(/<displayname[^>]*>([^<]*)<\/displayname>/i);
      const name = nameMatch ? nameMatch[1].trim() : uuidRaw;
      results.push({ url, name });
      console.log('[remind] VTODO collection:', name, '→', url);
    }
  }

  if (!results.length) {
    console.log('[remind] PROPFIND body (first 3000):', text.slice(0, 3000));
  }

  return results;
}

// Verify an item actually exists on the server via GET
async function verifyItem(putUrl: string): Promise<boolean> {
  try {
    const res = await fetch(putUrl, {
      method: 'GET',
      headers: { ...authHeader() },
    });
    console.log('[remind] verify GET status:', res.status, 'for', putUrl);
    return res.status === 200;
  } catch {
    return false;
  }
}

// Create a new VTODO-only calendar collection via MKCALENDAR
async function createJarvisCollection(homeUrl: string): Promise<string | null> {
  const collUrl = homeUrl.endsWith('/') ? homeUrl + 'jarvis-reminders/' : homeUrl + '/jarvis-reminders/';
  console.log('[remind] creating JARVIS collection at:', collUrl);
  const res = await fetch(collUrl, {
    method: 'MKCALENDAR',
    headers: {
      ...authHeader(),
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>JARVIS</D:displayname>
      <C:supported-calendar-component-set>
        <C:comp name="VTODO"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>`,
  });
  const body = await res.text().catch(() => '');
  console.log('[remind] MKCALENDAR status:', res.status, body.slice(0, 200));
  if (res.ok || res.status === 201) return collUrl;
  // 405 = already exists — that's fine, use it
  if (res.status === 405) return collUrl;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    if (!APPLE_USER || !APPLE_PASS) {
      return new Response(JSON.stringify({ ok: false, error: 'APPLE_CALDAV_USER or APPLE_CALDAV_PASSWORD not set' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { title, notes, dueDate, dueMinutesFromNow, priority } = body;

    if (!title) return new Response(JSON.stringify({ ok: false, error: 'title is required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

    let due: Date | undefined;
    if (dueDate) {
      due = new Date(dueDate);
    } else if (dueMinutesFromNow) {
      due = new Date(Date.now() + dueMinutesFromNow * 60000);
    }

    const now  = new Date().toISOString().replace(/[-:.]/g,'').slice(0,15) + 'Z';
    const prio = PRIORITY_MAP[priority || 'none'] ?? 0;
    const uid  = crypto.randomUUID();

    let dueField: string | null = null;
    let hasTime = false;
    if (due) {
      const dateStr = due.toISOString().slice(0,10).replace(/-/g,'');
      const hasSpecificTime = dueDate?.includes('T') && !dueDate.endsWith('T00:00') && !dueDate.endsWith('T00:00:00');
      if (hasSpecificTime) {
        dueField = due.toISOString().replace(/[-:.]/g,'').slice(0,15) + 'Z';
        hasTime = true;
      } else {
        dueField = dateStr;
        hasTime = false;
      }
    }

    const vtodo = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//JARVIS//EN',
      'BEGIN:VTODO',
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `CREATED:${now}`,
      `SUMMARY:${title}`,
      notes    ? `DESCRIPTION:${notes.replace(/\n/g, '\\n')}` : null,
      dueField ? (hasTime ? `DUE:${dueField}` : `DUE;VALUE=DATE:${dueField}`) : null,
      hasTime  ? `DTSTART:${now}` : null,
      prio     ? `PRIORITY:${prio}` : null,
      'STATUS:NEEDS-ACTION',
      'SEQUENCE:0',
      'END:VTODO',
      'END:VCALENDAR',
    ].filter(Boolean).join('\r\n') + '\r\n';

    const homeUrl = await getCalendarHome();
    const collections = await findVtodoCollections(homeUrl);

    let created = false;
    let usedCollection = '';
    let lastErr = '';

    // Try each existing VTODO collection; verify item actually exists after PUT
    for (const { url, name } of collections) {
      const putUrl = url.endsWith('/') ? url + uid + '.ics' : url + '/' + uid + '.ics';
      console.log('[remind] trying PUT to:', name, putUrl);
      const res = await fetch(putUrl, {
        method: 'PUT',
        headers: {
          ...authHeader(),
          'Content-Type': 'text/calendar; charset=utf-8',
          'If-None-Match': '*',
        },
        body: vtodo,
      });
      const errBody = res.ok ? '' : await res.text().catch(() => '');
      console.log('[remind] PUT status:', res.status, errBody.slice(0, 200));

      if (res.ok || re