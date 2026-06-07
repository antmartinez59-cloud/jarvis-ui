// JARVIS — twilio-webhook Edge Function
// Receives inbound SMS from Tony, processes via Claude, replies via Twilio
// Set this URL in Twilio console → Phone Numbers → Messaging webhook

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') ?? '';
  const SUPABASE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const ANTHROPIC_KEY   = Deno.env.get('ANTHROPIC_KEY') ?? '';
  const TWILIO_SID      = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const TWILIO_TOKEN    = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const TWILIO_FROM     = Deno.env.get('TWILIO_FROM_NUMBER') ?? '';
  const TONY_NUMBER     = Deno.env.get('TONY_PHONE_NUMBER') ?? '';  // Tony's real number for security check

  try {
    const body = await req.text();
    const params = new URLSearchParams(body);
    const from = params.get('From') ?? '';
    const msgBody = params.get('Body') ?? '';

    console.log('[twilio-webhook] from:', from, 'body:', msgBody);

    // Security: only respond to Tony's number (if configured)
    if (TONY_NUMBER && from !== TONY_NUMBER) {
      console.log('[twilio-webhook] blocked — unknown number:', from);
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // Log to sms_inbox
    const supaHeaders = {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json',
    };

    // Get recent Supabase context for JARVIS
    let context = 'You are JARVIS, Tony Martinez\'s personal AI assistant. Respond via SMS — keep replies under 160 chars, casual, direct. Address Tony as "sir" when natural.';
    try {
      const todosRes = await fetch(`${SUPABASE_URL}/rest/v1/todos?select=title&completed=eq.false&limit=5`, { headers: supaHeaders });
      const todos = todosRes.ok ? await todosRes.json() : [];
      if (todos.length) context += ` Open todos: ${todos.map((t: {title: string}) => t.title).join(', ')}.`;
    } catch (_) { /* skip */ }

    // Call Claude for response
    let reply = "Got it sir, I'm on it.";
    if (ANTHROPIC_KEY) {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 100,
          system: context,
          messages: [{ role: 'user', content: msgBody }],
        }),
      });
      const aiData = await aiRes.json();
      reply = aiData?.content?.[0]?.text ?? reply;
    }

    // Log to DB
    await fetch(`${SUPABASE_URL}/rest/v1/sms_inbox`, {
      method: 'POST',
      headers: { ...supaHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ from_number: from, body: msgBody, jarvis_reply: reply }),
    });

    // Reply via Twilio TwiML
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`;
    return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });

  } catch (e) {
    console.error('[twilio-webhook] error:', (e as Error).message);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>JARVIS error — try again sir.</Message></Response>`;
    return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
  }
});
