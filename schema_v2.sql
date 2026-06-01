-- ╔══════════════════════════════════════════════════════════════╗
-- ║         JARVIS v5 — Schema Expansion                        ║
-- ║                                                              ║
-- ║  Run AFTER schema.sql (v4). Adds all Layer 1-10 tables.     ║
-- ║  Safe to re-run — uses IF NOT EXISTS throughout.            ║
-- ║                                                              ║
-- ║  Paste into: Supabase → SQL Editor → Run                    ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════
-- PROFILE HISTORY (Memory Synthesis versions)
-- Every night at midnight CT, synthesize creates a new version.
-- Full history kept forever — never deleted.
-- ═══════════════════════════════════════════════════════════════
create table if not exists profile_history (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  version_date  date        default current_date,
  traits        text[]      default '{}',
  priorities    text[]      default '{}',
  projects      text[]      default '{}',
  preferences   text[]      default '{}',
  patterns      text[]      default '{}',
  goals         text[]      default '{}',
  money_mindset text[]      default '{}',
  decision_style text,
  synthesis_summary text,   -- Claude's written summary of who Tony is that night
  learnings_count integer   default 0,
  significant_insight text, -- if something notable was found, stored here
  notified      boolean     default false
);

-- Expand base profile table with richer fields
alter table profile add column if not exists goals         text[]  default '{}';
alter table profile add column if not exists money_mindset text[]  default '{}';
alter table profile add column if not exists decision_style text;
alter table profile add column if not exists synthesis_summary text;
alter table profile add column if not exists last_synthesized_at timestamptz;

-- ═══════════════════════════════════════════════════════════════
-- BRIEFINGS (5 per day — 7am, noon, 4pm, 9pm, 11:45pm CT)
-- ═══════════════════════════════════════════════════════════════
create table if not exists briefings (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  briefing_type text        not null,  -- 'morning' | 'midday' | 'afternoon' | 'evening' | 'presynthesis'
  content       text,                  -- full briefing text Claude wrote
  weather_data  jsonb       default '{}',
  news_data     jsonb       default '{}',
  email_sent    boolean     default false,
  sms_sent      boolean     default false,
  opened        boolean     default false,
  date          date        default current_date
);

-- ═══════════════════════════════════════════════════════════════
-- USER SETTINGS (key-value store for all preferences)
-- ═══════════════════════════════════════════════════════════════
create table if not exists user_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz default now()
);

-- Seed default settings
insert into user_settings (key, value) values
  ('briefing_time_morning',     '07:00'),
  ('briefing_time_midday',      '12:00'),
  ('briefing_time_afternoon',   '16:00'),
  ('briefing_time_evening',     '21:00'),
  ('briefing_time_presynthesis','23:45'),
  ('timezone',                  'America/Chicago'),
  ('location_city',             'Prosper'),
  ('location_state',            'TX'),
  ('location_zip',              '76227'),
  ('location_lat',              '33.2362'),
  ('location_lon',              '-96.8025'),
  ('events_radius_miles',       'ask'),
  ('water_goal_oz',             '80'),
  ('water_unit_default',        'oz'),
  ('weight_unit',               'lbs'),
  ('body_weight_lbs',           '130'),
  ('bulk_target_lbs',           '150'),
  ('workout_days_per_week',     '4'),
  ('sport_teams',               'Cowboys,Mavericks,Rangers'),
  ('news_topics',               'finance,tech,sports,headlines'),
  ('email_briefings',           'antmartinez59@gmail.com'),
  ('sms_briefings',             'true'),
  ('synthesis_run_time',        '00:00'),
  ('currency',                  'USD')
on conflict (key) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- FINANCE — ACCOUNTS
-- ═══════════════════════════════════════════════════════════════
create table if not exists accounts (
  id           uuid        primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  name         text        not null,
  type         text        not null,  -- 'checking' | 'savings' | 'credit' | 'investment' | 'cash'
  institution  text,
  balance      numeric(12,2) default 0,
  last_updated timestamptz default now(),
  is_active    boolean     default true,
  notes        text
);

