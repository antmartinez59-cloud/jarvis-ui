-- ╔══════════════════════════════════════════════════════════╗
-- ║  JARVIS schema_v5 — Finance Tab Column Patches          ║
-- ║  Run AFTER schema_v2.sql                                 ║
-- ║  Safe to re-run (IF NOT EXISTS / IF COLUMN NOT EXISTS)  ║
-- ╚══════════════════════════════════════════════════════════╝

-- ── transactions: add plain text category column ────────────
alter table transactions add column if not exists category text;

-- ── subscriptions: add plain text category column ───────────
alter table subscriptions add column if not exists category text;

-- ── pay_config: hourly pay + tax configuration ──────────────
-- (paycheck_rules is a different table — split percentages)
-- This is the single-row config for JARVIS shift pay calc.
create table if not exists pay_config (
  id           integer     primary key default 1,
  hourly_rate  numeric(8,2) default 0,
  ot_threshold integer      default 40,
  ot_multiplier numeric(4,2) default 1.5,
  tax_rate     numeric(5,2) default 0,    -- percentage, e.g. 22.0
  deductions   numeric(10,2) default 0,   -- fixed per-paycheck deductions
  updated_at   timestamptz  default now()
);

alter table pay_config disable row level security;

-- Seed empty config row
insert into pay_config (id) values (1) on conflict (id) do nothing;
