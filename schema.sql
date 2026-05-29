-- ╔══════════════════════════════════════════════════════════╗
-- ║         JARVIS v4 — Supabase Schema                     ║
-- ║  Paste this into: Supabase → SQL Editor → Run           ║
-- ╚══════════════════════════════════════════════════════════╝

-- ── USER PROFILE (single row, upserted on update) ──────────
create table if not exists profile (
  id         integer     primary key default 1,
  name       text        default 'Tony',
  traits     text[]      default '{}',
  priorities text[]      default '{}',
  projects   text[]      default '{}',
  preferences text[]     default '{}',
  patterns   text[]      default '{}',
  updated_at timestamptz default now()
);

-- ── COUNCIL CHAT SESSIONS ───────────────────────────────────
create table if not exists sessions (
  id         uuid        primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  question   text,
  response   text,
  summary    text
);

-- ── LEARNINGS (extracted from sessions via AI) ──────────────
create table if not exists learnings (
  id         uuid        primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  summary    text,
  question   text,
  projects   text[]      default '{}',
  priorities text[]      default '{}'
);

-- ── MASTERY ENGINE RUNS ─────────────────────────────────────
create table if not exists mastery_runs (
  id           uuid        primary key default gen_random_uuid(),
  topic        text        not null,
  started_at   timestamptz default now(),
  completed_at timestamptz,
  mastery_score  integer   default 0,
  sources_count  integer   default 0,
  gap_rounds     integer   default 0,
  status       text        default 'running',  -- running | complete | stopped
  concepts     text[]      default '{}'
);

-- ── MASTERY RESEARCH NOTES ──────────────────────────────────
create table if not exists mastery_notes (
  id           uuid        primary key default gen_random_uuid(),
  run_id       uuid        references mastery_runs(id) on delete cascade,
  created_at   timestamptz default now(),
  label        text,
  source_title text,
  source_url   text,
  summary      text,
  raw_text     text
);

-- ── AI AGENTS LIBRARY ───────────────────────────────────────
create table if not exists agents (
  id               uuid        primary key default gen_random_uuid(),
  created_at       timestamptz default now(),
  topic            text        not null,
  mastery_score    integer     default 0,
  sources_count    integer     default 0,
  concepts         text[]      default '{}',
  system_prompt    text,
  knowledge_summary text,
  run_id           uuid        references mastery_runs(id)
);

-- ── GITHUB REPOS ────────────────────────────────────────────
create table if not exists repos (
  id           text        primary key,   -- repo slug / short name
  name         text,
  url          text,
  description  text,
  language     text,
  stars        integer     default 0,
  last_updated timestamptz,
  topics       text[]      default '{}',
  status       text        default 'active',
  enabled      boolean     default true,
  synced_at    timestamptz default now()
);

-- ── DISABLE RLS (personal use — no auth required) ──────────
-- Enable + add policies later if you add multi-user support
alter table profile      disable row level security;
alter table sessions     disable row level security;
alter table learnings    disable row level security;
alter table mastery_runs disable row level security;
alter table mastery_notes disable row level security;
alter table agents       disable row level security;
alter table repos        disable row level security;

-- ── SEED: Profile ───────────────────────────────────────────
insert into profile (id, name)
values (1, 'Tony')
on conflict (id) do nothing;

-- ── SEED: Repos from antmartinez59-cloud ────────────────────
insert into repos (id, name, url, description, status) values
  ('agents',         'Claude Agents',         'https://github.com/antmartinez59-cloud/agents',                 'Plugin marketplace for Claude Code',          'active'),
  ('playwright-mcp', 'Playwright MCP',         'https://github.com/antmartinez59-cloud/playwright-mcp',         'Browser automation MCP server',               'active'),
  ('squad',          'Claude Squad',           'https://github.com/antmartinez59-cloud/claude-squad',           'Multi-agent terminal orchestrator',           'active'),
  ('subconscious',   'Claude Subconscious',    'https://github.com/antmartinez59-cloud/claude-subconscious',    'Persistent memory plugin',                    'active'),
  ('repomix',        'Repomix',                'https://github.com/antmartinez59-cloud/repomix',                'Pack repos into AI-friendly files',           'active'),
  ('tdd-guard',      'TDD Guard',              'https://github.com/antmartinez59-cloud/tdd-guard',              'Test-driven development enforcer',            'active'),
  ('superpowers',    'Superpowers',            'https://github.com/antmartinez59-cloud/superpowers',            'Extended capabilities plugin',                'active'),
  ('karpathy-skills','Karpathy Skills',        'https://github.com/antmartinez59-cloud/andrej-karpathy-skills', 'Andrej Karpathy AI skills for Claude',        'active'),
  ('awesome',        'Awesome Claude Code',    'https://github.com/antmartinez59-cloud/awesome-claude-code',    'Curated Claude Code resources',               'active'),
  ('ecc',            'ECC',                    'https://github.com/antmartinez59-cloud/ECC',                    'External Claude Connector',                   'active')
on conflict (id) do nothing;

-- ── CONNECTIONS (MCPs, APIs, ORMs, Integrations) ────────────
-- Central registry: every external system JARVIS talks to
create table if not exists connections (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  name        text        not null,
  type        text        not null,  -- 'mcp' | 'api' | 'orm' | 'integration' | 'tool'
  endpoint    text,                  -- URL or host
  description text,
  is_active   boolean     default true,
  config      jsonb       default '{}',  -- non-sensitive config (no secrets)
  last_used   timestamptz
);

alter table connections disable row level security;

-- Seed with all the integrations JARVIS already uses
insert into connections (name, type, endpoint, description, is_active) values
  ('Anthropic API',    'api',         'https://api.anthropic.com',              'Claude AI — Haiku + Sonnet models. Key stored in Settings.', true),
  ('Supabase',         'orm',         null,                                     'PostgreSQL ORM — all persistent data flows through here.',   true),
  ('DuckDuckGo',       'api',         'https://api.duckduckgo.com',             'Web search — no API key required.',                          true),
  ('GitHub API',       'api',         'https://api.github.com',                 'Public repo sync for antmartinez59-cloud.',                  true),
  ('Obsidian',         'integration', null,                                     'Local markdown vault writer. Set vault path in Settings.',   false),
  ('JARVIS Server',    'tool',        'http://localhost:8080',                  'Local Python server — proxy, search, browse, obsidian.',     true),
  ('Playwright MCP',   'mcp',         null,                                     'Browser automation MCP — install via claude install.',       false),
  ('Claude Subcon.',   'mcp',         null,                                     'Persistent memory plugin for Claude Code.',                  false)
on conflict do nothing;

-- ── USEFUL VIEWS ────────────────────────────────────────────

-- Recent activity overview
create or replace view recent_activity as
  select 'session'  as type, summary as label, created_at from sessions
  union all
  select 'learning' as type, summary as label, created_at from learnings
  union all
  select 'agent'    as type, topic   as label, created_at from agents
  union all
  select 'mastery'  as type, topic   as label, started_at from mastery_runs
  order by created_at desc
  limit 50;

-- Agent library with run details
create or replace view agent_library as
  select
    a.id, a.topic, a.mastery_score, a.sources_count,
    a.concepts, a.created_at,
    r.gap_rounds, r.started_at as run_started
  from agents a
  left join mastery_runs r on r.id = a.run_id
  order by a.created_at desc;
