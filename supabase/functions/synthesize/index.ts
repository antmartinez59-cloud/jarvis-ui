// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — synthesize Edge Function                       ║
// ║  Runs: nightly at midnight CT (via pg_cron)              ║
// ║  Pulls from: ALL JARVIS tables — nothing is excluded     ║
// ║  → Claude synthesizes full life profile                  ║
// ║  → Saves version history forever                         ║
// ║  → Twilio SMS if significant new pattern found           ║
// ╚══════════════════════════════════════════════════════════╝

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY       = Deno.env.get('ANTHROPIC_KEY')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_SID           = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_TOKEN         = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_FROM          = Deno.env.get('TWILIO_FROM_NUMBER');
const TWILIO_TO            = Deno.env.get('TWILIO_TO_NUMBER');

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Twilio SMS ───────────────────────────────────────────────
async function sendSMS(body: string) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || !TWILIO_TO) {
    console.log('[synthesize] Twilio not configured — skipping SMS');
    return;
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: TWILIO_TO, From: TWILIO_FROM, Body: body }),
  });
  if (!res.ok) console.error('[synthesize] Twilio error:', await res.text());
  else console.log('[synthesize] SMS sent');
}

// ── Claude call (Haiku — cheap for nightly synthesis) ────────
async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

// ── Load ALL data from across JARVIS ─────────────────────────
async function loadAllContext() {
  const today     = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000).toISOString();
  const sevenDaysAgo  = new Date(today.getTime() - 7  * 86400000).toISOString();

  const [
    profile,
    learnings,
    sessions,
    lastHistory,
    // Health
    waterLogs,
    sleepLogs,
    bodyStats,
    workouts,
    meals,
    // Productivity
    todos,
    completedTodos,
    // Finance
    transactions,
    subscriptions,
    shifts,
    savingGoals,
    // Stocks
    portfolio,
  ] = await Promise.all([
    db.from('profile').select('*').eq('id', 1).single(),
    db.from('learnings').select('summary, question, projects, priorities, created_at').order('created_at', { ascending: false }),
    db.from('sessions').select('question, summary, created_at').order('created_at', { ascending: false }).limit(100),
    db.from('profile_history').select('synthesis_summary, created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),

    // Health — last 30 days
    db.from('water_logs').select('amount_oz, logged_at').gte('logged_at', thirtyDaysAgo),
    db.from('sleep_logs').select('date, duration_hours, quality_rating, bedtime, wake_time').order('date', { ascending: false }).limit(30),
    db.from('body_stats').select('date, weight_lbs, body_fat_pct').order('date', { ascending: false }).limit(10),
    db.from('workouts').select('date, type, duration_mins, muscles_targeted').order('date', { ascending: false }).limit(30),
    db.from('meals').select('date, meal_type, name, calories, protein, carbs, fat').order('date', { ascending: false }).limit(30),

    // Todos — active + recently completed
    db.from('todos').select('title, priority, is_starred, status, due_date, created_at').eq('status', 'active').order('created_at', { ascending: false }),
    db.from('todos').select('title, priority, created_at').eq('status', 'completed').gte('created_at', sevenDaysAgo),

    // Finance — last 30 days
    db.from('transactions').select('date, amount, category_id, description, type').gte('date', thirtyDaysAgo.slice(0,10)).order('date', { ascending: false }),
    db.from('subscriptions').select('name, amount, billing_cycle, is_active').eq('is_active', true),
    db.from('shifts').select('date, duration_hours, calculated_pay').order('date', { ascending: false }).limit(20).catch(() => ({ data: [] })),
    db.from('saving_goals').select('name, target_amount, current_amount, deadline'),
    db.from('portfolio').select('ticker, shares, avg_buy_price').limit(20),
  ]);

  return {
    profile:       profile.data,
    learnings:     learnings.data || [],
    sessions:      sessions.data || [],
    lastHistory:   lastHistory.data || null,
    health: {
      water:     waterLogs.data || [],
      sleep:     sleepLogs.data || [],
      bodyStats: bodyStats.data || [],
      workouts:  workouts.data || [],
      meals:     meals.data || [],
    },
    productivity: {
      activeTodos:    todos.data || [],
      completedTodos: completedTodos.data || [],
    },
    finance: {
      transactions:  transactions.data || [],
      subscriptions: subscriptions.data || [],
      savingGoals:   savingGoals.data || [],
      portfolio:     portfolio.data || [],
    },
  };
}

