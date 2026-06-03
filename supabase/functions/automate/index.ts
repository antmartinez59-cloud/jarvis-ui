// JARVIS — Automate Edge Function
// Runs every 30 min via pg_cron. Self-determines what to fire based on CT time.
// Handles: subscription alerts, stale todos, water nudges, meal/workout reminders,
//          sleep reminders, saving goal milestones, weekly finance summary

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getCT(): { hour: number; minute: number; day: number; dateStr: string } {
  const ct = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return {
    hour: ct.getHours(),
    minute: ct.getMinutes(),
    day: ct.getDay(), // 0=Sun, 6=Sat
    dateStr: ct.toISOString().slice(0, 10),
  };
}

function inWindow(targetHour: number, targetMin: number, windowMin = 20): boolean {
  const { hour, minute } = getCT();
  const current = hour * 60 + minute;
  const target = targetHour * 60 + targetMin;
  return Math.abs(current - target) <= windowMin;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supa = createClient(supabaseUrl, supabaseKey);
    const { hour, day, dateStr } = getCT();
    const fired: string[] = [];

    // ── 8:00 AM: Subscription renewal alerts (7-day + 1-day warning)
    if (inWindow(8, 0)) {
      const soon7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const soon1 = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);
      const { data: subs } = await supa.from('subscriptions')
        .select('name,amount,next_renewal').lte('next_renewal', soon7).eq('is_active', true);
      for (const sub of (subs || [])) {
        const daysLeft = Math.ceil((new Date(sub.next_renewal).getTime() - Date.now()) / 86400000);
          await supa.from('briefings').insert({
            briefing_type: 'automation',
            content: `Subscription reminder: ${sub.name} ($${sub.amount}) renews on ${sub.next_renewal} — ${daysLeft} days away.`,
          });
      }
      if ((subs || []).length > 0) fired.push('subscription_alerts');
    }

    // ── 8:10 AM: Stale todo alerts (urgent/high, 3+ days old)
    if (inWindow(8, 10)) {
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      const { data: staleTodos } = await supa.from('todos')
        .select('title,priority,created_at')
        .in('priority', ['urgent', 'high'])
        .eq('status', 'active')
        .lte('created_at', `${threeDaysAgo}T23:59:59`)
        .limit(5);
      if ((staleTodos || []).length > 0) {
        const list = (staleTodos || []).map((t: any) => `• [${t.priority}] ${t.title}`).join('\n');
          await supa.from('briefings').insert({
            briefing_type: 'automation',
            content: `High-priority todos that have been active for 3+ days:\n\n${list}`,
          });
        fired.push('stale_todos');
      }
    }

    // ── 9am-9pm: Water nudges every 2 hours (if behind pace)
    if (hour >= 9 && hour <= 21 && hour % 2 === 1 && inWindow(hour, 0, 10)) {
      const { data: waterLogs } = await supa.from('water_logs')
        .select('amount_oz').gte('logged_at', `${dateStr}T00:00:00`);
      const totalOz = (waterLogs || []).reduce((s: number, w: any) => s + (w.amount_oz || 0), 0);
      const targetByNow = Math.round((hour / 21) * 80); // 80oz goal
      if (totalOz < targetByNow - 16) {
          await supa.from('briefings').insert({
            briefing_type: 'automation',
            content: `Water nudge: ${totalOz}oz logged today. Target by ${hour}:00 is ${targetByNow}oz. Drink up!`,
          });
        fired.push('water_nudge');
      }
    }

    // ── 8:00 PM: Meal log reminder (if < 2 meals logged)
    if (inWindow(20, 0)) {
      const { data: meals } = await supa.from('meals')
        .select('id').gte('logged_at', `${dateStr}T00:00:00`);
      if ((meals || []).length < 2) {
          await supa.from('briefings').insert({
            briefing_type: 'automation',
            content: `Meal reminder: ${meals?.length || 0} meal(s) logged today. Log what you ate to track your nutrition.`,
          });
        fired.push('meal_reminder');
      }
    }

    // ── 8:10 PM: Workout reminder (Mon/Tue/Thu/Fri)
    if (inWindow(20, 10) && [1, 2, 4, 5].includes(day)) {
      const { data: workouts } = await supa.from('workouts')
        .select('id').gte('created_at', `${dateStr}T00:00:00`);
      if (!(workouts || []).length) {
        await supa.from('briefings').insert({
          briefing_type: 'automation',
          content: '🏋️ Workout not logged today — No workout logged yet. Even a quick session counts toward your consistency.',
        });
        fired.push('workout_reminder');
      }
    }

    // ── Sunday 7:00 PM: Weekly finance summary
    if (day === 0 && inWindow(19, 0)) {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const { data: txns } = await supa.from('transactions')
        .select('amount,type,category').gte('date', weekAgo);
      const income = (txns || []).filter((t: any) => t.type === 'income').reduce((s: number, t: any) => s + parseFloat(t.amount || 0), 0);
      const expenses = (txns || []).filter((t: any) => t.type !== 'income').reduce((s: number, t: any) => s + parseFloat(t.amount || 0), 0);
          await supa.from('briefings').insert({
            briefing_type: 'automation',
            content: `Weekly Finance Summary:\n• Income: $${income.toFixed(2)}\n• Expenses: $${expenses.toFixed(2)}\n• Net: $${(income - expenses).toFixed(2)}\n• Transactions: ${(txns || []).length}`,
          });
      fired.push('weekly_finance');
    }

    return new Response(JSON.stringify({ ok: true, fired, time_ct: `${getCT().hour}:${String(getCT().minute).padStart(2,'0')}` }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
