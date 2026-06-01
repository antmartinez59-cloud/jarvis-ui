-- ╔══════════════════════════════════════════════════════════╗
-- ║  JARVIS schema_v8 — Paycheck Splitter Tables             ║
-- ║  Run in Supabase → SQL Editor                           ║
-- ║  Safe to re-run                                         ║
-- ╚══════════════════════════════════════════════════════════╝

-- ── paychecks: every logged paycheck ─────────────────────────────────────────
create table if not exists paychecks (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz default now(),
  date            date        not null default current_date,
  amount          numeric(10,2) not null,
  source          text        default 'work',   -- 'work' | 'freelance' | 'other'
  notes           text,
  auto_detected   boolean     default false,    -- true if flagged from a transaction
  split_snapshot  jsonb       -- snapshot of allocation rules at time of logging
                              -- { bills_pct, spending_pct, savings_pct, investing_pct,
                              --   bills_amt, spending_amt, savings_amt, investing_amt }
);

-- ── paycheck_allocation: current + learned split rules ────────────────────────
-- Single row (id=1). synthesize updates learned_* columns over time.
create table if not exists paycheck_allocation (
  id                    integer     primary key default 1,

  -- Active percentages (start 50/30/15/5, must sum to 100)
  bills_pct             numeric(5,2) default 50,
  spending_pct          numeric(5,2) default 30,
  savings_pct           numeric(5,2) default 15,
  investing_pct         numeric(5,2) default 5,

  -- JARVIS-learned suggestions (updated by synthesize Edge Function)
  learned_bills_pct     numeric(5,2),
  learned_spending_pct  numeric(5,2),
  learned_savings_pct   numeric(5,2),
  learned_investing_pct numeric(5,2),
  use_learned           boolean      default false,  -- flip to true when ready

  -- How savings % is split across specific goals
  -- [{ goal_id: uuid, goal_name: text, pct: number }]
  savings_goal_splits   jsonb,

  -- Learning metadata
  data_weeks            integer      default 0,
  last_learned_at       timestamptz,
  updated_at            timestamptz  default now()
);

-- Seed default row if not exists
insert into paycheck_allocation (id)
values (1)
on conflict (id) do nothing;

-- ── Disable RLS + grant anon access ─────────────────────────────────────────
alter table paychecks            disable row level security;
alter table paycheck_allocation  disable row level security;

grant select, insert, update, delete on paychecks           to anon;
grant select, insert, update, delete on paycheck_allocation to anon;

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_paychecks_date on paychecks(date desc);