// ── Build health summary string ───────────────────────────────
function buildHealthSummary(health: any): string {
  const { water, sleep, bodyStats, workouts, meals } = health;

  const parts: string[] = [];

  // Water — avg oz/day over 30 days
  if (water.length > 0) {
    const days = new Set(water.map((w: any) => w.logged_at?.slice(0, 10))).size || 1;
    const totalOz = water.reduce((s: number, w: any) => s + (w.amount_oz || 0), 0);
    parts.push(`Water: avg ${Math.round(totalOz / days)}oz/day over ${days} days logged (goal: 80oz)`);
  }

  // Sleep
  if (sleep.length > 0) {
    const avgSleep = sleep.reduce((s: number, l: any) => s + (l.duration_hours || 0), 0) / sleep.length;
    const avgQuality = sleep.reduce((s: number, l: any) => s + (l.quality_rating || 0), 0) / sleep.length;
    parts.push(`Sleep: avg ${avgSleep.toFixed(1)} hrs/night, quality ${avgQuality.toFixed(1)}/5 (last ${sleep.length} nights logged)`);
  }

  // Body stats
  if (bodyStats.length > 0) {
    const latest = bodyStats[0];
    const oldest = bodyStats[bodyStats.length - 1];
    const change = latest.weight_lbs && oldest.weight_lbs ? latest.weight_lbs - oldest.weight_lbs : 0;
    parts.push(`Weight: ${latest.weight_lbs} lbs (${change >= 0 ? '+' : ''}${change.toFixed(1)} lbs trend, goal: 150 lbs)`);
  }

  // Workouts
  if (workouts.length > 0) {
    const weeks = Math.ceil(workouts.length / 4);
    const perWeek = (workouts.length / Math.max(weeks, 1)).toFixed(1);
    const types = [...new Set(workouts.map((w: any) => w.type).filter(Boolean))].join(', ');
    parts.push(`Workouts: avg ${perWeek}x/week (goal: 4-5x), types: ${types || 'various'}`);
  }

  return parts.length > 0 ? parts.join('\n') : 'No health data logged yet.';
}

// ── Build finance summary string ─────────────────────────────
function buildFinanceSummary(finance: any): string {
  const { transactions, subscriptions, savingGoals } = finance;

  const parts: string[] = [];

  if (transactions.length > 0) {
    const income   = transactions.filter((t: any) => t.type === 'income').reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);
    const expenses = transactions.filter((t: any) => t.type === 'expense').reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);
    parts.push(`Last 30 days: $${income.toFixed(0)} income, $${expenses.toFixed(0)} expenses (${transactions.length} transactions)`);
  }

  if (subscriptions.length > 0) {
    const monthlyTotal = subscriptions
      .filter((s: any) => s.billing_cycle === 'monthly')
      .reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
    parts.push(`Active subscriptions: ${subscriptions.length} total, ~$${monthlyTotal.toFixed(0)}/month`);
  }

  if (savingGoals.length > 0) {
    const goalSummary = savingGoals.map((g: any) => {
      const pct = g.target_amount > 0 ? Math.round((g.current_amount / g.target_amount) * 100) : 0;
      return `${g.name} (${pct}% of $${g.target_amount})`;
    }).join(', ');
    parts.push(`Saving goals: ${goalSummary}`);
  }

  return parts.length > 0 ? parts.join('\n') : 'No finance data logged yet.';
}

