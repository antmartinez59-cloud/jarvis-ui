// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — apple-remind Edge Function                     ║
// ║  Creates reminders in Apple Reminders via iCloud CalDAV  ║
// ║                                                          ║
// ║  Secrets needed (set once):                              ║
// ║    APPLE_CALDAV_USER     — your iCloud email             ║
// ║    APPLE_CALDAV_PASSWORD — app-specific password         ║
// ║      (appleid.apple.com → Sign-In & Security →           ║
// ║       App-Specific Passwords → Generate)                 ║
// ║                                                          ║
// ║  Can also be called directly:                            ║
// ║  POST { title, notes?, dueDate?, priority? }             ║
// ╚══════════════════════════════════════════════════════════╝

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const _db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const APPLE_USER = Deno.env.get('APPLE_CALDAV_USER');
const APPLE_PASS = Deno.env.get('APPLE_CALDAV_PASSWORD');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Priority mapping: urgent=1, high=2, medium=5, low=9 (iCal standard)
const PRIORITY_MAP: Record<string, number> = {
  urgent: 1,
  high:   2,
  medium: 5,
  low:    9,
  none:   0,
};

// ── Generate a UUID for the VTODO UID ───────────────────────
function generateUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Format date for iCal (YYYYMMDDTHHMMSSZ) ─────────────────
function toICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

// ── Discover CalDAV principal URL for this user ──────────────
async function discoverCalDAVUrl(user: string, pass: string): Promise<string | null> {
  const auth = 'Basic ' + btoa(`${user}:${pass}`);

  // Step 1: Find principal via well-known
  const wellKnownRes = await fetch('https://caldav.icloud.com/.well-known/caldav', {
    method: 'PROPFIND',
    headers: {
      'Authorization': auth,
      'Depth': '0',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:current-user-principal/>
  </D:prop>
</D:propfind>`,
  });

  const text = await wellKnownRes.text();

  // Extract principal href from response
  const principalMatch = text.match(/<D:href>([^<]+principal[^<]*)<\/D:href>/i)
    || text.match(/<href>([^<]+principal[^<]*)<\/href>/i);

  if (!principalMatch) {
    // Try direct path — iCloud uses predictable URLs
    const parts  = user.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
    return `https://caldav.icloud.com/${parts}/reminders/`;
  }

  const principalPath = principalMatch[1];
  const base          = principalPath.startsWith('http')
    ? principalPath
    : `https://caldav.icloud.com${principalPath}`;

  // Step 2: Find calendar-home-set
  const homeRes = await fetch(base, {
    method: 'PROPFIND',
    headers: {
      'Authorization':  auth,
      'Depth':          '0',
      'Content-Type':   'application/xml; charset=utf-8',
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-home-set/>
  </D:prop>
</D:propfind>`,
  });

  const homeText = await homeRes.text();
  const homeMatch = homeText.match(/<D:href>([^<]+)<\/D:href>/i)
    || homeText.match(/<href>([^<]+)<\/href>/i);

  if (!homeMatch) return null;

  const homePath = homeMatch[1];
  return homePath.startsWith('http')
    ? `${homePath}reminders/`
    : `https://caldav.icloud.com${homePath}reminders/`;
}

// ── Create a VTODO reminder in Apple Reminders ───────────────
async function createReminder(params: {
  title:    string;
  notes?:   string;
  dueDate?: Date;      // when the reminder fires
  priority?: string;   // urgent | high | medium | low
  listUrl?: string;    // override the CalDAV list URL
}): Promise<{ ok: boolean; uid?: string; error?: string }> {
  if (!APPLE_USER || !APPLE_PASS) {
    return { ok: false, error: 'APPLE_CALDAV_USER or APPLE_CALDAV_PASSWORD not set' };
  }

  const auth     = 'Basic ' + btoa(`${APPLE_USER}:${APPLE_PASS}`);
  const uid      = generateUID();
  const priority = PRIORITY_MAP[params.priority || 'none'] ?? 0;
  const now      = new Date();

  // Build VTODO
  const vtodo = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//JARVIS//EN',
    'BEGIN:VTODO',
    `UID:${uid}@jarvis`,
    `CREATED:${toICalDate(now)}`,
    `DTSTAMP:${toICalDate(now)}`,
    `SUMMARY:${params.title}`,
    params.notes   ? `DESCRIPTION:${params.notes.replace(/\n/g, '\\n')}` : '',
    params.dueDate ? `DUE:${toICalDate(params.dueDate)}`                  : '',
    priority > 0   ? `PRIORITY:${priority}`                               : '',
    'STATUS:NEEDS-ACTION',
    'END:VTODO',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  // Discover CalDAV URL (or use cached/provided)
  let listUrl = params.listUrl;
  if (!listUrl) {
    listUrl = await discoverCalDAVUrl(APPLE_USER, APPLE_PASS) || undefined;
    if (!listUrl) return { ok: false, error: 'Could not discover CalDAV URL' };
  }

  // PUT the VTODO
  const putUrl = `${listUrl}${uid}.ics`;
  const res    = await fetch(putUrl, {
    method:  'PUT',
    headers: {
      'Authorization': auth,
      'Content-Type':  'text/calendar; charset=utf-8',
      'If-None-Match': '*', // Don't overwrite if already exists
    },
    body: vtodo,
  });

  if (res.ok || res.status === 201 || res.status === 204) {
    console.log(`[apple-remind] Created reminder: "${params.title}" (${uid})`);
    return { ok: true, uid };
  }

  const errText = await res.text();
  console.error(`[apple-remind] CalDAV PUT failed (${res.status}):`, errText.slice(0, 200));
  return { ok: false, error: `CalDAV error ${res.status}: ${errText.slice(0, 100)}` };
}

// ── Main handler (for direct calls) ─────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  try {
    const body = await req.json();

    const { title, notes, dueMinutesFromNow, priority } = body;

    if (!title) {
      return new Response(JSON.stringify({ ok: false, error: 'title is required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const dueDate = dueMinutesFromNow
      ? new Date(Date.now() + dueMinutesFromNow * 60000)
      : undefined;

    const result = await createReminder({ title, notes, dueDate, priority });

    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    await _db.from('jarvis_errors').insert({ source: 'edge:apple-remind', error_type: 'edge_fn', message: String(err).slice(0,500) }).catch(()=>{});
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});

// ── Export createReminder for use by other Edge Functions ────
export { createReminder };
