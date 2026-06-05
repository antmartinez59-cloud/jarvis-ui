-- ╔══════════════════════════════════════════════════════════╗
-- ║  JARVIS schema_v9 — Todos + Reminders                   ║
-- ║  Run in Supabase → SQL Editor                           ║
-- ║  Safe to re-run                                         ║
-- ╚══════════════════════════════════════════════════════════╝

-- ── todos ─────────────────────────────────────────────────────────────────────
create table if not exists todos (
  id           uuid        primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  title        text        not null,
  notes        text,
  priority     text        default 'medium',   -- urgent | high | medium | low
  is_starred   boolean     default false,
  due_date     date        default current_date,
  completed    boolean     default false,
  completed_at timestamptz,
  moved_date   date,                           -- date it was rolled over to
  roll_count   integer     default 0,          -- how many times rolled over
  status       text        default 'active',   -- active | completed | moved | archived
  archived_at  timestamptz
);

-- ── reminders ─────────────────────────────────────────────────────────────────
create table if not exists reminders (
  id             uuid        primary key default gen_random_uuid(),
  created_at     timestamptz default now(),
  title          text        not null,
  notes          text,
  remind_at      timestamptz not null,
  repeat_rule    text,                        -- daily | weekly | none
  linked_todo_id uuid        references todos(id) on delete set null,
  sent           boolean     default false,
  dismissed      boolean     default false
);

-- ── Disable RLS + grant anon access ──────────────────────────────────────────
alter table todos     disable row level security;
alter table reminders disable row level security;

grant select, insert, update, delete on todos     to anon;
grant select, insert, update, delete on reminders to anon;

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists idx_todos_status    on todos(status);
create index if not exists idx_todos_due_date  on todos(due_date);
create index if not exists idx_todos_starred   on todos(is_starred) where is_starred = true;
create index if not exists idx_reminders_time  on reminders(remind_at) where sent = false;
