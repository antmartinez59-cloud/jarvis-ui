// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — automate Edge Function                         ║
// ║  Runs every 30 min via pg_cron                           ║
// ║  Handles ALL automations — self-determines what fires:   ║
// ║                                                          ║
// ║  ① Water nudge       every 2h, 9am–9pm CT               ║
// ║  ② Workout check     9pm CT, Mon–Sun                     ║
// ║  ③ Subscription alert daily 8am CT                       ║
// ║  ④ Todo aging        daily 8am CT                        ║
// ║  ⑤ Finance summary   Sunday 7pm CT                       ║
// ║  ⑥ Saving milestones on-demand (called by transaction)   ║
// ║                                                          ║
// ║  All notifications: SMS (Twilio) + Apple Reminders       ║
// ╚══════════════════════════════════════════════════════════╝

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY        = Deno.env.get('ANTHROPIC_KEY')!;
const TWILIO_SID           = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_TOKEN         = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_FROM          = Deno.env.get('TWILIO_FROM_NUMBER');
const TWILIO_TO            = Deno.env.get('TWILIO_TO_NUMBER');
const APPLE_USER           = Deno.env.get('APPLE_CALDAV_USER');
const APPLE_PASS           = Deno.env.get('APPLE_CALDAV_PASSWORD');

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SUPABASE_FUNCTIONS_URL = SUPABASE_URL.replace('.supabase.co', '.supabase.co/functions/v1');
const WATER_GOAL_OZ          = 80;
const WORKOUT_DAYS_PER_WEEK  = 4;

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

// Central Time (handles CDT/CST automatically)
function getCT(): { hour: number; minute: number; dayOfWeek: number; dateStr: string } {
  const now   = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour:     'numeric',
    minute:   'numeric',
    weekday:  'short',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour12:   false,
  }).formatToParts(now);

  const get     = (type: string) => parts.find(p => p.type === type)?.value || '0';
  const weekday = get('weekday'); // Mon, Tue, ...
  const days    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return {
    hour:      parseInt(get('hour'),   10),
    minute:    parseInt(get('minute'), 10),
    dayOfWeek: days.indexOf(weekday),
    dateStr:   `${get('year')}-${get('month')}-${get('day')}`,
  };
}

// Check if within ±8 minutes of a target time
function isNear(h: number, m: number, targetH: number, targetM: number): boolean {
  return Math.abs((h * 60 + m) - (targetH * 60 + targetM)) <= 8;
}

// Check if this automation already ran today (dedup)
async function alreadyRanToday(name: string, dateStr: string): Promise<boolean> {
  const { data } = await db
    .from('notifications')
    .select('id')
    .eq('type', `automate_${name}`)
    .gte('created_at', `${dateStr}T00:00:00Z`)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function markRan(name: string, body: string) {
  await db.from('notifications').insert({
    type:  `automate_${name}`,
    title: name,
    body,
    sent:  true,
  });
}

// ── Twilio SMS ───────────────────────────────────────────────
async function sms(body: string) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || !TWILIO_TO) return;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method:  'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: TWILIO_TO, From: TWILIO_FROM, Body: body }),
  });
}

