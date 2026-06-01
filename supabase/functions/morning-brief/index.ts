// JARVIS — Morning Brief Edge Function
// Runs every 15 min via pg_cron. Checks CT time. Fires at:
//   7:00am  → morning (weather, news, priorities, calendar)
//  12:00pm  → midday (news update, water check)
//   4:00pm  → afternoon (todos, finance summary)
//   9:00pm  → evening (health recap, reflection prompt)
//  11:45pm  → pre-synthesis (gratitude, journal prompt)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BRIEFING_TIMES: Record<string, { hour: number; minute: number; window: number }> = {
  morning:       { hour: 7,  minute: 0,  window: 7 },
  midday:        { hour: 12, minute: 0,  window: 7 },
  afternoon:     { hour: 16, minute: 0,  window: 7 },
  evening:       { hour: 21, minute: 0,  window: 7 },
  presynthesis:  { hour: 23, minute: 45, window: 7 },
};

function getCTHourMinute(): { hour: number; minute: number } {
  const now = new Date();
  const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return { hour: ct.getHours(), minute: ct.getMinutes() };
}

function getBriefingType(force?: string): string | null {
  if (force) return force;
  const { hour, minute } = getCTHourMinute();
  for (const [type, cfg] of Object.entries(BRIEFING_TIMES)) {
    const diff = Math.abs((hour * 60 + minute) - (cfg.hour * 60 + cfg.minute));
    if (diff <= cfg.window) return type;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const briefingType = getBriefingType(body.type);

    if (!briefingType) return new Response(
      JSON.stringify({ ok: true, skipped: true, message: 'Not a briefing time' }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const anthropicKey = Deno.env.get('ANTHROPIC_KEY') || '';
    const resendKey = Deno.env.get('RESEND_API_KEY') || '';

    if (!anthropicKey) return new Response(
      JSON.stringify({ ok: false, error: 'ANTHROPIC_KEY not set' }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );

    const supa = createClient(supabaseUrl, supabaseKey);

    // Duplicate guard — don't send same briefing twice in one day
    if (!body.force) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: existing } = await supa
        .from('briefings')
        .select('id')
        .eq('briefing_type', briefingType)
        .gte('created_at', `${today}T00:00:00`)
        .limit(1);
      if (existing?.length) return new Response(
        JSON.stringify({ ok: true, skipped: true, message: `${briefingType} already sent today` }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // Gather context based on briefing type
    const ctTime = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' });
    const today = new Date().toISOString().slice(0, 10);

    // Load relevant data
    const [profileRes, todosRes, learningsRes] = await Promise.all([
      supa.from('profile').select('*').eq('id', 1).single(),
      supa.from('todos').select('title,priority').eq('status', 'active').order('priority').limit(5),
      supa.from('learnings').select('summary').order('created_at', { ascending: false }).limit(3),
    ]);

    const profile = profileRes.data || {};
    const todos = (todosRes.data || []).map((t: any) => `• [${t.priority}] ${t.title}`).join('\n');
    const learnings = (learningsRes.data || []).map((l: any) => `• ${l.summary}`).join('\n');

    const prompts: Record<string, string> = {
      morning: `Create a motivating morning briefing for Tony in Prosper, TX at ${ctTime}.
Projects: ${(profile.projects || []).join(', ')}
Priorities: ${(profile.priorities || []).join(', ')}
Active todos: ${todos || 'None'}
Recent learnings: ${learnings || 'None'}

Write an energizing 3-4 sentence briefing that:
1. Acknowledges the day ahead
2. References 1-2 of his actual priorities/projects
3. Sets a focused intention for the day
4. Feels personal, not generic

Keep it concise and motivating. No weather (that's separate). Return plain text only.`,

      midday: `Create a quick midday check-in for Tony at ${ctTime}.
Active todos: ${todos || 'None'}
Write 2-3 sentences: acknowledge midday, check in on energy/focus, one actionable reminder.`,

      afternoon: `Create an afternoon update for Tony at ${ctTime}.
Active todos: ${todos || 'None'}
Write 2-3 sentences: afternoon energy, wrap-up mode, one priority to finish before end of day.`,

      evening: `Create an evening wind-down message for Tony at ${ctTime}.
Write 2-3 sentences: acknowledge the day's work, encourage rest/reflection, one positive note.`,

      presynthesis: `Create a pre-sleep reflection prompt for Tony at ${ctTime}.
Write 2-3 sentences encouraging reflection on the day, gratitude, and setting intention for tomorrow.`,
    };

    // Generate briefing content
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompts[briefingType] || prompts.morning }],
      }),
    });

    const aiData = await aiRes.json();
    const content = aiData?.content?.[0]?.text || `Good ${briefingType}, Tony.`;
    const headline = content.split('.')[0].slice(0, 80);

    // Save to briefings table
    const { data: briefing } = await supa.from('briefings').insert({
      briefing_type: briefingType,
      headline,
      preview: content.slice(0, 200),
      content,
      created_at: new Date().toISOString(),
    }).select().single();

    // Send email if Resend key is set
    let emailSent = false;
    if (resendKey) {
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'JARVIS <onboarding@resend.dev>',
            to: ['antmartinez59@gmail.com'],
            subject: `JARVIS ${briefingType.charAt(0).toUpperCase() + briefingType.slice(1)} Brief — ${ctTime} CT`,
            text: content,
          }),
        });
        emailSent = emailRes.ok;
      } catch (e) { console.warn('Email failed:', e.message); }
    }

    return new Response(JSON.stringify({
      ok: true,
      briefing_type: briefingType,
      headline,
      email_sent: emailSent,
      briefing_id: briefing?.id,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
