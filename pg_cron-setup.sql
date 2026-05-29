-- ╔══════════════════════════════════════════════════════════╗
-- ║  JARVIS — pg_cron Scheduled Jobs Setup                  ║
-- ║                                                          ║
-- ║  Run in: Supabase → SQL Editor                           ║
-- ║                                                          ║
-- ║  TIMEZONE: Fully automatic — no manual changes ever.     ║
-- ║  morning-brief reads America/Chicago time directly.      ║
-- ║  When Dallas clocks change, JARVIS adjusts itself —      ║
-- ║  same as your phone.                                     ║
-- ║                                                          ║
-- ║  HOW IT WORKS:                                           ║
-- ║  pg_cron calls morning-brief every 15 minutes, 24/7.     ║
-- ║  The function checks the real CT clock. If it's a        ║
-- ║  briefing time (±7 min), it fires. Otherwise it exits    ║
-- ║  in milliseconds. Duplicate guard prevents double sends. ║
-- ║                                                          ║
-- ║  REPLACE: evedwhwepnuloqougztv → your project ref        ║
-- ╚══════════════════════════════════════════════════════════╝

-- ── Step 1: Enable extensions (run once)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Step 2: Remove any existing JARVIS jobs (safe to re-run)
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname LIKE 'jarvis-%';

-- ════════════════════════════════════════════════════════════
-- BRIEFINGS — one schedule, handles all 5 briefings + DST
-- Runs every 15 min. Function self-determines what to send.
-- ════════════════════════════════════════════════════════════
SELECT cron.schedule(
  'jarvis-briefings',
  '*/15 * * * *',   -- every 15 minutes, all day
  $$
  SELECT net.http_post(
    url     := 'https://evedwhwepnuloqougztv.supabase.co/functions/v1/morning-brief',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- ════════════════════════════════════════════════════════════
-- MEMORY SYNTHESIS — nightly at 12:05am CT
-- Uses fixed 05:05 UTC (CDT) — close enough year-round.
-- synthesize function also reads America/Chicago for logging.
-- ════════════════════════════════════════════════════════════
SELECT cron.schedule(
  'jarvis-synthesize',
  '5 5 * * *',      -- 5:05 UTC = 12:05am CT (CDT) / 11:05pm CT (CST)
  $$
  SELECT net.http_post(
    url     := 'https://evedwhwepnuloqougztv.supabase.co/functions/v1/synthesize',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- ════════════════════════════════════════════════════════════
-- AUTOMATIONS — one schedule, handles all 9 checks + DST
-- Runs every 30 min. Function self-determines what fires.
-- ════════════════════════════════════════════════════════════
SELECT cron.schedule(
  'jarvis-automate',
  '*/30 * * * *',   -- every 30 minutes
  $$
  SELECT net.http_post(
    url     := 'https://evedwhwepnuloqougztv.supabase.co/functions/v1/automate',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- ════════════════════════════════════════════════════════════
-- Verify — should see 3 jarvis- jobs
-- ════════════════════════════════════════════════════════════
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'jarvis-%'
ORDER BY jobname;

-- ════════════════════════════════════════════════════════════
-- FULL AUTOMATION SCHEDULE (all times CT, auto DST)
--
-- BRIEFINGS (morning-brief, every 15 min):
--   7:00 AM  → morning brief (weather, news, priorities)
--  12:00 PM  → midday pulse (news, water check)
--   4:00 PM  → afternoon update (markets, sports, todos)
--   9:00 PM  → evening wind-down (health, reflection)
--  11:45 PM  → pre-synthesis (journal prompt, gratitude)
--  12:05 AM  → nightly synthesis (full life profile update)
--
-- AUTOMATIONS (automate, every 30 min):
--   8:00 AM  → subscription renewal alerts (7-day + 1-day)
--   8:10 AM  → stale todo alerts (urgent/high, 3+ days old)
--   8:20 AM  → saving goal milestones
--   9am–9pm  → water nudges every 2 hours (if behind pace)
--   8:00 PM  → meal log reminder (if < 2 meals logged)
--   8:10 PM  → workout log reminder (Mon/Tue/Thu/Fri only)
--   9:00 PM  → workout consistency (this week vs 4x goal)
--  12:00 PM  → sleep log reminder (if nothing logged)
--   7:00 PM  → weekly finance summary (Sunday only)
-- ════════════════════════════════════════════════════════════