// ── Apple Reminder (calls apple-remind function) ─────────────
async function appleRemind(title: string, notes?: string, dueMinutes = 0, priority = 'none') {
  if (!APPLE_USER || !APPLE_PASS) return { ok: false, reason: 'not configured' };
  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/apple-remind`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ title, notes, dueMinutesFromNow: dueMinutes, priority }),
    });
    return res.json();
  } catch (e) {
    console.error('[automate] Apple Remind error:', e);
    return { ok: false };
  }
}

// ── Notify via both channels ─────────────────────────────────
async function notify(smsText: string, reminderTitle: string, reminderNotes?: string, dueMinutes = 5, priority = 'none') {
  await Promise.all([
    sms(smsText),
    appleRemind(reminderTitle, reminderNotes, dueMinutes, priority),
  ]);
}

// ══════════════════════════════════════════════════════════════
// ① WATER NUDGE — every 2h, 9am–9pm CT
//   Checks if Tony is behind pace for the time of day
// ══════════════════════════════════════════════════════════════
async function checkWater(ct: ReturnType<typeof getCT>) {
  const { hour, minute, dateStr } = ct;

  // Water hours: 9, 11, 13, 15, 17, 19, 21 CT
  const waterHours = [9, 11, 13, 15, 17, 19, 21];
  if (!waterHours.some(h => isNear(hour, minute, h, 0))) return;

  // Dedup key includes hour so each 2h slot fires once
  const key = `water_${hour}`;
  if (await alreadyRanToday(key, dateStr)) return;

  // How much water should Tony have had by now?
  // Spread 80oz across 9am–9pm = 12 hours → ~6.67oz/hour
  const hoursElapsed = Math.max(0, hour - 9);
  const expectedOz   = Math.round((hoursElapsed / 12) * WATER_GOAL_OZ);

  // Get actual water logged today
  const { data: logs } = await db
    .from('water_logs')
    .select('amount_oz')
    .gte('logged_at', `${dateStr}T00:00:00Z`);

  const actual   = (logs || []).reduce((s: number, l: any) => s + (l.amount_oz || 0), 0);
  const deficit  = expectedOz - actual;

  if (deficit <= 8) return; // On track or ahead — don't nag

  const remaining = WATER_GOAL_OZ - actual;
  const msg = `💧 Water check (${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'} CT): ${actual}oz logged, should be ~${expectedOz}oz by now. ${remaining}oz to go today.`;
  const reminderTitle = `Drink water — ${remaining}oz left today`;
  const reminderNotes = `You've had ${actual}oz. Goal: ${WATER_GOAL_OZ}oz. Behind by ${deficit}oz.`;

  await notify(msg, reminderTitle, reminderNotes, 0, 'high');
  await markRan(key, msg);
  console.log(`[automate] Water nudge sent (${actual}oz / ${expectedOz}oz expected)`);
}

// ══════════════════════════════════════════════════════════════
// ② WORKOUT CONSISTENCY — 8pm CT daily
//   Checks workouts logged this week vs goal (4x/week)
// ══════════════════════════════════════════════════════════════
async function checkWorkout(ct: ReturnType<typeof getCT>) {
  const { hour, minute, dayOfWeek, dateStr } = ct;

  if (!isNear(hour, minute, 20, 0)) return; // 8pm CT
  if (await alreadyRanToday('workout', dateStr)) return;

  // Find start of this week (Sunday)
  const today    = new Date(`${dateStr}T12:00:00Z`);
  const sunday   = new Date(today);
  sunday.setDate(today.getDate() - dayOfWeek);
  const weekStart = sunday.toISOString().slice(0, 10);

  const { data: workouts } = await db
    .from('workouts')
    .select('id, date')
    .gte('date', weekStart);

  const count      = (workouts || []).length;
  const daysLeft   = 7 - dayOfWeek; // days left in the week
  const needed     = WORKOUT_DAYS_PER_WEEK - count;

  if (needed <= 0) {
    // Hit the goal — celebrate quietly (only on the day they hit it)
    if (count === WORKOUT_DAYS_PER_WEEK) {
      await notify(
        `💪 Hit your ${WORKOUT_DAYS_PER_WEEK}x/week workout goal! Great work this week.`,
        '🏆 Workout goal hit this week!',
        `${count} workouts logged. Goal: ${WORKOUT_DAYS_PER_WEEK}/week.`
      );
    }
  } else if (daysLeft > 0 && needed <= daysLeft) {
    // Behind but catchable
    const msg = `🏋️ Workout check: ${count}/${WORKOUT_DAYS_PER_WEEK} this week. Need ${needed} more in ${daysLeft} day${daysLeft > 1 ? 's' : ''}.`;
    await notify(msg, `Workout needed — ${needed} more this week`, `${count} of ${WORKOUT_DAYS_PER_WEEK} logged. ${daysLeft} days left.`, 30, 'high');
  } else if (needed > daysLeft) {
    // Mathematically can't hit goal this week
    const msg = `🏋️ Missed the ${WORKOUT_DAYS_PER_WEEK}x goal this week (${count} logged). Start fresh tomorrow.`;
    await notify(msg, 'Start fresh — new workout week tomorrow', `${count} of ${WORKOUT_DAYS_PER_WEEK} this week.`);
  }

  await markRan('workout', `${count} workouts logged this week`);
  console.log(`[automate] Workout check: ${count}/${WORKOUT_DAYS_PER_WEEK} this week`);
}

// ══════════════════════════════════════════════════════════════
// ③ SUBSCRIPTION RENEWAL ALERTS — 8am CT daily
//   7-day warning + 1-day warning
// ══════════════════════════════════════════════════════════════
async function checkSubscriptions(ct: ReturnType<typeof getCT>) {
  const { hour, minute, dateStr } = ct;

  if (!isNear(hour, minute, 8, 0)) return; // 8am CT
  if (await alreadyRanToday('subscriptions', dateStr)) return;

  const today   = new Date(`${dateStr}T12:00:00Z`);
  const in7days = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const in1day  = new Date(today.getTime() + 1 * 86400000).toISOString().slice(0, 10);

  const { data: subs } = await db
    .from('subscriptions')
    .select('name, amount, next_renewal, billing_cycle')
    .eq('is_active', true)
    .lte('next_renewal', in7days)
    .gte('next_renewal', dateStr);

  if (!subs || subs.length === 0) {
    await markRan('subscriptions', 'none due');
    return;
  }

  for (const sub of subs) {
    const daysAway = Math.round(
      (new Date(sub.next_renewal).getTime() - today.getTime()) / 86400000
    );

    if (daysAway <= 1) {
      const msg = `🔔 ${sub.name} renews TOMORROW — $${sub.amount}. Check if you still use it.`;
      await notify(msg, `${sub.name} renews tomorrow — $${sub.amount}`, `Review or cancel at least a few hours before renewal.`, 0, 'urgent');
    } else if (daysAway <= 7) {
      const msg = `📅 ${sub.name} renews in ${daysAway} days — $${sub.amount}. Cancel by ${sub.next_renewal} if needed.`;
      await notify(msg, `${sub.name} renews in ${daysAway} days`, `$${sub.amount} on ${sub.next_renewal}. Cancel before then if you don't want it.`, 0, 'medium');
    }
  }

  await markRan('subscriptions', `${subs.length} renewals flagged`);
  console.log(`[automate] Subscription check: ${subs.length} upcoming renewals`);
}

// ══════════════════════════════════════════════════════════════
// ④ TODO AGING — 8am CT daily
//   Urgent/High todos untouched for 3+ days
// ══════════════════════════════════════════════════════════════
async function checkStaleTodos(ct: ReturnType<typeof getCT>) {
  const { hour, minute, dateStr } = ct;

  if (!isNear(hour, minute, 8, 10)) return; // 8:10am CT (just after subscriptions)
  if (await alreadyRanToday('stale_todos', dateStr)) return;

  const threeDaysAgo = new Date(new Date(`${dateStr}T12:00:00Z`).getTime() - 3 * 86400000)
    .toISOString().slice(0, 10);

  const { data: stale } = await db
    .from('todos')
    .select('title, priority, created_at, due_date')
    .eq('status', 'active')
    .in('priority', ['urgent', 'high'])
    .lte('created_at', `${threeDaysAgo}T23:59:59Z`);

  if (!stale || stale.length === 0) {
    await markRan('stale_todos', 'none stale');
    return;
  }

  const list  = stale.slice(0, 3).map((t: any) =>
    `[${t.priority.toUpperCase()}] ${t.title}`
  ).join(', ');

  const msg   = `⏰ ${stale.length} stale todo${stale.length > 1 ? 's' : ''} (3+ days old): ${list}. Finish, move, or archive today.`;
  const notes = stale.map((t: any) => `${t.title} — ${t.priority} priority, created ${t.created_at?.slice(0,10)}`).join('\n');

  await notify(msg, `${stale.length} stale todos need attention`, notes, 30, 'high');
  await markRan('stale_todos', `${stale.length} stale`);
  console.log(`[automate] Stale todo check: ${stale.length} flagged`);
}

// ══════════════════════════════════════════════════════════════
// ⑤ WEEKLY FINANCE SUMMARY — Sunday 7pm CT
// ══════════════════════════════════════════════════════════════
async function checkWeeklyFinance(ct: ReturnType<typeof getCT>) {
  const { hour, minute, dayOfWeek, dateStr } = ct;

  if (dayOfWeek !== 0) return;          // Sunday only
  if (!isNear(hour, minute, 19, 0)) return; // 7pm CT
  if (await alreadyRanToday('weekly_finance', dateStr)) return;

  const today      = new Date(`${dateStr}T12:00:00Z`);
  const weekStart  = new Date(today.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const lastWeekStart = new Date(today.getTime() - 13 * 86400000).toISOString().slice(0, 10);
  const lastWeekEnd   = new Date(today.getTime() - 7  * 86400000).toISOString().slice(0, 10);

  const [thisWeek, lastWeek] = await Promise.all([
    db.from('transactions').select('amount, type, description').gte('date', weekStart),
    db.from('transactions').select('amount, type').gte('date', lastWeekStart).lte('date', lastWeekEnd),
  ]);

  const thisSpend = (thisWeek.data || [])
    .filter((t: any) => t.type === 'expense')
    .reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);
  const lastSpend = (lastWeek.data || [])
    .filter((t: any) => t.type === 'expense')
    .reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);
  const thisIncome = (thisWeek.data || [])
    .filter((t: any) => t.type === 'income')
    .reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);

  const diff    = thisSpend - lastSpend;
  const trend   = diff > 0 ? `⬆️ $${diff.toFixed(0)} more than last week` : `⬇️ $${Math.abs(diff).toFixed(0)} less than last week`;
  const txCount = (thisWeek.data || []).length;

  if (txCount === 0) {
    await markRan('weekly_finance', 'no transactions');
    return;
  }

  const msg = `📊 Weekly Finance: spent $${thisSpend.toFixed(0)} this week (${trend}). Income: $${thisIncome.toFixed(0)}. ${txCount} transactions. Full report in JARVIS.`;
  const reminderNotes = `Spent: $${thisSpend.toFixed(0)}\nIncome: $${thisIncome.toFixed(0)}\nTrend: ${trend}\nTransactions: ${txCount}`;

  await notify(msg, 'Weekly spending report ready', reminderNotes, 0, 'low');
  await markRan('weekly_finance', `$${thisSpend.toFixed(0)} spent`);
  console.log(`[automate] Weekly finance: $${thisSpend.toFixed(0)} spent, $${thisIncome.toFixed(0)} income`);
}

