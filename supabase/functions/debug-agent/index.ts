// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — debug-agent Edge Function v2                   ║
// ║                                                          ║
// ║  TWO MODES — both run via the same pg_cron every 15 min: ║
// ║                                                          ║
// ║  1. THRESHOLD CHECK (every 15 min, free)                 ║
// ║     Counts new errors since last check.                  ║
// ║     Fires an immediate alert email if ≥ ALERT_THRESHOLD. ║
// ║     Cooldown: no repeat alert for same source < 60 min.  ║
// ║     No Claude call — fast and cheap.                     ║
// ║                                                          ║
// ║  2. FULL REPORT (midnight CT only)                       ║
// ║     Deep Claude analysis of last 24hrs.                  ║
// ║     Sends full health report email with fix suggestions. ║
// ║                                                          ║
// ║  Manual triggers:                                        ║
// ║    POST {}                  → auto-detect mode           ║
// ║    POST {"mode":"check"}    → force threshold check      ║
// ║    POST {"mode":"report"}   → force full report          ║
// ║    POST {"mode":"report","hours":48} → look back 48hrs   ║
// ╚══════════════════════════════════════════════════════════╝

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY       = Deno.env.get('ANTHROPIC_KEY')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY       = Deno.env.get('RESEND_API_KEY');
const TONY_EMAIL           = Deno.env.get('NOTIFY_EMAIL') || 'antmartinez59@gmail.com';

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Thresholds ───────────────────────────────────────────────────
const ALERT_THRESHOLD    = 5;   // errors in 15 min → send alert
const CRITICAL_THRESHOLD = 15;  // errors in 15 min → critical alert (bypasses cooldown)
const ALERT_COOLDOWN_MIN = 60;  // minutes before re-alerting same source
const CHECK_WINDOW_MIN   = 15;  // how far back the threshold check looks

// ── Helpers ──────────────────────────────────────────────────────

function getCentralTime(): { hour: number; minute: number; dateStr: string } {
  const now = new Date();
  const ct  = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric', minute: 'numeric', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => ct.find(p => p.type === t)?.value || '0';
  return {
    hour:    parseInt(get('hour'),   10),
    minute:  parseInt(get('minute'), 10),
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

async function callClaude(system: string, user: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude error: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

async function sendEmail(subject: string, htmlBody: string) {
  if (!RESEND_API_KEY) { console.log('[debug-agent] No RESEND_API_KEY — skipping email'); return false; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'JARVIS Debug <onboarding@resend.dev>',
      to:   [TONY_EMAIL],
      subject,
      html: htmlBody,
    }),
  });
  if (!res.ok) console.error('[debug-agent] Resend error:', await res.text());
  return res.ok;
}

