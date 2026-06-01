// JARVIS — Reflect Edge Function
// Extracts structured insights from Council conversations → saved to profile/learnings

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { question, response } = await req.json();
    const apiKey = Deno.env.get('ANTHROPIC_KEY') || '';
    if (!apiKey) return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_KEY not set' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

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
  "date": "${new Date().toISOString().slice(0, 16).replace('T', ' ')}"
}
Max 3 items per array. Only include items clearly evidenced.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    const raw = data?.content?.[0]?.text || '';
    const clean = raw.replace(/```json?/g, '').replace(/```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    const insights = JSON.parse(match ? match[0] : clean);

    return new Response(JSON.stringify({ ok: true, insights }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