// ── Main handler ─────────────────────────────────────────────
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
    console.log('[synthesize] Starting nightly synthesis — pulling all JARVIS data...');

    // Load everything
    const ctx = await loadAllContext();
    const { profile, learnings, sessions, lastHistory, health, productivity, finance } = ctx;

    const healthSummary  = buildHealthSummary(health);
    const financeSummary = buildFinanceSummary(finance);

    const learningSummaries = learnings
      .map((l: any, i: number) => `[${i+1}] ${l.created_at?.slice(0,10)}: ${l.summary}`)
      .join('\n');

    const sessionSummaries = sessions.slice(0, 50)
      .map((s: any) => `Q: ${s.question || ''} | A: ${s.summary || ''}`)
      .join('\n');

    const todoSummary = productivity.activeTodos.length > 0
      ? productivity.activeTodos.map((t: any) =>
          `[${t.priority?.toUpperCase()}${t.is_starred ? ' ⭐' : ''}] ${t.title}`
        ).join('\n')
      : 'No active todos.';

    const completedSummary = productivity.completedTodos.length > 0
      ? `Completed this week: ${productivity.completedTodos.map((t: any) => t.title).join(', ')}`
      : 'No completions logged this week.';

    const portfolioSummary = finance.portfolio.length > 0
      ? `Portfolio: ${finance.portfolio.map((p: any) => `${p.ticker} (${p.shares} shares)`).join(', ')}`
      : 'No portfolio logged yet.';

    const previousSynthesis = lastHistory?.synthesis_summary
      ? `\n\nPREVIOUS SYNTHESIS (${lastHistory.created_at?.slice(0,10)}):\n${lastHistory.synthesis_summary}`
      : '';

    const currentProfile = JSON.stringify({
      name:        profile.name,
      traits:      profile.traits,
      priorities:  profile.priorities,
      projects:    profile.projects,
      preferences: profile.preferences,
      patterns:    profile.patterns,
    }, null, 2);

    // ── Call Claude ───────────────────────────────────────────
    const systemPrompt = `You are JARVIS's memory synthesis engine. Your job is to build the richest possible life profile of Tony Martinez by analyzing EVERYTHING he does inside JARVIS — conversations, health, fitness, finances, todos, sleep, workouts, what he eats, how he spends money, what goals he's working toward.

Tony (Prosper TX, Dallas area) is building JARVIS to be his personal AI that knows him deeply. He's currently bulking from 120-135 lbs toward 150 lbs, works out 4x/week, tracks water intake (80oz/day goal), and is focused on financial discipline and personal growth.

Focus your synthesis on:
- How Tony thinks and makes decisions (patterns from conversations)
- What he's actually doing vs. what he says he wants (behavior vs. intentions)
- His health trajectory (is he improving, stalling, or regressing?)
- His financial patterns (spending habits, goal progress, discipline)
- His productivity patterns (what gets done vs. what gets pushed)
- What motivates and drains him
- Time-of-day patterns, consistency, and habits

Output JSON with these exact fields:
{
  "traits": ["personality traits, thinking styles, behavioral tendencies"],
  "priorities": ["current top life and work priorities, ordered"],
  "projects": ["active projects with status"],
  "preferences": ["how Tony wants JARVIS to behave and respond"],
  "patterns": ["specific behavioral patterns across health, finance, productivity, conversations"],
  "synthesis_summary": "3-4 paragraph narrative — write like JARVIS deeply knows Tony. Be specific about what you observed. Reference real data points.",
  "significant_insight": "ONE sentence — the most important new pattern or insight discovered tonight, OR null if nothing meaningfully new"
}

Be specific and data-driven. If his water intake is consistently below goal, say so. If his sleep quality correlates with workout days, note it. Generic platitudes are useless — JARVIS needs real patterns.`;

    const userMessage = `CURRENT PROFILE:\n${currentProfile}
${previousSynthesis}

═══ CONVERSATIONS & LEARNINGS ═══
${learnings.length} total learnings stored.
Recent learnings:\n${learningSummaries.slice(0, 3000) || 'None yet.'}

Recent sessions:\n${sessionSummaries.slice(0, 2000) || 'None yet.'}

═══ HEALTH & FITNESS (last 30 days) ═══
${healthSummary}

═══ PRODUCTIVITY ═══
Active todos (${productivity.activeTodos.length}):\n${todoSummary}
${completedSummary}

═══ FINANCE (last 30 days) ═══
${financeSummary}
${portfolioSummary}

Synthesize everything above into an updated profile. Look for cross-domain patterns — does he log water on workout days but not rest days? Does he complete more todos when he sleeps better? These cross-table insights are the most valuable thing you can surface.`;

    console.log('[synthesize] Calling Claude with full context...');
    const rawResponse = await callClaude(systemPrompt, userMessage);

    // Parse response
    let synthesized: any;
    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      synthesized = JSON.parse(jsonMatch ? jsonMatch[0] : rawResponse);
    } catch {
      console.error('[synthesize] Parse failed:', rawResponse.slice(0, 500));
      throw new Error('Claude returned non-JSON response');
    }

    const {
      traits       = [],
      priorities   = [],
      projects     = [],
      preferences  = [],
      patterns     = [],
      synthesis_summary    = '',
      significant_insight  = null,
    } = synthesized;

    // Archive current profile → history
    await db.from('profile_history').insert({
      traits, priorities, projects, preferences, patterns,
      synthesis_summary,
      significant_insight: significant_insight || null,
      notified:            false,
      learnings_count:     learnings.length,
    });

    // Update live profile
    await db.from('profile').update({
      traits, priorities, projects, preferences, patterns,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);

    console.log('[synthesize] Profile updated.');

    // SMS notification
    let smsText = '';
    if (significant_insight && significant_insight !== 'null') {
      smsText = `🧠 JARVIS Insight: ${significant_insight}`;
      await sendSMS(smsText);
      await db.from('notifications').insert({
        type: 'synthesis_insight', title: 'New Pattern Detected',
        body: significant_insight, channel: 'sms', sent: true,
      });
    } else {
      await sendSMS(`✅ JARVIS synthesis complete. ${learnings.length} learnings processed. Profile updated. No major new patterns tonight.`);
    }

    // Store briefing card for Memory tab
    await db.from('briefings').insert({
      type:    'synthesis',
      content: synthesis_summary,
      sent_at: new Date().toISOString(),
      metadata: {
        learnings_count:    learnings.length,
        health_data_points: health.water.length + health.sleep.length + health.workouts.length,
        finance_data_points: finance.transactions.length,
        todo_count:         productivity.activeTodos.length,
        significant_insight: significant_insight || null,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      learnings_processed:     learnings.length,
      health_data_points:      health.water.length + health.sleep.length + health.workouts.length,
      finance_data_points:     finance.transactions.length,
      significant_insight:     significant_insight || null,
      profile_updated:         true,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[synthesize] Fatal error:', err);
    try {
      await db.from('jarvis_errors').insert({ source: 'edge:synthesize', error_type: 'edge_fn', message: String(err), resolved: false });
    } catch(_) {}
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
