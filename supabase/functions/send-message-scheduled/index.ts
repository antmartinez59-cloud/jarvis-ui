// JARVIS — send-message-scheduled Edge Function
// Called by pg_cron every minute — fires any scheduled messages that are due

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
  const SUPABASE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const TWILIO_SID    = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const TWILIO_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const TWILIO_FROM   = Deno.env.get('TWILIO_FROM_NUMBER') ?? '';

  const supaHeaders = { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' };

  // Fetch due messages
  const res = await fetch(`${SUPABASE_URL}/rest/v1/messages?status=eq.scheduled&send_at=lte.${new Date().toISOString()}&select=*`, { headers: supaHeaders });
  const due: Array<{id:number, recipient_phone:string, recipient_name:string, body:string}> = res.ok ? await res.json() : [];

  console.log(`[scheduled] ${due.length} messages due`);
  let sent = 0;

  for (const msg of due) {
    try {
      const phone = msg.recipient_phone.replace(/[^\d+]/g, '');
      const e164 = phone.startsWith('+') ? phone : '+1' + phone;

      const form = new URLSearchParams({ To: e164, From: TWILIO_FROM, Body: msg.body });
      const tw = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });

      const status = tw.ok ? 'sent' : 'failed';
      await fetch(`${SUPABASE_URL}/rest/v1/messages?id=eq.${msg.id}`, {
        method: 'PATCH', headers: supaHeaders,
        body: JSON.stringify({ status, sent_at: new Date().toISOString() }),
      });

      if (tw.ok) sent++;
      console.log(`[scheduled] msg ${msg.id} to ${msg.recipient_name}: ${status}`);
    } catch(e) {
      console.error(`[scheduled] msg ${msg.id} error:`, (e as Error).message);
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: due.length, sent }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
