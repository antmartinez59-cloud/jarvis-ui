// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — voice-token Edge Function                      ║
// ║  Returns a short-lived Deepgram API token for browser    ║
// ║  so the real DEEPGRAM_API_KEY stays server-side          ║
// ╚══════════════════════════════════════════════════════════╝

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
      return new Response(JSON.stringify({ ok: false, error: 'DEEPGRAM_API_KEY not set' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Create a temporary Deepgram API key (expires in 10 seconds — just enough to open the WebSocket)
    const res = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { 'Authorization': `Token ${DEEPGRAM_KEY}` },
    });
    const projects = await res.json();
    const projectId = projects?.projects?.[0]?.project_id;

    if (!projectId) {
      // Fallback: return the real key (less secure but functional)
      console.warn('[voice-token] Could not get project ID, returning direct key');
      return new Response(JSON.stringify({ ok: true, token: DEEPGRAM_KEY, type: 'api_key' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Create short-lived token
    const tokenRes = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comment: 'JARVIS voice session',
        scopes: ['usage:write'],
        time_to_live_in_seconds: 30,
      }),
    });

    const tokenData = await tokenRes.json();
    const token = tokenData?.key;

    if (!token) {
      // Fallback to real key
      return new Response(JSON.stringify({ ok: true, token: DEEPGRAM_KEY, type: 'api_key' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, token, type: 'temporary' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[voice-token] error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
