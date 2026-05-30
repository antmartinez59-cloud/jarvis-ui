// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — morning-brief Edge Function                    ║
// ║  Handles all 5 daily briefings:                          ║
// ║  morning (7am CT), midday (noon CT), afternoon (4pm CT)  ║
// ║  evening (9pm CT), presynthesis (11:45pm CT)             ║
// ║  Delivers: Resend email + Twilio SMS                     ║
// ║                                                          ║
// ║  DST HANDLING: Fully automatic.                          ║
// ║  pg_cron calls every 15 min. This function reads         ║
// ║  America/Chicago time directly — CDT/CST switches        ║
// ║  happen automatically, like a phone. No manual changes.  ║
// ╚══════════════════════════════════════════════════════════╝

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY       = Deno.env.get('ANTHROPIC_KEY')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY       = Deno.env.get('RESEND_API_KEY');
const TWILIO_SID           = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_TOKEN         = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_FROM          = Deno.env.get('TWILIO_FROM_NUMBER');
const TWILIO_TO            = Deno.env.get('TWILIO_TO_NUMBER');

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TONY_EMAIL = Deno.env.get('NOTIFY_EMAIL') || 'antmartinez59@gmail.com';
const SUPABASE_FUNCTIONS_URL = SUPABASE_URL.replace('.supabase.co', '.supabase.co/functions/v1');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ══════════════════════════════════════════════════════════════
// AUTOMATIC DST HANDLING
// America/Chicago covers both CDT (UTC-5) and CST (UTC-6).
// JavaScript's Intl resolves it correctly — same as your phone.
// pg_cron runs every 15 min; this function checks the real CT
// time and fires only when it's a briefing window.
// ══════════════════════════════════════════════════════════════

// Briefing schedule in CT (24h). Window = ±7 min.
const BRIEFING_SCHEDULE = [
  { hour: 7,  minute: 0,  type: 'morning'      },
  { hour: 12, minute: 0,  type: 'midday'        },
  { hour: 16, minute: 0,  type: 'afternoon'     },
  { hour: 21, minute: 0,  type: 'evening'       },
  { hour: 23, minute: 45, type: 'presynthesis'  },
];
const WINDOW_MINUTES = 7; // fire within ±7 min of scheduled CT time

// Get current Central Time hour + minute (handles CDT/CST automatically)
function getCentralTime(): { hour: number; minute: number; dateStr: string } {
  const now    = new Date();
  const ct     = new Intl.DateTimeFormat('en-US', {
    timeZone:  'America/Chicago',
    hour:      'numeric',
    minute:    'numeric',
    hour12:    false,
    year:      'numeric',
    month:     '2-digit',
    day:       '2-digit',
  }).formatToParts(now);

  const get = (type: string) => ct.find(p => p.type === type)?.value || '0';
  return {
    hour:    parseInt(get('hour'),   10),
    minute:  parseInt(get('minute'), 10),
    dateStr: `${get('year')}-${get('month')}-${get('day')}`, // YYYY-MM-DD in CT
  };
}

// Check if we're inside a briefing window
function getScheduledBriefingType(): string | null {
  const { hour, minute } = getCentralTime();
  const nowMins = hour * 60 + minute;

  for (const s of BRIEFING_SCHEDULE) {
    const scheduledMins = s.hour * 60 + s.minute;
    if (Math.abs(nowMins - scheduledMins) <= WINDOW_MINUTES) {
      return s.type;
    }
  }
  return null; // Not a briefing window — pg_cron called but nothing to do
}