-- ═══════════════════════════════════════════════════════════════
-- FINANCE — TRANSACTION CATEGORIES
-- ═══════════════════════════════════════════════════════════════
create table if not exists categories (
  id         uuid    primary key default gen_random_uuid(),
  name       text    not null unique,
  color      text    default '#7c6fff',
  icon       text    default '💰',
  type       text    default 'expense',  -- 'expense' | 'income' | 'transfer'
  archived   boolean default false,
  sort_order integer default 0
);

insert into categories (name, color, icon, type, sort_order) values
  ('Housing',      '#ff5c87', '🏠', 'expense',  1),
  ('Food',         '#ffaa44', '🍔', 'expense',  2),
  ('Groceries',    '#ffaa44', '🛒', 'expense',  3),
  ('Transport',    '#7c6fff', '🚗', 'expense',  4),
  ('Gas',          '#7c6fff', '⛽', 'expense',  5),
  ('Health',       '#44e87a', '💊', 'expense',  6),
  ('Fitness',      '#44e87a', '💪', 'expense',  7),
  ('Entertainment','#00d9b4', '🎮', 'expense',  8),
  ('Clothing',     '#ff5c87', '👕', 'expense',  9),
  ('Personal Care','#ff5c87', '✂️', 'expense', 10),
  ('Subscriptions','#7c6fff', '📱', 'expense', 11),
  ('Education',    '#00d9b4', '📚', 'expense', 12),
  ('Travel',       '#ffaa44', '✈️', 'expense', 13),
  ('Dining Out',   '#ffaa44', '🍽️', 'expense', 14),
  ('Gifts',        '#ff5c87', '🎁', 'expense', 15),
  ('Savings',      '#44e87a', '🏦', 'transfer', 16),
  ('Investment',   '#44e87a', '📈', 'transfer', 17),
  ('Income',       '#44e87a', '💵', 'income',  18),
  ('Side Income',  '#44e87a', '💸', 'income',  19),
  ('Other',        '#7777aa', '📦', 'expense', 20)
on conflict (name) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- FINANCE — TRANSACTIONS
-- ═══════════════════════════════════════════════════════════════
create table if not exists transactions (
  id           uuid        primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  date         date        not null default current_date,
  amount       numeric(12,2) not null,
  type         text        not null default 'expense',  -- 'income' | 'expense' | 'transfer'
  category_id  uuid        references categories(id),
  account_id   uuid        references accounts(id),
  description  text,
  merchant     text,
  notes        text,
  is_recurring boolean     default false,
  import_source text                                    -- 'manual' | 'csv' | 'plaid'
);

-- ═══════════════════════════════════════════════════════════════
-- FINANCE — SAVING GOALS
-- ═══════════════════════════════════════════════════════════════
create table if not exists saving_goals (
  id             uuid        primary key default gen_random_uuid(),
  created_at     timestamptz default now(),
  name           text        not null,
  target_amount  numeric(12,2) not null,
  current_amount numeric(12,2) default 0,
  deadline       date,
  category       text,
  notes          text,
  is_complete    boolean     default false,
  color          text        default '#44e87a'
);

-- ═══════════════════════════════════════════════════════════════
-- FINANCE — SUBSCRIPTIONS
-- ═══════════════════════════════════════════════════════════════
create table if not exists subscriptions (
  id             uuid        primary key default gen_random_uuid(),
  created_at     timestamptz default now(),
  name           text        not null,
  amount         numeric(10,2) not null,
  billing_cycle  text        default 'monthly',  -- 'monthly' | 'yearly' | 'weekly'
  next_renewal   date,
  category_id    uuid        references categories(id),
  account_id     uuid        references accounts(id),
  is_active      boolean     default true,
  archived       boolean     default false,
  notes          text,
  url            text
);

-- ═══════════════════════════════════════════════════════════════
-- FINANCE — WORK SHIFTS + PAYCHECK RULES
-- ═══════════════════════════════════════════════════════════════
create table if not exists shifts (
  id             uuid        primary key default gen_random_uuid(),
  created_at     timestamptz default now(),
  date           date        not null default current_date,
  start_time     time,
  end_time       time,
  duration_hours numeric(5,2),
  hourly_rate    numeric(8,2),
  gross_pay      numeric(10,2),
  notes          text,
  location       text
);

