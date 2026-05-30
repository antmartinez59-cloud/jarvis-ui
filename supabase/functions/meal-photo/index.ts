// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — meal-photo Edge Function                       ║
// ║                                                          ║
// ║  Tony snaps a photo of his meal. Claude Vision looks     ║
// ║  at it and estimates name, calories, and macros.         ║
// ║  Tony reviews, adjusts if needed, then saves.            ║
// ║                                                          ║
// ║  POST body:                                              ║
// ║    { image_base64: "...", media_type: "image/jpeg" }     ║
// ║                                                          ║
// ║  Returns:                                                ║
// ║    { name, calories, protein_g, carbs_g, fat_g,         ║
// ║      confidence, notes }                                 ║
// ╚══════════════════════════════════════════════════════════╝

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_KEY')!;

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
    const { image_base64, media_type = 'image/jpeg' } = body;

    if (!image_base64) {
      return new Response(JSON.stringify({ ok: false, error: 'image_base64 required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type,
                  data: image_base64,
                },
              },
              {
                type: 'text',
                text: `Analyze this meal photo and estimate the nutritional content.\n\nRespond with ONLY valid JSON — no explanation, no markdown, just the JSON object:\n\n{\n  "name": "descriptive meal name",\n  "calories": number,\n  "protein_g": number,\n  "carbs_g": number,\n  "fat_g": number,\n  "confidence": "high|medium|low",\n  "notes": "brief note about what you see or any assumptions made"\n}\n\nBe realistic with estimates. If you can't identify the food clearly, set confidence to "low".\nRound all numbers to nearest whole number.`,
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude error: ${err}`);
    }

    const data = await res.json();
    const text = data.content[0].text.trim();

    let estimate;
    try {
      const jsonStr = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      estimate = JSON.parse(jsonStr);
    } catch {
      throw new Error(`Failed to parse Claude response: ${text}`);
    }

    return new Response(JSON.stringify({ ok: true, ...estimate }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    console.error('[meal-photo] Error:', err);
    // Log to jarvis_errors
    try {
      const _db = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      await _db.from('jarvis_errors').insert({
        source:     'edge:meal-photo',
        error_type: 'edge_fn',
        message:    String(err),
        resolved:   false,
      });
    } catch(_e) {}
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