// Duplicate guard: has this briefing type already been sent today (CT date)?
async function alreadySentToday(type: string, ctDateStr: string): Promise<boolean> {
  // Determine the UTC timestamp for midnight CT on ctDateStr.
  // We get today's CT date string from getCentralTime(), so we know ctDateStr is correct.
  // To find midnight CT in UTC, we step backwards from noon UTC on that date until
  // the CT date matches — this correctly handles CDT (UTC-5) and CST (UTC-6).
  const noonUTC = new Date(`${ctDateStr}T12:00:00Z`);
  const ctFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  // Find UTC offset by comparing formatted CT date vs the ctDateStr
  // America/Chicago is either UTC-5 (CDT) or UTC-6 (CST) — try both
  let startOfDayCT: string;
  const cdtMidnight = new Date(`${ctDateStr}T05:00:00Z`); // midnight CT if CDT (UTC-5)
  const cstMidnight = new Date(`${ctDateStr}T06:00:00Z`); // midnight CT if CST (UTC-6)
  // Verify which offset is correct by checking the formatted date
  const cdtFormatted = ctFormatter.format(cdtMidnight);
  const [cdtMonth, cdtDay, cdtYear] = cdtFormatted.split('/');
  const cdtDateStr = `${cdtYear}-${cdtMonth}-${cdtDay}`;
  startOfDayCT = cdtDateStr === ctDateStr
    ? cdtMidnight.toISOString()
    : cstMidnight.toISOString();

  const { data } = await db
    .from('briefings')
    .select('id')
    .eq('type', type)
    .gte('sent_at', startOfDayCT)
    .limit(1)
    .maybeSingle();
  return !!data;
}

// ── Claude call ──────────────────────────────────────────────
async function callClaude(system: string, user: string, maxTokens = 1500): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude error: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

// ── Resend email ─────────────────────────────────────────────
async function sendEmail(subject: string, htmlBody: string) {
  if (!RESEND_API_KEY) {
    console.log('[brief] RESEND_API_KEY not set — skipping email');
    return { ok: false, reason: 'no key' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'JARVIS <onboarding@resend.dev>',
      to:      [TONY_EMAIL],
      subject,
      html:    htmlBody,
    }),
  });
  if (!res.ok) console.error('[brief] Resend error:', await res.text());
  return { ok: res.ok };
}

// ── Twilio SMS ───────────────────────────────────────────────
async function sendSMS(body: string) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || !TWILIO_TO) {
    console.log('[brief] Twilio not configured — skipping SMS');
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
  if (!res.ok) console.error('[brief] Twilio SMS error:', await res.text());
}

// ── Fetch weather from our weather function ──────────────────
async function getWeather(): Promise<any> {
  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/weather`, {
      headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
    });
    const data = await res.json();
    return data.ok ? data.weather : null;
  } catch { return null; }
}

// ── Fetch news from our news function ────────────────────────
async function getNewsData(sections: string[]): Promise<any> {
  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/news`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sections }),
    });
    return res.json();
  } catch { return null; }
}

