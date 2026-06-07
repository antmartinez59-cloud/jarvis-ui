// JARVIS — birthday-alerts Edge Function
// Called by pg_cron every morning at 8am CT — texts Tony about today's birthdays
// Vault keys: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TONY_PHONE_NUMBER

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
  const SUPABASE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const TWILIO_SID    = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const TWILIO_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const TWILIO_FROM   = Deno.env.get('TWILIO_FROM_NUMBER') ?? '';
  const TONY_PHONE    = Deno.env.get('TONY_PHONE_NUMBER') ?? '';

  const supaHeaders = { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY };

  // Get today's month and day in CT
  const now = new Date();
  const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const month = String(ct.getMonth() + 1).padStart(2, '0');
  const day = String(ct.getDate()).padStart(2, '0');

  // Find people with birthdays today (ignore year — match month-day)
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/people?select=name,birthday,relationship_type&birthday=not.is.null`,
    { headers: supaHeaders }
  );
  const people: Array<{name:string, birthday:string, relationship_type:string}> = res.ok ? await res.json() : [];

  const todayBdays = people.filter(p => {
    if (!p.birthday) return false;
    const parts = p.birthday.split('-');
    return parts[1] === month && parts[2] === day;
  });

  if (!todayBdays.length) {
    return new Response(JSON.stringify({ ok: true, alerts: 0 }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // Build SMS
  const names = todayBdays.map(p => p.name);
  let msg = `JARVIS: 🎂 Birthday alert — `;
  if (names.length === 1) {
    msg += `Today is ${names[0]}'s birthday sir. Want me to send them a message?`;
  } else {
    msg += `Today is ${names.slice(0,-1).join(', ')} and ${names[names.length-1]}'s birthday sir. Want me to send them messages?`;
  }

  // Send via Twilio
  const form = new URLSearchParams({ To: TONY_PHONE, From: TWILIO_FROM, Body: msg });
  const tw = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  console.log('[birthday-alerts]', names, tw.ok ? 'sent' : 'failed');

  return new Response(JSON.stringify({ ok: tw.ok, alerts: names.length, names }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