// ══════════════════════════════════════════════════════════════
// ⑥ SAVING GOAL MILESTONES — called directly when a transaction
//   is added, or runs during the 8am check as a sweep
// ══════════════════════════════════════════════════════════════
async function checkSavingGoals(ct: ReturnType<typeof getCT>) {
  const { hour, minute, dateStr } = ct;

  if (!isNear(hour, minute, 8, 20)) return; // 8:20am CT sweep
  if (await alreadyRanToday('saving_goals', dateStr)) return;

  const { data: goals } = await db
    .from('saving_goals')
    .select('id, name, target_amount, current_amount, deadline');

  if (!goals || goals.length === 0) {
    await markRan('saving_goals', 'none');
    return;
  }

  const milestones = [25, 50, 75, 100];
  let fired = 0;

  for (const goal of goals) {
    if (!goal.target_amount || goal.target_amount === 0) continue;
    const pct = (goal.current_amount / goal.target_amount) * 100;

    for (const milestone of milestones) {
      const key = `goal_${goal.id}_${milestone}`;
      if (pct >= milestone && !(await alreadyRanToday(key, '2000-01-01'))) {
        // Check if we've EVER fired this milestone (not just today)
        const { data: prev } = await db
          .from('notifications')
          .select('id')
          .eq('type', `automate_${key}`)
          .limit(1)
          .maybeSingle();

        if (!prev) {
          const emoji = milestone === 100 ? '🎉' : milestone >= 75 ? '🔥' : milestone >= 50 ? '⭐' : '📈';
          const msg = `${emoji} Saving goal "${goal.name}" hit ${milestone}%! $${goal.current_amount?.toFixed(0)} of $${goal.target_amount?.toFixed(0)}.`;
          await notify(msg, `${emoji} ${goal.name} — ${milestone}% reached!`, `$${goal.current_amount} of $${goal.target_amount} saved.`, 0, milestone === 100 ? 'urgent' : 'medium');
          await markRan(key, `${milestone}% of ${goal.name}`);
          fired++;
        }
      }
    }
  }

  await markRan('saving_goals', `${fired} milestones fired`);
  console.log(`[automate] Saving goals: ${fired} milestones fired`);
}