function wrapEmail(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f11;color:#e8e8e8;margin:0;padding:0;}
  .wrap{max-width:620px;margin:0 auto;padding:24px 16px;}
  .hdr{border-bottom:1px solid #2a2a2e;padding-bottom:14px;margin-bottom:20px;}
  .hdr h1{color:#7c6af7;font-size:16px;margin:0;letter-spacing:2px;}
  h2{color:#a89cf7;font-size:18px;margin-top:0;}
  h3{color:#c8c8d4;font-size:14px;margin:16px 0 6px;}
  p,li{color:#c8c8d4;line-height:1.6;}
  .alert-box{background:#1a0a0a;border:1px solid #ff446660;border-radius:8px;padding:14px 18px;margin:12px 0;}
  .alert-box.critical{border-color:#ff4466;background:#200808;}
  .clean{background:#0d2a1a;border:1px solid #1a5c30;border-radius:8px;padding:14px 18px;margin:12px 0;}
  .issue{background:#1a1a0a;border-left:3px solid #ffaa44;padding:10px 14px;margin:8px 0;border-radius:0 6px 6px 0;}
  .issue.critical{border-left-color:#ff4466;}
  .fix{background:#0a1a2a;border-left:3px solid #7c6af7;padding:10px 14px;margin:8px 0;border-radius:0 6px 6px 0;}
  .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-left:4px;}
  .badge.high{background:#ff446620;color:#ff4466;}
  .badge.med{background:#ffaa4420;color:#ffaa44;}
  .badge.low{background:#44e87a20;color:#44e87a;}
  code{background:#1a1a2e;padding:2px 6px;border-radius:4px;font-size:12px;color:#a89cf7;}
  .ftr{border-top:1px solid #2a2a2e;margin-top:28px;padding-top:14px;font-size:11px;color:#555;}
</style></head><body><div class="wrap">
<div class="hdr"><h1>⬡ JARVIS — Debug Agent</h1></div>
${body}
<div class="ftr">JARVIS Debug Agent • ${new Date().toLocaleDateString('en-US',{timeZone:'America/Chicago',weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
</div></body></html>`;
}

// ══════════════════════════════════════════════════════════════
// MODE 1: THRESHOLD CHECK (every 15 min — no Claude, very fast)
// ══════════════════════════════════════════════════════════════

async function runThresholdCheck() {
  const windowStart = new Date(Date.now() - CHECK_WINDOW_MIN * 60 * 1000).toISOString();

  // Count new errors in the last CHECK_WINDOW_MIN minutes
  const { data: recentErrors } = await db
    .from('jarvis_errors')
    .select('id, source, error_type, message, created_at, context')
    .gte('created_at', windowStart)
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(100);

  const errors = recentErrors || [];
  const count  = errors.length;

  console.log(`[debug-agent] Threshold check: ${count} errors in last ${CHECK_WINDOW_MIN} min`);

  if (count < ALERT_THRESHOLD) {
    return { ok: true, mode: 'check', status: 'below_threshold', count };
  }

  const isCritical = count >= CRITICAL_THRESHOLD;

  // ── Cooldown check — don't spam alerts ────────────────────
  if (!isCritical) {
    const cooldownStart = new Date(Date.now() - ALERT_COOLDOWN_MIN * 60 * 1000).toISOString();
    const { data: recentAlert } = await db
      .from('jarvis_health')
      .select('id, created_at')
      .eq('status', 'alert_sent')
      .gte('created_at', cooldownStart)
      .limit(1)
      .maybeSingle();

    if (recentAlert) {
      const mins = Math.round((Date.now() - new Date(recentAlert.created_at).getTime()) / 60000);
      console.log(`[debug-agent] Alert already sent ${mins} min ago — cooldown active.`);
      return { ok: true, mode: 'check', status: 'cooldown', count, last_alert_mins_ago: mins };
    }
  }

  // ── Group by source for the alert email ───────────────────
  const bySource: Record<string, { count: number; messages: string[]; type: string }> = {};
  for (const e of errors) {
    const src = e.source || 'unknown';
    if (!bySource[src]) bySource[src] = { count: 0, messages: [], type: e.error_type || '' };
    bySource[src].count++;
    if (bySource[src].messages.length < 3) bySource[src].messages.push(e.message?.slice(0, 100) || '');
  }

  const sourceSummary = Object.entries(bySource)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([src, v]) => `<div class="issue ${isCritical ? 'critical' : ''}">
      <strong>${src}</strong> <span class="badge ${isCritical ? 'high' : 'med'}">${v.count}x in ${CHECK_WINDOW_MIN}min</span>
      <br><span style="font-size:12px;color:#888;">${v.messages.join(' · ')}</span>
    </div>`).join('');

  const alertLevel = isCritical ? '🔴 CRITICAL' : '🟡 WARNING';
  const subject    = `${isCritical ? '🔴' : '🟡'} JARVIS Alert — ${count} errors in ${CHECK_WINDOW_MIN} min`;

  const html = wrapEmail(`
    <h2>${alertLevel}: ${count} errors in ${CHECK_WINDOW_MIN} minutes</h2>
    <div class="alert-box ${isCritical ? 'critical' : ''}">
      <strong>${isCritical ? '🚨 Critical threshold crossed' : '⚠️ Error threshold crossed'}</strong>
      — ${count} errors detected in the last ${CHECK_WINDOW_MIN} minutes.
      ${isCritical ? '<br><strong>Immediate attention needed.</strong>' : ''}
    </div>
    <h3>Error sources</h3>
    ${sourceSummary}
    <p style="margin-top:16px;">
      <strong>Check the full error log:</strong> Supabase → Table Editor → jarvis_errors<br>
      <span style="color:#555;font-size:12px;">Full analysis report will be included in tonight's midnight report.</span>
    </p>
  `);

  await sendEmail(subject, html);

  // Record the alert so cooldown works
  await db.from('jarvis_health').insert({
    report_date:     getCentralTime().dateStr,
    error_count:     count,
    unique_issues:   Object.keys(bySource).length,
    top_issues:      Object.entries(bySource).map(([src, v]) => ({ source: src, count: v.count })),
    claude_analysis: `Threshold alert: ${count} errors in ${CHECK_WINDOW_MIN} minutes.`,
    suggested_fixes: [],
    status:          'alert_sent',
  });

  console.log(`[debug-agent] Alert sent — ${count} errors, isCritical: ${isCritical}`);
  return { ok: true, mode: 'check', status: 'alert_sent', count, critical: isCritical };
}

// ══════════════════════════════════════════════════════════════
// MODE 2: FULL NIGHTLY REPORT (midnight CT — uses Claude)
// ══════════════════════════════════════════════════════════════

async function runFullReport(lookbackHours = 24) {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const { dateStr } = getCentralTime();

  const { data: errors } = await db
    .from('jarvis_errors')
    .select('*')
    .gte('created_at', since)
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(200);

  const errorList = errors || [];

  // ── Clean bill of health ─────────────────────────────────
  if (errorList.length === 0) {
    await db.from('jarvis_health').insert({
      report_date: dateStr, error_count: 0, unique_issues: 0,
      top_issues: [], claude_analysis: `No errors in last ${lookbackHours}h. JARVIS running cleanly.`,
      suggested_fixes: [], status: 'clean',
    });
    await sendEmail('✅ JARVIS Nightly Report — All Clear', wrapEmail(`
      <h2>✅ All Clear</h2>
      <div class="clean">
        <strong>Zero errors in the last ${lookbackHours} hours.</strong>
        <p>All systems nominal. No action needed.</p>
      </div>
    `));
    return { ok: true, status: 'clean', error_count: 0 };
  }

  // ── Group + deduplicate ───────────────────────────────────
  const grouped: Record<string, { count: number; sample: any; severity: string }> = {};
  for (const e of errorList) {
    const key = `${e.source}::${(e.message || '').slice(0, 80)}`;
    if (!grouped[key]) grouped[key] = { count: 0, sample: e, severity: 'low' };
    grouped[key].count++;
    if (grouped[key].count >= 10) grouped[key].severity = 'critical';
    else if (grouped[key].count >= 3)  grouped[key].severity = 'high';
    else if (grouped[key].count >= 2)  grouped[key].severity = 'medium';
  }

  const topIssues = Object.entries(grouped)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([key, val]) => ({
      key, source: val.sample.source, type: val.sample.error_type,
      message: val.sample.message, context: val.sample.context,
      count: val.count, severity: val.severity,
    }));

  // ── Claude analysis ───────────────────────────────────────
  const errorSummary = topIssues.map((e, i) =>
    `${i+1}. [${e.severity.toUpperCase()}] Source: ${e.source} | Type: ${e.type} | Count: ${e.count}x\n   Message: ${e.message}\n   Context: ${JSON.stringify(e.context || {})}`
  ).join('\n\n');

  const claudeRaw = await callClaude(
    `You are JARVIS's debug agent. Analyze error logs from a personal AI app (Supabase Edge Functions + Vercel + vanilla JS). Respond with valid JSON only.`,
    `Analyze ${errorList.length} errors from last ${lookbackHours}h (${topIssues.length} unique):\n\n${errorSummary}\n\nRespond with:\n{"summary":"2-3 sentences","overall_health":"critical|degraded|stable|healthy","fixes":[{"issue":"","root_cause":"","fix":"","file":"","priority":"critical|high|medium|low","effort":"5min|30min|1hr|1day"}],"patterns":[],"immediate_action":""}`
  );

  let analysis: any = {};
  try {
    analysis = JSON.parse(claudeRaw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim());
  } catch {
    analysis = { summary: claudeRaw.slice(0,500), overall_health: 'unknown', fixes: [], patterns: [], immediate_action: '' };
  }

  // ── Save report ───────────────────────────────────────────
  const { data: saved } = await db.from('jarvis_health').insert({
    report_date: dateStr, error_count: errorList.length,
    unique_issues: topIssues.length, top_issues: topIssues,
    claude_analysis: analysis.summary || '', suggested_fixes: analysis.fixes || [],
    status: 'analyzed',
  }).select().single();

  // ── Build + send email ────────────────────────────────────
  const hColors: Record<string,string> = { critical:'#ff4466', degraded:'#ffaa44', stable:'#7c6af7', healthy:'#44e87a', unknown:'#7777aa' };
  const hEmoji: Record<string,string>  = { critical:'🔴', degraded:'🟡', stable:'🔵', healthy:'✅', unknown:'⚪' };
  const health  = analysis.overall_health || 'unknown';
  const hColor  = hColors[health] || '#7777aa';

  const issuesHtml = topIssues.slice(0,8).map(e=>`
    <div class="issue ${e.severity==='critical'?'critical':''}">
      <strong>${e.source}</strong> — ${(e.message||'').slice(0,100)}
      <br><span style="font-size:11px;color:#888;">${e.count}x · ${e.type||'unknown'}</span>
      <span class="badge ${e.severity==='critical'||e.severity==='high'?'high':e.severity==='medium'?'med':'low'}">${e.severity}</span>
    </div>`).join('');

  const fixesHtml = (analysis.fixes||[]).slice(0,6).map((f:any)=>`
    <div class="fix">
      <strong>${f.issue}</strong>
      <span class="badge ${f.priority==='critical'||f.priority==='high'?'high':f.priority==='medium'?'med':'low'}">${f.priority}</span>
      <span style="font-size:11px;color:#555;margin-left:4px;">${f.effort}</span>
      <br><span style="font-size:12px;color:#888;">Root cause: ${f.root_cause}</span>
      <br><span style="font-size:12px;color:#a89cf7;">Fix: ${f.fix}</span>
      <br><code>${f.file}</code>
    </div>`).join('');

  const patternsHtml = (analysis.patterns||[]).length
    ? `<h3>📊 Patterns</h3><ul>${(analysis.patterns||[]).map((p:string)=>`<li>${p}</li>`).join('')}</ul>` : '';

  await sendEmail(
    `${hEmoji[health]||'⚪'} JARVIS Nightly Report — ${errorList.length} errors · ${health}`,
    wrapEmail(`
      <h2>${hEmoji[health]||'⚪'} Nightly Health Report — ${dateStr}</h2>
      <p style="background:${hColor}20;border:1px solid ${hColor}40;border-radius:8px;padding:10px 14px;">
        <strong style="color:${hColor};">Health: ${health.toUpperCase()}</strong><br>${analysis.summary||''}
      </p>
      ${analysis.immediate_action?`<h3>⚡ Immediate Action</h3><div class="issue critical"><strong>${analysis.immediate_action}</strong></div>`:''}
      <h3>🐛 Top Issues (${topIssues.length} unique · ${errorList.length} total)</h3>${issuesHtml}
      ${fixesHtml?`<h3>🔧 Suggested Fixes</h3>${fixesHtml}`:''}
      ${patternsHtml}
      <p style="color:#555;font-size:12px;margin-top:16px;">Full log: Supabase → jarvis_errors · History: Supabase → jarvis_health</p>
    `)
  );

  return { ok: true, mode: 'report', status: health, error_count: errorList.length, unique_issues: topIssues.length, report_id: saved?.id };
}

// ══════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    // Parse body
    let mode = 'auto';
    let lookbackHours = 24;
    try {
      const body = await req.json();
      if (body?.mode) mode = body.mode;
      if (body?.hours) lookbackHours = parseInt(body.hours) || 24;
    } catch { /* no body */ }

    // Auto-detect mode from CT time
    if (mode === 'auto') {
      const { hour, minute } = getCentralTime();
      const nowMins = hour * 60 + minute;
      const midnightMins = 0; // midnight = 00:00
      // Midnight window ±7 min: 23:53–00:07
      const isMidnight = nowMins <= 7 || nowMins >= 23 * 60 + 53;
      mode = isMidnight ? 'report' : 'check';
      console.log(`[debug-agent] Auto mode: ${mode} (CT ${hour}:${String(minute).padStart(2,'0')})`);
    }

    if (mode === 'report') {
      const result = await runFullReport(lookbackHours);
      return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    } else {
      const result = await runThresholdCheck();
      return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

  } catch (err) {
    console.error('[debug-agent] Fatal error:', err);
    try {
      await db.from('jarvis_errors').insert({ source: 'edge:debug-agent', error_type: 'edge_fn', message: String(err), resolved: false });
    } catch(_) {}
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
