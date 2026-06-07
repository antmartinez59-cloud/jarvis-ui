// JARVIS — send-message Edge Function
// Sends SMS via Twilio. Logs all messages to Supabase.
// POST { recipientName, recipientPhone, body, method? }
// Vault keys: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const TWILIO_SID   = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const TWILIO_FROM  = Deno.env.get('TWILIO_FROM_NUMBER') ?? '';

  try {
    const { recipientName, recipientPhone, body, method = 'twilio', messageId } = await req.json();

    if (!recipientPhone || !body) {
      return new Response(JSON.stringify({ ok: false, error: 'recipientPhone and body required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Clean phone number
    const phone = recipientPhone.replace(/[^\d+]/g, '');
    const e164 = phone.startsWith('+') ? phone : '+1' + phone;

    let twilioSid = null;

    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
      return new Response(JSON.stringify({ ok: false, error: 'Twilio credentials not set in Vault' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Send via Twilio
    const form = new URLSearchParams({ To: e164, From: TWILIO_FROM, Body: body });
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      }
    );
    const twilioData = await twilioRes.json();
    if (!twilioRes.ok) throw new Error(twilioData.message || 'Twilio send failed');
    twilioSid = twilioData.sid;

    // Log to Supabase
    const supaHeaders = {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json',
    };

    if (messageId) {
      // Update existing draft
      await fetch(`${SUPABASE_URL}/rest/v1/messages?id=eq.${messageId}`, {
        method: 'PATCH',
        headers: supaHeaders,
        body: JSON.stringify({ status: 'sent', twilio_sid: twilioSid, sent_at: new Date().toISOString() }),
      });
    } else {
      // Insert new record
      await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
        method: 'POST',
        headers: { ...supaHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          recipient_name: recipientName || 'Unknown',
          recipient_phone: e164,
          body,
          status: 'sent',
          method,
          twilio_sid: twilioSid,
          sent_at: new Date().toISOString(),
        }),
      });
    }

    return new Response(JSON.stringify({ ok: true, sid: twilioSid }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