// ══════════════════════════════════════════════════════════════
// ⑦ SLEEP LOG REMINDER — 10pm CT daily
//   If Tony hasn't logged sleep yet, remind him to log last night
// ══════════════════════════════════════════════════════════════
async function checkSleepLog(ct: ReturnType<typeof getCT>) {
  const { hour, minute, dateStr } = ct;

  if (!isNear(hour, minute, 22, 0)) return; // 10pm CT
  if (await alreadyRanToday('sleep_log', dateStr)) return;

  // Check if sleep was logged today or yesterday
  const yesterday = new Date(new Date(`${dateStr}T12:00:00Z`).getTime() - 86400000)
    .toISOString().slice(0, 10);

  const { data: sleepLog } = await db
    .from('sleep_logs')
    .select('id')
    .in('date', [dateStr, yesterday])
    .limit(1)
    .maybeSingle();

  if (sleepLog) {
    await markRan('sleep_log', 'already logged');
    return;
  }

  await notify(
    `😴 Don't forget to log last night's sleep in JARVIS before bed tonight.`,
    'Log your sleep tonight',
    'Track bedtime, wake time, and quality rating in JARVIS.',
    30,
    'medium'
  );
  await markRan('sleep_log', 'reminder sent');
  console.log('[automate] Sleep log reminder sent');
}

