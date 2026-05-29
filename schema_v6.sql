-- ╔══════════════════════════════════════════════════════════╗
-- ║  JARVIS schema_v6 — Fix RLS + Grant anon access         ║
-- ║  Run this in Supabase → SQL Editor                      ║
-- ║  Safe to re-run                                         ║
-- ╚══════════════════════════════════════════════════════════╝

-- ── DISABLE RLS on all health / tracker tables ──────────────
alter table water_logs   disable row level security;
alter table sleep_logs   disable row level security;
alter table workouts     disable row level security;
alter table meals        disable row level security;
alter table body_stats   disable row level security;
alter table exercises    disable row level security;
alter table todos        disable row level security;
alter table reminders    disable row level security;

-- ── GRANT full access to anon role ──────────────────────────
grant select, insert, update, delete on water_logs    to anon;
grant select, insert, update, delete on sleep_logs    to anon;
grant select, insert, update, delete on workouts      to anon;
grant select, insert, update, delete on meals         to anon;
grant select, insert, update, delete on body_stats    to anon;
grant select, insert, update, delete on exercises     to anon;
grant select, insert, update, delete on todos         to anon;
grant select, insert, update, delete on reminders     to anon;
grant select, insert, update, delete on profile       to anon;
grant select, insert, update, delete on sessions      to anon;
grant select, insert, update, delete on learnings     to anon;
grant select, insert, update, delete on mastery_runs  to anon;
grant select, insert, update, delete on mastery_notes to anon;
grant select, insert, update, delete on agents        to anon;
grant select, insert, update, delete on briefings     to anon;
grant select, insert, update, delete on profile_history to anon;
grant select, insert, update, delete on transactions  to anon;
grant select, insert, update, delete on subscriptions to anon;
grant select, insert, update, delete on saving_goals  to anon;
grant select, insert, update, delete on shifts        to anon;