create table if not exists paycheck_rules (
  id          uuid    primary key default gen_random_uuid(),
  label       text    not null,   -- e.g. 'Bills', 'Savings', 'Spending'
  type        text    default 'percentage',  -- 'percentage' | 'fixed'
  amount      numeric(10,2),      -- % or dollar amount
  sort_order  integer default 0,
  color       text    default '#7c6fff'
);

-- ═══════════════════════════════════════════════════════════════
-- HEALTH — WATER INTAKE
-- ═══════════════════════════════════════════════════════════════
create table if not exists water_logs (
  id         uuid        primary key default gen_random_uuid(),
  logged_at  timestamptz default now(),
  date       date        default current_date,
  amount_oz  numeric(6,1) not null,
  unit_label text        default 'oz',   -- 'oz' | 'cup' | 'bottle_16' | 'bottle_32' | 'ml'
  note       text
);

-- ═══════════════════════════════════════════════════════════════
-- HEALTH — SLEEP
-- ═══════════════════════════════════════════════════════════════
create table if not exists sleep_logs (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz default now(),
  date            date        not null default current_date,
  bedtime         timestamptz,
  wake_time       timestamptz,
  duration_hours  numeric(4,2),
  quality_rating  integer,    -- 1-5
  notes           text
);

-- ═══════════════════════════════════════════════════════════════
-- HEALTH — BODY STATS
-- ═══════════════════════════════════════════════════════════════
create table if not exists body_stats (
  id           uuid        primary key default gen_random_uuid(),
  logged_at    timestamptz default now(),
  date         date        default current_date,
  weight_lbs   numeric(5,1),
  body_fat_pct numeric(4,1),
  notes        text
);

-- ═══════════════════════════════════════════════════════════════
-- HEALTH — WORKOUTS + EXERCISES
-- ═══════════════════════════════════════════════════════════════
create table if not exists workouts (
  id               uuid        primary key default gen_random_uuid(),
  created_at       timestamptz default now(),
  date             date        not null default current_date,
  name             text,       -- e.g. 'Chest Day', 'Push Day'
  type             text,       -- 'strength' | 'cardio' | 'hiit' | 'flexibility' | 'sports'
  duration_mins    integer,
  muscles_targeted text[]      default '{}',
  notes            text,
  calories_burned  integer
);

create table if not exists exercises (
  id          uuid    primary key default gen_random_uuid(),
  workout_id  uuid    references workouts(id) on delete cascade,
  name        text    not null,
  sets        integer,
  reps        integer,
  weight_lbs  numeric(6,1),
  duration_secs integer,       -- for timed exercises
  notes       text,
  sort_order  integer default 0
);

-- ═══════════════════════════════════════════════════════════════
-- HEALTH — MEALS + NUTRITION
-- ═══════════════════════════════════════════════════════════════
create table if not exists meals (
  id           uuid        primary key default gen_random_uuid(),
  logged_at    timestamptz default now(),
  date         date        default current_date,
  meal_type    text        default 'snack',  -- 'breakfast' | 'lunch' | 'dinner' | 'snack'
  name         text        not null,
  calories     integer,
  protein_g    numeric(6,1),
  carbs_g      numeric(6,1),
  fat_g        numeric(6,1),
  fiber_g      numeric(6,1),
  serving_size text,
  notes        text,
  photo_logged boolean     default false
);

-- ═══════════════════════════════════════════════════════════════
-- HABITS — TODOS + REMINDERS
-- ═══════════════════════════════════════════════════════════════
create table if not exists todos (
  id           uuid        primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  title        text        not null,
  notes        text,
  priority     text        default 'medium',  -- 'urgent' | 'high' | 'medium' | 'low'
  is_starred   boolean     default false,
  due_date     date,
  completed_at timestamptz,
  moved_dates  date[]      default '{}',      -- history of move-to-tomorrow actions
  status       text        default 'active',  -- 'active' | 'completed' | 'moved' | 'archived'
  category     text
);

create table if not exists reminders (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz default now(),
  title           text        not null,
  notes           text,
  remind_at       timestamptz not null,
  repeat_rule     text,       -- 'daily' | 'weekly' | 'monthly' | null
  linked_todo_id  uuid        references todos(id),
  sent            boolean     default false,
  sms_sent        boolean     default false
);

