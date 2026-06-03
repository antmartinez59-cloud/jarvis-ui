-- ╔══════════════════════════════════════════════════════════╗
-- ║  JARVIS Schema v10 — Mastery Run Resume + Depth Levels   ║
-- ║  Run in: Supabase → SQL Editor                           ║
-- ╚══════════════════════════════════════════════════════════╝

-- Add research_state to mastery_runs
-- Stores visited URLs, full notes, concepts so runs can be resumed
alter table mastery_runs
  add column if not exists research_state jsonb default null;

-- Add depth_level to agents
-- Tracks how many complete runs have been stacked on this topic
-- Depth 1 = first run, Depth 2 = second run building 