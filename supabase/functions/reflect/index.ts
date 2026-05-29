// JARVIS Edge Function — reflect
// Extracts structured insights from a Council conversation using Claude Haiku.
// Anthropic key lives in Supabase Vault, never in the browser.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_KEY')
    if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_KEY not set in Supabase Vault')

    const { question, response } = await req.json()
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ')

    const prompt = `Extract structured insights from this AI conversation.

QUESTION: ${(question || '').slice(0, 600)}
RESPONSE: ${(response || '').slice(0, 2500)}

Return ONLY valid JSON (no markdown fences):
{
  "summary": "one-sentence learning",
  "traits": ["personality or work trait revealed"],
  "priorities": ["what matters to this person"],
  "projects": ["project or topic mentioned"],
  "preferences": ["style or approach they prefer"],
  "patterns": ["behavioral pattern observed"],
  "date": "${now}"
}
Max 3 items per array. Only include items clearly evidenced.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await res.json()
    const raw = data.content?.[0]?.text || '{}'
    const clean = raw.replace(/```json?/g, '').replace(/```/g, '').trim()
    const m = clean.match(/\{[\s\S]*\}/)
    const insights = JSON.parse(m ? m[0] : clean)

    return new Response(
      JSON.stringify({ ok: true, insights }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e.message }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