-- ═══════════════════════════════════════════════════════════════
-- STOCKS — PORTFOLIO + WATCHLIST
-- ═══════════════════════════════════════════════════════════════
create table if not exists portfolio (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz default now(),
  ticker          text        not null unique,
  shares          numeric(12,4),
  avg_buy_price   numeric(12,4),
  current_price   numeric(12,4),
  last_price_update timestamptz,
  notes           text
);

create table if not exists watchlist (
  id           uuid    primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  ticker       text    not null unique,
  notes        text,
  alert_price  numeric(12,4),
  alert_type   text    -- 'above' | 'below'
);

-- ═══════════════════════════════════════════════════════════════
-- NOTIFICATIONS LOG
-- ═══════════════════════════════════════════════════════════════
create table if not exists notifications (
  id           uuid        primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  type         text,       -- 'sms' | 'email' | 'dashboard'
  title        text,
  body         text,
  delivered    boolean     default false,
  read         boolean     default false,
  source       text        -- 'synthesis' | 'briefing' | 'reminder' | 'alert'
);

-- ═══════════════════════════════════════════════════════════════
-- DISABLE RLS ON ALL NEW TABLES (personal use)
-- ═══════════════════════════════════════════════════════════════
alter table profile_history  disable row level security;
alter table briefings        disable row level security;
alter table user_settings    disable row level security;
alter table accounts         disable row level security;
alter table categories       disable row level security;
alter table transactions     disable row level security;
alter table saving_goals     disable row level security;
alter table subscriptions    disable row level security;
alter table shifts           disable row level security;
alter table paycheck_rules   disable row level security;
alter table water_logs       disable row level security;
alter table sleep_logs       disable row level security;
alter table body_stats       disable row level security;
alter table workouts         disable row level security;
alter table exercises        disable row level security;
alter table meals            disable row level security;
alter table todos            disable row level security;
alter table reminders        disable row level security;
alter table portfolio        disable row level security;
alter table watchlist        disable row level security;
alter table notifications    disable row level security;

-- ═══════════════════════════════════════════════════════════════
-- GRANT ANON ACCESS — required for frontend to read/write
-- RLS disabled is not enough — anon role needs explicit grants
-- ═══════════════════════════════════════════════════════════════
grant select, insert, update, delete on agents          to anon;
grant select, insert, update, delete on mastery_runs    to anon;
grant select, insert, update, delete on mastery_notes   to anon;
grant select, insert, update, delete on profile_history to anon;
grant select, insert, update, delete on briefings       to anon;
grant select, insert, update, delete on learnings       to anon;
grant select, insert, update, delete on sessions        to anon;
grant select, insert, update, delete on profile         to anon;
grant select, insert, update, delete on transactions    to anon;
grant select, insert, update, delete on water_logs      to anon;
grant select, insert, update, delete on sleep_logs      to anon;
grant select, insert, update, delete on workouts        to anon;
grant select, insert, update, delete on exercises       to anon;
grant select, insert, update, delete on meals           to anon;
grant select, insert, update, delete on todos           to anon;
grant select, insert, update, delete on reminders       to anon;
grant select, insert, update, delete on saving_goals    to anon;
grant select, insert, update, delete on subscriptions   to anon;
grant select, insert, update, delete on shifts          to anon;
grant select, insert, update, delete on pay_config      to anon;
grant select, insert, update, delete on paychecks       to anon;
grant select, insert, update, delete on paycheck_allocation to anon;
grant select, insert, update, delete on body_stats      to anon;
grant select, insert, update, delete on portfolio       to anon;
grant select, insert, update, delete on watchlist       to anon;
grant select, insert, update, delete on repos           to anon;
grant select, insert, update, delete on connections     to anon;
grant select, insert, update, delete on jarvis_errors   to anon;
grant select, insert, update, delete on notifications   to anon;

-- ═══════════════════════════════════════════════════════════════
-- ENABLE pg_cron EXTENSION (for scheduled jobs)
-- NOTE: Must be enabled in Supabase dashboard first:
--   Database → Extensions → search "pg_cron" → Enable
-- ═══════════════════════════════════════════════════════════════
-- create extension if not exists pg_cron;  -- uncomment after enabling in dashboard