// ══════════════════════════════════════════════════════════════
// ⑧ MEAL LOG REMINDER — 8pm CT daily
//   If fewer than 2 meals logged today, remind
// ══════════════════════════════════════════════════════════════
async function checkMealLog(ct: ReturnType<typeof getCT>) {
  const { hour, minute, dateStr } = ct;

  if (!isNear(hour, minute, 20, 10)) return; // 8:10pm CT
  if (await alreadyRanToday('meal_log', dateStr)) return;

  const { data: meals } = await db
    .from('meals')
    .select('id')
    .eq('date', dateStr);

  const count = (meals || []).length;
  if (count >= 2) {
    await markRan('meal_log', `${count} meals logged`);
    return;
  }

  await notify(
    `🍽️ Only ${count} meal${count === 1 ? '' : 's'} logged today. Log your meals to keep your calorie tracking accurate.`,
    `Log today's meals (${count} logged so far)`,
    'Track in JARVIS: breakfast, lunch, dinner, snacks.',
    15,
    'medium'
  );
  await markRan('meal_log', `${count} meals only`);
  console.log(`[automate] Meal log reminder (${count} logged today)`);
}

// ══════════════════════════════════════════════════════════════
// ⑨ WORKOUT LOG REMINDER — 9pm CT on workout days
//   If no workout logged today but it's a planned workout day
// ══════════════════════════════════════════════════════════════
async function checkWorkoutLog(ct: ReturnType<typeof getCT>) {
  const { hour, minute, dayOfWeek, dateStr } = ct;

  if (!isNear(hour, minute, 21, 0)) return; // 9pm CT
  if (await alreadyRanToday('workout_log', dateStr)) return;

  // Check if today is a workout day (Mon/Tue/Thu/Fri = 1/2/4/5)
  const workoutDays = [1, 2, 4, 5]; // Mon, Tue, Thu, Fri
  if (!workoutDays.includes(dayOfWeek)) {
    await markRan('workout_log', 'rest day');
    return;
  }

  const { data: workout } = await db
    .from('workouts')
    .select('id')
    .eq('date', dateStr)
    .limit(1)
    .maybeSingle();

  if (workout) {
    await markRan('workout_log', 'already logged');
    return;
  }

  await notify(
    `🏋️ Did you work out today? Log it in JARVIS so your progress tracking stays accurate.`,
    'Log today\'s workout in JARVIS',
    'Track exercises, sets, reps, and weight.',
    20,
    'high'
  );
  await markRan('workout_log', 'reminder sent');
  console.log('[automate] Workout log reminder sent');
}

// ══════════════════════════════════════════════════════════════
// CUSTOM RULE RUNNER — evaluates user-built automations from DB
// ══════════════════════════════════════════════════════════════

async function evaluateCondition(condition: any, dateStr: string): Promise<boolean> {
  if (!condition || condition.type === 'always') return true;

  try {
    if (condition.type === 'query_below' || condition.type === 'query_above' || condition.type === 'query_equals') {
      const filter = condition.filter === 'today'
        ? `${dateStr}T00:00:00Z`
        : condition.filter;

      const { count } = await db
        .from(condition.table)
        .select('*', { count: 'exact', head: true })
        .gte(condition.filter === 'today' ? 'created_at' : 'date', filter);

      const c = count || 0;
      if (condition.type === 'query_below')  return c <  condition.threshold;
      if (condition.type === 'query_above')  return c >  condition.threshold;
      if (condition.type === 'query_equals') return c === condition.threshold;
    }

    if (condition.type === 'has_no_entry') {
      const filter = condition.filter === 'today' ? `${dateStr}T00:00:00Z` : condition.filter;
      const { count } = await db
        .from(condition.table)
        .select('*', { count: 'exact', head: true })
        .gte('date', dateStr)
        .lte('date', dateStr);
      return (count || 0) === 0;
    }
  } catch (e) {
    console.error('[automate] Condition eval error:', e);
  }
  return false;
}

