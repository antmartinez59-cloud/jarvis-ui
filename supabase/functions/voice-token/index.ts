// JARVIS — voice-token Edge Function
// Returns the Deepgram API key for browser WebSocket auth
// Key stays server-side in Vault — browser gets it per-request only

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const DEEPGRAM_KEY = Deno.env.get('DEEPGRAM_API_KEY');
    if (!DEEPGRAM_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'DEEPGRAM_API_KEY not set in Vault' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, token: DEEPGRAM_KEY }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[voice-token] error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
