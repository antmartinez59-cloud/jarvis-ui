-- ╔══════════════════════════════════════════════════════════╗
-- ║  JARVIS schema_v7 — Debug Agent Tables                  ║
-- ║  Run in Supabase → SQL Editor                           ║
-- ║  Safe to re-run                                         ║
-- ╚══════════════════════════════════════════════════════════╝

-- ── jarvis_errors: every caught error from frontend + edge fns ──
create table if not exists jarvis_errors (
  id           uuid        primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  source       text,        -- 'frontend' | 'edge:morning-brief' | 'edge:weather' etc
  error_type   text,        -- 'supabase_query' | 'network' | 'js_runtime' | 'edge_fn' etc
  message      text,
  stack        text,
  context      jsonb,       -- { tab: 'finance', action: 'logShift', userId: ... }
  url          text,        -- page URL (frontend errors)
  resolved     boolean      default false,
  resolution   text         -- notes on how it was fixed
);

-- ── jarvis_health: nightly debug-agent analysis reports ──────────
create table if not exists jarvis_health (
  id             uuid        primary key default gen_random_uuid(),
  created_at     timestamptz default now(),
  report_date    date        default current_date,
  error_count    integer     default 0,
  unique_issues  integer     default 0,
  top_issues     jsonb,      -- array of { source, message, count, severity }
  claude_analysis text,      -- Claude's plain-English diagnosis
  suggested_fixes jsonb,     -- array of { issue, fix, priority, file }
  status         text        default 'analyzed'  -- 'analyzed' | 'clean'
);

-- ── Disable RLS + grant anon access ─────────────────────────────
alter table jarvis_errors  disable row level security;
alter table jarvis_health  disable row level security;

grant select, insert, update, delete on jarvis_errors  to anon;
grant select, insert, update, delete on jarvis_health  to anon;

-- ── Index for fast recent-error lookups ─────────────────────────
create index if not exists idx_jarvis_errors_created  on jarvis_errors(created_at desc);
create index if not exists idx_jarvis_errors_source   on jarvis_errors(source);
create index if not exists idx_jarvis_errors_resolved on jarvis_errors(resolved) where resolved = false;
create index if not exists idx_jarvis_health_date     on jarvis_health(report_date desc);
