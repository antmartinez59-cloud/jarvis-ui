// JARVIS — Anthropic API Proxy Edge Function
// Forwards requests to Anthropic API using ANTHROPIC_KEY from Vault

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, anthropic-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const apiKey = Deno.env.get('ANTHROPIC_KEY') || '';
    if (!apiKey) return new Response(JSON.stringify({ error: { message: 'ANTHROPIC_KEY not set in Vault' } }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: e.message } }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
