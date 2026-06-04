// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — voice-speak Edge Function                      ║
// ║  Takes text → ElevenLabs TTS → streams audio back        ║
// ║  POST { text, voice_id? }                                ║
// ╚══════════════════════════════════════════════════════════╝

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const EL_KEY     = Deno.env.get('ELEVENLABS_API_KEY');
    const EL_VOICE   = Deno.env.get('ELEVENLABS_VOICE_ID') || 'pNInz6obpgDQGcFmaJgB'; // Adam fallback
    if (!EL_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'ELEVENLABS_API_KEY not set' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const { text, voice_id } = await req.json();
    if (!text?.trim()) {
      return new Response(JSON.stringify({ ok: false, error: 'text is required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const voiceId = voice_id || EL_VOICE;

    // Call ElevenLabs TTS — streaming endpoint for low latency
    const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': EL_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5', // fastest model — lowest latency
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.2,
          use_speaker_boost: true,
        },
        output_format: 'mp3_44100_128',
      }),
    });

    if (!elRes.ok) {
      const err = await elRes.text().catch(() => '');
      console.error('[voice-speak] ElevenLabs error:', elRes.status, err.slice(0, 200));
      return new Response(JSON.stringify({ ok: false, error: `ElevenLabs ${elRes.status}: ${err.slice(0,100)}` }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Stream audio directly back to browser
    return new Response(elRes.body, {
      headers: {
        ...CORS,
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (err) {
    console.error('[voice-speak] error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