// ── Load Tony's data from DB ──────────────────────────────────
async function loadContext() {
  const [profile, todos, water, sleep, reminders, latestSynthesis] = await Promise.all([
    db.from('profile').select('*').eq('id', 1).single(),
    db.from('todos').select('title, priority, is_starred, due_date').eq('status', 'active').order('is_starred', { ascending: false }).limit(10),
    // Today's water total
    db.from('water_logs').select('amount_oz').gte('logged_at', new Date(new Date().setHours(0,0,0,0)).toISOString()),
    // Last night's sleep
    db.from('sleep_logs').select('*').order('date', { ascending: false }).limit(1).maybeSingle(),
    // Today's reminders
    db.from('reminders').select('title, datetime').gte('datetime', new Date().toISOString()).order('datetime').limit(5),
    // Most recent synthesis summary
    db.from('profile_history').select('synthesis_summary, significant_insight').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  // Water total for today
  const waterTotal = (water.data || []).reduce((sum: number, row: any) => sum + (row.amount_oz || 0), 0);

  return {
    profile:    profile.data,
    todos:      todos.data || [],
    waterTotal,
    sleep:      sleep.data || null,
    reminders:  reminders.data || [],
    synthesis:  latestSynthesis.data || null,
  };
}

// ══════════════════════════════════════════════════════════════
// BRIEFING BUILDERS — one per type
// ══════════════════════════════════════════════════════════════

// ── 1. MORNING (7am CT) ──────────────────────────────────────
async function buildMorning(ctx: any, weather: any, news: any): Promise<{ subject: string; html: string; sms: string }> {
  const { profile, todos, waterTotal, sleep, reminders, synthesis } = ctx;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' });

  const topTodos = todos.slice(0, 5).map((t: any) =>
    `${t.is_starred ? '⭐' : '•'} [${t.priority?.toUpperCase()}] ${t.title}${t.due_date ? ' (due ' + t.due_date + ')' : ''}`
  ).join('\n');

  const weatherSummary = weather?.summary || 'Weather unavailable.';
  const newsHeadlines  = (news?.headlines || []).slice(0, 3).map((n: any) => `• ${n.title}`).join('\n');
  const financeNews    = (news?.finance || []).slice(0, 2).map((n: any) => `• ${n.title}`).join('\n');
  const sleepNote      = sleep ? `Last night: ${sleep.duration_hours?.toFixed(1)} hrs (quality: ${sleep.quality_rating}/5)` : 'No sleep logged.';

  const prompt = `You are JARVIS — Tony's personal AI. Write a personalized morning briefing for ${today}.

Tony's profile summary: ${synthesis?.synthesis_summary || profile?.traits?.join(', ') || 'Tony Martinez, Prosper TX, building JARVIS'}

Weather: ${weatherSummary}

Top priorities today:
${topTodos || 'No active todos.'}

Sleep last night: ${sleepNote}
Water logged today so far: ${waterTotal}oz / 80oz goal

Top headlines:
${newsHeadlines || 'No headlines available.'}

Finance/market news:
${financeNews || 'No market news available.'}

Random fact for today: ${news?.random_fact || 'Did you know: the sun is about 93 million miles away.'}
Wordle: ${news?.wordle_link || 'https://www.nytimes.com/games/wordle/index.html'}

Write a warm, personal, energizing morning message. Lead with a greeting and what kind of day it is weather-wise. Then: top priorities, any health check-in, headlines, the random fact, and the Wordle link. Keep it scannable. Max 400 words. Write in HTML using <p>, <ul>, <li>, <strong>, <a> tags. No markdown.`;

  const briefContent = await callClaude(
    'You are JARVIS, Tony\'s personal AI assistant. You know Tony deeply and write briefings that feel like they\'re from someone who genuinely knows him — not a generic newsletter.',
    prompt,
    1200
  );

  const remindersHtml = reminders.length > 0
    ? `<p><strong>⏰ Reminders today:</strong></p><ul>${reminders.map((r: any) => `<li>${r.title} — ${new Date(r.datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })}</li>`).join('')}</ul>`
    : '';

  const html = wrapEmail('☀️ Good Morning', `<h2>Good Morning, Tony — ${today}</h2>${briefContent}${remindersHtml}${emailFooter()}`);
  const sms  = `☀️ JARVIS Morning Brief — ${today}\n${weatherSummary}\nTop priority: ${todos[0]?.title || 'No active todos'}\nCheck your email for the full brief.`;

  return { subject: `☀️ JARVIS Morning Brief — ${today}`, html, sms };
}

// ── 2. MIDDAY (noon CT) ──────────────────────────────────────
async function buildMidday(ctx: any, weather: any, news: any): Promise<{ subject: string; html: string; sms: string }> {
  const { waterTotal, todos, reminders } = ctx;
  const waterPct = Math.round((waterTotal / 80) * 100);
  const waterStatus = waterTotal >= 40 ? `✅ On track (${waterTotal}oz / 80oz)` : `⚠️ Behind (${waterTotal}oz / 80oz — drink more!)`;

  const breakingNews = (news?.headlines || []).slice(0, 3).map((n: any) => `• ${n.title}`).join('\n');
  const marketNews   = (news?.finance || []).slice(0, 2).map((n: any) => `• ${n.title}`).join('\n');

  const afternoonReminders = reminders
    .filter((r: any) => new Date(r.datetime).getHours() >= 12)
    .slice(0, 3)
    .map((r: any) => `• ${r.title}`).join('\n');

  const urgentTodos = todos.filter((t: any) => t.priority === 'urgent' || t.priority === 'high').slice(0, 3);

  const content = await callClaude(
    'You are JARVIS. Write a brief, focused midday check-in for Tony. Be energizing but concise — he\'s in the middle of his day.',
    `Midday pulse check for Tony.

Water: ${waterStatus}
Breaking news: ${breakingNews || 'Nothing major.'}
Market update: ${marketNews || 'Markets quiet.'}
Afternoon reminders: ${afternoonReminders || 'None.'}
Urgent/high todos: ${urgentTodos.map((t: any) => t.title).join(', ') || 'All clear.'}

Write a 100-150 word midday pulse in HTML. Quick, punchy, actionable. Water check, quick news, what needs attention this afternoon.`,
    600
  );

  const html = wrapEmail('⚡ Midday Pulse', `<h2>⚡ Midday Pulse</h2>${content}${emailFooter()}`);
  const sms  = `⚡ JARVIS Midday — Water: ${waterTotal}oz/${80}oz (${waterPct}%). ${urgentTodos.length > 0 ? 'Urgent: ' + urgentTodos[0].title : 'You\'re on track.'}`;

  return { subject: '⚡ JARVIS Midday Pulse', html, sms };
}

// ── 3. AFTERNOON (4pm CT) ────────────────────────────────────
async function buildAfternoon(ctx: any, weather: any, news: any): Promise<{ subject: string; html: string; sms: string }> {
  const { todos, waterTotal } = ctx;
  const marketNews = (news?.finance || []).slice(0, 3).map((n: any) => `• ${n.title} (${n.source})`).join('\n');
  const sportsNews = (news?.sports || []).slice(0, 3).map((n: any) => `• ${n.title}`).join('\n');

  const urgentTodos = todos.filter((t: any) => t.priority === 'urgent').slice(0, 3);
  const eveningWeather = weather?.forecast?.[0]
    ? `Tonight: ${weather.forecast[0].low}°F, ${weather.forecast[0].description}. Rain: ${weather.forecast[0].rain_chance}%.`
    : weather?.summary || 'Check the weather app.';

  const content = await callClaude(
    'You are JARVIS. Write Tony\'s afternoon update — end of the workday, transitioning to evening.',
    `Afternoon update for Tony.

Market close news: ${marketNews || 'No market news.'}
Sports: ${sportsNews || 'No sports news.'}
Tonight's weather: ${eveningWeather}
Water today: ${waterTotal}oz (need ${Math.max(0, 80 - waterTotal)}oz more by tonight)
Urgent items still open: ${urgentTodos.map((t: any) => t.title).join(', ') || 'None.'}

Write a 150-200 word afternoon wrap-up in HTML. Cover market close, sports, tonight's weather (activity suggestions), any urgent todos to finish, and a wrap-up nudge. Remind him to drink water if he's behind.`,
    700
  );

  const html = wrapEmail('🌆 Afternoon Update', `<h2>🌆 Afternoon Update</h2>${content}${emailFooter()}`);
  const sms  = `🌆 JARVIS Afternoon — Markets wrapped. ${urgentTodos.length > 0 ? 'Still urgent: ' + urgentTodos[0].title + '.' : 'No urgent items.'} Water: ${waterTotal}oz/80oz.`;

  return { subject: '🌆 JARVIS Afternoon Update', html, sms };
}

// ── 4. EVENING (9pm CT) ─────────────────────────────────────
async function buildEvening(ctx: any): Promise<{ subject: string; html: string; sms: string }> {
  const { profile, todos, waterTotal, sleep } = ctx;

  const completedTodosCount = 0; // Would query completed_at = today in a full impl
  const movedTodosCount     = 0;

  const healthSummary = `Water: ${waterTotal}oz / 80oz goal (${Math.round(waterTotal/80*100)}%). Last sleep: ${sleep ? sleep.duration_hours?.toFixed(1) + ' hrs' : 'not logged yet'}.`;

  const content = await callClaude(
    'You are JARVIS. Write Tony\'s evening wind-down briefing. Be reflective and encouraging — help him close the day well and prep for tomorrow.',
    `Evening wind-down for Tony.

Health summary: ${healthSummary}
Open todos: ${todos.slice(0, 5).map((t: any) => t.title).join(', ') || 'All clear.'}
Profile priorities: ${profile?.priorities?.slice(0, 3).join(', ') || 'Not set yet.'}

Write a 200-250 word evening briefing in HTML. Include:
1. Today's accomplishments (encourage him even if it was a slow day)
2. Health summary (water, reminder to log sleep before bed)
3. What to prepare for tomorrow (top 3 todos)
4. A reflection prompt (one thoughtful question)
5. A gratitude nudge
6. Sleep reminder (aim for 7-8 hrs)

Tone: calm, supportive, grounding.`,
    800
  );

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Chicago' });

  const html = wrapEmail('🌙 Evening Wind-Down', `<h2>🌙 Evening Wind-Down</h2>${content}${emailFooter()}`);
  const sms  = `🌙 JARVIS Evening — ${healthSummary} Top priority tomorrow: ${todos[0]?.title || 'Check JARVIS for tomorrow\'s plan.'}`;

  return { subject: '🌙 JARVIS Evening Wind-Down', html, sms };
}

// ── 5. PRE-SYNTHESIS (11:45pm CT) ───────────────────────────
async function buildPreSynthesis(ctx: any): Promise<{ subject: string; html: string; sms: string }> {
  const { todos, waterTotal, sleep } = ctx;

  const content = await callClaude(
    'You are JARVIS. Write a thoughtful pre-synthesis message — the last message of the day before JARVIS\'s nightly memory processing.',
    `Pre-synthesis brief for Tony (last message of the day — synthesis runs in 15 minutes).

Water today: ${waterTotal}oz / 80oz
Todos still open: ${todos.slice(0, 3).map((t: any) => t.title).join(', ') || 'None.'}

Write a 150-200 word end-of-day message in HTML. Include:
1. A short day summary (1-2 sentences)
2. A journal prompt — one specific, meaningful question about today
3. A gratitude prompt — "what's one thing from today you're grateful for?"
4. A mental reset note — something that puts tomorrow in perspective
5. Note that JARVIS will process everything in 15 minutes during the nightly synthesis

Tone: quiet, introspective, peaceful. This is the wind-down before sleep.`,
    600
  );

  const html = wrapEmail('🌌 Night Reflection', `<h2>🌌 Night Reflection — Synthesis in 15 min</h2>${content}${emailFooter()}`);
  const sms  = `🌌 JARVIS — Synthesis starts in 15 min. ${waterTotal >= 80 ? '💧 Hit your water goal today!' : `💧 ${waterTotal}oz water today.`} Sleep well, Tony.`;

  return { subject: '🌌 JARVIS Night Reflection', html, sms };
}

// ══════════════════════════════════════════════════════════════
// EMAIL HTML WRAPPER
// ══════════════════════════════════════════════════════════════
function wrapEmail(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f11; color: #e8e8e8; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 0 auto; padding: 24px 16px; }
  .header { border-bottom: 1px solid #2a2a2e; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { color: #7c6af7; font-size: 18px; margin: 0; letter-spacing: 2px; }
  h2 { color: #a89cf7; font-size: 20px; margin-top: 0; }
  p { color: #c8c8d4; line-height: 1.6; }
  ul { color: #c8c8d4; }
  li { margin-bottom: 6px; }
  strong { color: #e8e8f0; }
  a { color: #7c6af7; }
  .footer { border-top: 1px solid #2a2a2e; padding-top: 16px; margin-top: 32px; font-size: 12px; color: #666; }
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>⬡ JARVIS</h1></div>
  ${body}
</div>
</body>
</html>`;
}

function emailFooter(): string {
  return `<div class="footer">
    <p>JARVIS — Your personal AI | <a href="https://project-jdhk7.vercel.app">Open JARVIS</a></p>
    <p>Prosper, TX • ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════
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
    const { hour, minute, dateStr } = getCentralTime();
    const ctTimeStr = `${hour}:${String(minute).padStart(2,'0')} CT`;

    // ── Determine briefing type ───────────────────────────────
    // Manual override (for testing): POST { "type": "morning" }
    // Automatic (pg_cron every 15 min): self-determines from real CT time
    let briefingType: string | null = null;
    let forced = false;

    try {
      const body = await req.json();
      if (body?.type) {
        briefingType = body.type;
        forced = true;
      }
    } catch { /* no body — automatic mode */ }

    if (!forced) {
      briefingType = getScheduledBriefingType();
      if (!briefingType) {
        // Not a briefing window — exit silently (pg_cron fires every 15 min)
        console.log(`[brief] ${ctTimeStr} — not a briefing window, skipping.`);
        return new Response(JSON.stringify({ ok: true, skipped: true, ct_time: ctTimeStr }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      // Duplicate guard — don't send the same briefing twice
      if (await alreadySentToday(briefingType, dateStr)) {
        console.log(`[brief] ${briefingType} already sent today (${dateStr}), skipping.`);
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'already_sent', type: briefingType }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`[brief] Firing ${briefingType} briefing at ${ctTimeStr} (${dateStr})`);

    // Load context from DB
    const ctx = await loadContext();

    // Fetch weather + news (not all briefings need full news)
    const needsWeather = ['morning', 'midday', 'afternoon'].includes(briefingType);
    const needsNews    = ['morning', 'midday', 'afternoon'].includes(briefingType);

    const [weather, news] = await Promise.all([
      needsWeather ? getWeather() : Promise.resolve(null),
      needsNews    ? getNewsData(briefingType === 'morning' ? ['headlines', 'finance', 'tech', 'sports'] :
                                  briefingType === 'midday'  ? ['headlines', 'finance'] :
                                                               ['finance', 'sports'])
                   : Promise.resolve(null),
    ]);

    // Build the briefing
    let result: { subject: string; html: string; sms: string };

    switch (briefingType) {
      case 'morning':      result = await buildMorning(ctx, weather, news);      break;
      case 'midday':       result = await buildMidday(ctx, weather, news);       break;
      case 'afternoon':    result = await buildAfternoon(ctx, weather, news);    break;
      case 'evening':      result = await buildEvening(ctx);                     break;
      case 'presynthesis': result = await buildPreSynthesis(ctx);                break;
      default:             result = await buildMorning(ctx, weather, news);
    }

    // Send email + SMS in parallel
    const [emailResult] = await Promise.all([
      sendEmail(result.subject, result.html),
      sendSMS(result.sms),
    ]);

    // Save briefing to DB (for dashboard card)
    const { data: savedBrief } = await db.from('briefings').insert({
      type:     briefingType,
      content:  result.html,
      subject:  result.subject,
      sms_text: result.sms,
      sent_at:  new Date().toISOString(),
      metadata: {
        email_sent: emailResult?.ok || false,
        sms_configured: !!(TWILIO_SID && TWILIO_TOKEN),
      },
    }).select().single();

    console.log(`[brief] ${briefingType} briefing sent. Email: ${emailResult?.ok}, SMS: ${!!(TWILIO_SID && TWILIO_TOKEN)}`);

    return new Response(JSON.stringify({
      ok:            true,
      type:          briefingType,
      subject:       result.subject,
      email_sent:    emailResult?.ok || false,
      sms_sent:      !!(TWILIO_SID && TWILIO_TOKEN),
      briefing_id:   savedBrief?.id || null,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[brief] Fatal error:', err);
    // Log to jarvis_errors table
    try {
      await db.from('jarvis_errors').insert({
        source:     'edge:morning-brief',
        error_type: 'edge_fn',
        message:    String(err),
        resolved:   false,
      });
    } catch(_) { /* don't let error logging break the response */ }
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
