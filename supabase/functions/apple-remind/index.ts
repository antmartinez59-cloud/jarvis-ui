// JARVIS — Apple Remind Edge Function
// Creates reminders in Apple Reminders via iCloud CalDAV
// Secrets: APPLE_CALDAV_USER, APPLE_CALDAV_PASSWORD (app-specific password)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function basicAuth(user: string, pass: string) {
  return 'Basic ' + btoa(`${user}:${pass}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { title, notes, remind_at, todo_id, reminder_id } = await req.json();
    const user = Deno.env.get('APPLE_CALDAV_USER') || '';
    const pass = Deno.env.get('APPLE_CALDAV_PASSWORD') || '';

    if (!user || !pass) return new Response(
      JSON.stringify({ ok: false, error: 'APPLE_CALDAV_USER and APPLE_CALDAV_PASSWORD not set in Vault' }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
    );

    if (!title || !remind_at) return new Response(
      JSON.stringify({ ok: false, error: 'title and remind_at required' }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
    );

    const auth = basicAuth(user, pass);
    const uid = reminder_id || crypto.randomUUID();
    const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
    const dueDT = new Date(remind_at).toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

    const vtodo = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JARVIS//EN',
      'BEGIN:VTODO',
      `UID:${uid}@jarvis`,
      `DTSTAMP:${now}`,
      `DUE:${dueDT}`,
      `SUMMARY:${title}`,
      notes ? `DESCRIPTION:${notes}` : '',
      'STATUS:NEEDS-ACTION',
      'END:VTODO', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');

    // Try Reminders CalDAV path
    const calPath = `/dav/${user}/reminders/${uid}.ics`;
    const put = await fetch(`https://caldav.icloud.com${calPath}`, {
      method: 'PUT',
      headers: {
        'Authorization': auth,
        'Content-Type': 'text/calendar; charset=utf-8',
        'If-None-Match': '*',
      },
      body: vtodo,
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
});
