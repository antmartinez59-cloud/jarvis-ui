// JARVIS — Synthesize Edge Function
// Runs nightly at 12:05am CT via pg_cron
// Reads recent sessions + learnings → builds full life profile synthesis → saves to profile_history

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const anthropicKey = Deno.env.get('ANTHROPIC_KEY') || '';

    if (!anthropicKey) return new Response(
      JSON.stringify({ ok: false, error: 'ANTHROPIC_KEY not set' }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );

    const supa = createClient(supabaseUrl, supabaseKey);

    // Load recent data
    const [sessRes, learnRes, profileRes] = await Promise.all([
      supa.from('sessions').select('question,response,created_at').order('created_at', { ascending: false }).limit(30),
      supa.from('learnings').select('summary,projects,priorities,created_at').order('created_at', { ascending: false }).limit(50),
      supa.from('profile').select('*').eq('id', 1).single(),
    ]);

    const sessions = sessRes.data || [];
    const learnings = learnRes.data || [];
    const profile = profileRes.data || {};

    const sessionSummary = sessions.slice(0, 10).map((s: any) =>
      `Q: ${(s.question || '').slice(0, 100)}\nA: ${(s.response || '').slice(0, 200)}`
    ).join('\n\n');

    const learningSummary = learnings.slice(0, 15).map((l: any) =>
      `• ${l.summary || ''}${l.projects?.length ? ` [${l.projects.join(', ')}]` : ''}`
    ).join('\n');

    const prompt = `You are synthesizing a personal AI profile for Tony based on recent conversations and learnings.

RECENT SESSIONS:
${sessionSummary}

RECENT LEARNINGS:
${learningSummary}

CURRENT PROFILE SNAPSHOT:
Traits: ${(profile.traits || []).join(', ')}
Priorities: ${(profile.priorities || []).join(', ')}
Projects: ${(profile.projects || []).join(', ')}

Create a comprehensive synthesis. Return ONLY valid JSON:
{
  "synthesis_summary": "2-3 sentence narrative of who Tony is and what drives him right now",
  "traits": ["trait1", "trait2", "trait3"],
  "priorities": ["priority1", "priority2", "priority3"],
  "projects": ["project1", "project2"],
  "preferences": ["preference1", "preference2"],
  "patterns": ["pattern1", "pattern2"],
  "growth_areas": ["area1", "area2"],
  "momentum": "one sentence on current momentum/trajectory"
}
Max 5 items per array. Be specific and evidence-based.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    const raw = data?.content?.[0]?.text || '';
    const clean = raw.replace(/```json?/g, '').replace(/```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    const synthesis = JSON.parse(match ? match[0] : clean);
    synthesis.created_at = new Date().toISOString();

    // Save to profile_history
    await supa.from('profile_history').insert({ ...synthesis, user_id: 1 });

    // Update live profile
    await supa.from('profile').upsert({
      id: 1,
      ...synthesis,
      updated_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ ok: true, synthesis }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