-- ═══════════════════════════════════════════════════════════════
-- SCHEDULED JOBS (run AFTER enabling pg_cron extension above)
-- These call your Edge Functions on a schedule.
-- YOUR_PROJECT_REF = your Supabase project reference ID
-- YOUR_ANON_KEY    = your Supabase anon public key
-- ═══════════════════════════════════════════════════════════════

-- Midnight CT = 06:00 UTC — Memory Synthesis
-- select cron.schedule(
--   'nightly-synthesis',
--   '0 6 * * *',
--   $$
--     select net.http_post(
--       url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/synthesize',
--       headers := '{"Authorization": "Bearer YOUR_ANON_KEY", "Content-Type": "application/json"}'::jsonb,
--       body := '{}'::jsonb
--     );
--   $$
-- );

-- 7am CT = 13:00 UTC — Morning Briefing
-- select cron.schedule('brief-morning',     '0 13 * * *', $$ select net.http_post(url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/morning-brief', headers := '{"Authorization":"Bearer YOUR_ANON_KEY","Content-Type":"application/json"}'::jsonb, body := '{"type":"morning"}'::jsonb); $$);

-- 12pm CT = 18:00 UTC — Midday Briefing
-- select cron.schedule('brief-midday',      '0 18 * * *', $$ select net.http_post(url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/morning-brief', headers := '{"Authorization":"Bearer YOUR_ANON_KEY","Content-Type":"application/json"}'::jsonb, body := '{"type":"midday"}'::jsonb); $$);

-- 4pm CT = 22:00 UTC — Afternoon Briefing
-- select cron.schedule('brief-afternoon',   '0 22 * * *', $$ select net.http_post(url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/morning-brief', headers := '{"Authorization":"Bearer YOUR_ANON_KEY","Content-Type":"application/json"}'::jsonb, body := '{"type":"afternoon"}'::jsonb); $$);

-- 9pm CT = 03:00 UTC next day — Evening Briefing
-- select cron.schedule('brief-evening',     '0 3 * * *',  $$ select net.http_post(url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/morning-brief', headers := '{"Authorization":"Bearer YOUR_ANON_KEY","Content-Type":"application/json"}'::jsonb, body := '{"type":"evening"}'::jsonb); $$);

-- 11:45pm CT = 05:45 UTC — Pre-Synthesis Briefing
-- select cron.schedule('brief-presynthesis','45 5 * * *', $$ select net.http_post(url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/morning-brief', headers := '{"Authorization":"Bearer YOUR_ANON_KEY","Content-Type":"application/json"}'::jsonb, body := '{"type":"presynthesis"}'::jsonb); $$);

-- ═══════════════════════════════════════════════════════════════
-- USEFUL VIEWS
-- ═══════════════════════════════════════════════════════════════

-- Today's health summary
create or replace view today_health as
  select
    coalesce((select sum(amount_oz) from water_logs where date = current_date), 0) as water_oz_today,
    (select value::numeric from user_settings where key = 'water_goal_oz') as water_goal_oz,
    (select duration_hours from sleep_logs where date = current_date order by created_at desc limit 1) as sleep_hours_last,
    (select quality_rating from sleep_logs where date = current_date order by created_at desc limit 1) as sleep_quality,
    (select count(*) from workouts where date = current_date) as workouts_today,
    coalesce((select sum(calories) from meals where date = current_date), 0) as calories_today;

-- This month's finance summary
create or replace view month_finance as
  select
    coalesce(sum(case when type='expense' then amount else 0 end), 0) as total_spent,
    coalesce(sum(case when type='income'  then amount else 0 end), 0) as total_earned,
    coalesce(sum(case when type='transfer' and description ilike '%sav%' then amount else 0 end), 0) as total_saved,
    count(*) as transaction_count
  from transactions
  where date >= date_trunc('month', current_date);

-- Active todos by priority
create or replace view active_todos as
  select * from todos
  where status = 'active'
  order by
    case priority
      when 'urgent' then 1
      when 'high'   then 2
      when 'medium' then 3
      when 'low'    then 4
    end,
    is_starred desc,
    due_date asc nulls last;
