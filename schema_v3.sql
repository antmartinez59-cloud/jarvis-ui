-- ╔══════════════════════════════════════════════════════════╗
-- ║  JARVIS schema_v3 — Automation Builder                  ║
-- ║  Run AFTER schema_v2.sql                                 ║
-- ║  Safe to re-run (IF NOT EXISTS throughout)              ║
-- ╚══════════════════════════════════════════════════════════╝

-- ── CUSTOM AUTOMATIONS ───────────────────────────────────────
-- Every automation you create via conversation lives here.
-- The automate Edge Function loads and runs these every 30 min.
create table if not exists custom_automations (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  name        text        not null,       -- "Vitamin reminder"
  description text,                       -- natural language summary
  enabled     boolean     default true,

  -- ── TRIGGER: when does this fire? ──────────────────────────
  -- type: 'schedule' | 'interval' | 'always'
  -- schedule: fires at specific CT times
  -- interval: fires every N hours (within waking hours)
  -- always: fires every cron cycle (use conditions to control)
  trigger     jsonb       not null default '{
    "type":    "schedule",
    "ct_hour": 8,
    "ct_minute": 0,
    "days": [0,1,2,3,4,5,6]
  }'::jsonb,
  -- days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  -- for interval: { "type": "interval", "every_hours": 2, "start_hour": 9, "end_hour": 21 }

  -- ── CONDITION: should it actually fire right now? ───────────
  -- type: 'always' | 'query_below' | 'query_above' | 'query_equals'
  -- query_*: runs a COUNT(*) query and compares to threshold
  -- example: { "type": "query_below", "table": "water_logs",
  --            "filter": "logged_at >= today", "threshold": 3 }
  condition   jsonb       default '{"type": "always"}'::jsonb,

  -- ── ACTION: what to send ────────────────────────────────────
  action      jsonb       not null default '{
    "sms":              "JARVIS reminder",
    "reminder_title":   "JARVIS reminder",
    "reminder_notes":   "",
    "priority":         "medium",
    "dedup_daily":      true,
    "dedup_key":        ""
  }'::jsonb,

  -- ── METADATA ────────────────────────────────────────────────
  created_by  text        default 'user',  -- 'user' | 'jarvis' (auto-created)
  fire_count  integer     default 0,       -- total times fired
  last_fired  timestamptz,
  tags        text[]      default '{}'     -- e.g. ['health', 'finance']
);

alter table custom_automations disable row level security;

-- ── AUTOMATION BUILDER CONVERSATIONS ────────────────────────
-- Stores the back-and-forth when building an automation
-- so JARVIS can resume if you stop mid-conversation
create table if not exists automation_sessions (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  status      text        default 'in_progress',  -- in_progress | complete | abandoned
  description text,                               -- Tony's original request
  questions   jsonb       default '[]'::jsonb,    -- Q&A pairs collected so far
  draft_rule  jsonb,                              -- partial rule being built
  result_id   uuid        references custom_automations(id)  -- filled when complete
);

alter table automation_sessions disable row level security;

-- ── SEED: a few example automations to show the format ──────
-- (disabled by default — enable in JARVIS UI)
insert into custom_automations (name, description, enabled, trigger, condition, action, created_by, tags)
values
  (
    'Morning vitamin reminder',
    'Remind Tony to take vitamins every morning at 8:30am',
    false,
    '{"type":"schedule","ct_hour":8,"ct_minute":30,"days":[0,1,2,3,4,5,6]}',
    '{"type":"always"}',
    '{"sms":"💊 Take your vitamins, Tony.","reminder_title":"Take vitamins","reminder_notes":"Daily habit — don''t skip.","priority":"medium","dedup_daily":true,"dedup_key":"vitamins"}',
    'jarvis',
    '["health"]'
  ),
  (
    'End of day shutdown',
    'Remind Tony to close work apps and log out at 6pm on weekdays',
    false,
    '{"type":"schedule","ct_hour":18,"ct_minute":0,"days":[1,2,3,4,5]}',
    '{"type":"always"}',
    '{"sms":"🔒 6pm — time to shut down and step away from work.","reminder_title":"Shut down for the day","reminder_notes":"Close work. Rest matters.","priority":"low","dedup_daily":true,"dedup_key":"shutdown"}',
    'jarvis',
    '["productivity"]'
  )
on conflict do nothing;

-- ── VIEW: active automations overview ───────────────────────
create or replace view active_automations as
  select
    id, name, description, enabled,
    trigger->>'type'                    as trigger_type,
    (trigger->>'ct_hour')::int          as ct_hour,
    (trigger->>'ct_minute')::int        as ct_minute,
    action->>'reminder_title'           as reminder_title,
    action->>'priority'                 as priority,
    fire_count,
    last_fired,
    tags,
    created_at
  from custom_automations
  where enabled = true
  order by (trigger->>'ct_hour')::int, (trigger->>'ct_minute')::int;