async function runCustomRules(ct: ReturnType<typeof getCT>) {
  const { hour, minute, dayOfWeek, dateStr } = ct;

  // Load all enabled custom automations
  const { data: rules } = await db
    .from('custom_automations')
    .select('*')
    .eq('enabled', true);

  if (!rules || rules.length === 0) return;

  let fired = 0;

  for (const rule of rules) {
    try {
      const trigger   = rule.trigger;
      const condition = rule.condition;
      const action    = rule.action;

      // ── Check trigger ──────────────────────────────────────
      let triggerMet = false;

      if (trigger.type === 'schedule') {
        const days = trigger.days || [0,1,2,3,4,5,6];
        triggerMet = days.includes(dayOfWeek) &&
          isNear(hour, minute, trigger.ct_hour || 8, trigger.ct_minute || 0);
      } else if (trigger.type === 'interval') {
        const start = trigger.start_hour ?? 9;
        const end   = trigger.end_hour   ?? 21;
        const every = trigger.every_hours ?? 2;
        const days  = trigger.days || [0,1,2,3,4,5,6];
        triggerMet  = days.includes(dayOfWeek) &&
          hour >= start && hour <= end &&
          hour % every === 0 &&
          minute < 16; // fires within first 15 min of the interval hour
      }

      if (!triggerMet) continue;

      // ── Dedup check ────────────────────────────────────────
      const dedupKey = `custom_${rule.id}_${action.dedup_daily ? dateStr : `${dateStr}_${hour}`}`;
      if (action.dedup_daily && await alreadyRanToday(`custom_${rule.id}`, dateStr)) continue;

      // ── Check condition ────────────────────────────────────
      const conditionMet = await evaluateCondition(condition, dateStr);
      if (!conditionMet) continue;

      // ── Fire the notification ──────────────────────────────
      await notify(
        action.sms            || rule.name,
        action.reminder_title || rule.name,
        action.reminder_notes || '',
        action.due_minutes    || 0,
        action.priority       || 'medium'
      );

      // Mark as ran
      await markRan(`custom_${rule.id}`, `custom rule: ${rule.name}`);

      // Update fire count + last_fired on the rule
      await db.from('custom_automations').update({
        fire_count: (rule.fire_count || 0) + 1,
        last_fired: new Date().toISOString(),
      }).eq('id', rule.id);

      fired++;
      console.log(`[automate] Custom rule fired: "${rule.name}"`);

    } catch (e) {
      console.error(`[automate] Custom rule error (${rule.name}):`, e);
    }
  }

  if (fired > 0) console.log(`[automate] ${fired} custom rules fired`);
}

// ══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  try {
    // Allow manual trigger for specific checks
    let forceCheck: string | null = null;
    try {
      const body  = await req.json();
      forceCheck  = body?.check || null;
    } catch { /* automatic mode */ }

    const ct = getCT();
    console.log(`[automate] Running at ${ct.hour}:${String(ct.minute).padStart(2,'0')} CT (${ct.dateStr})`);

    const results: Record<string, any> = {};

    if (!forceCheck || forceCheck === 'water')         results.water         = await checkWater(ct).catch(e => ({ error: String(e) }));
    if (!forceCheck || forceCheck === 'workout')       results.workout       = await checkWorkout(ct).catch(e => ({ error: String(e) }));
    if (!forceCheck || forceCheck === 'subscriptions') results.subscriptions = await checkSubscriptions(ct).catch(e => ({ error: String(e) }));
    if (!forceCheck || forceCheck === 'todos')         results.todos         = await checkStaleTodos(ct).catch(e => ({ error: String(e) }));
    if (!forceCheck || forceCheck === 'finance')       results.finance       = await checkWeeklyFinance(ct).catch(e => ({ error: String(e) }));
    if (!forceCheck || forceCheck === 'goals')         results.goals         = await checkSavingGoals(ct).catch(e => ({ error: String(e) }));
    if (!forceCheck || forceCheck === 'sleep')         results.sleep         = await checkSleepLog(ct).catch(e => ({ error: String(e) }));
    if (!forceCheck || forceCheck === 'meals')         results.meals         = await checkMealLog(ct).catch(e => ({ error: String(e) }));
    if (!forceCheck || forceCheck === 'workout_log')   results.workout_log   = await checkWorkoutLog(ct).catch(e => ({ error: String(e) }));

    // ── Run custom user-defined automations from DB ──────────
    results.custom = await runCustomRules(ct).catch(e => ({ error: String(e) }));

    return new Response(JSON.stringify({ ok: true, ct_time: `${ct.hour}:${ct.minute}`, checks: Object.keys(results) }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[automate] Fatal:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
