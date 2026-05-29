-- ╔══════════════════════════════════════════════════════════╗
-- ║  JARVIS schema_v4 — Workout Data Columns                ║
-- ║  Run AFTER schema_v2.sql                                 ║
-- ║  Safe to re-run (IF NOT EXISTS / IF COLUMN NOT EXISTS)  ║
-- ╚══════════════════════════════════════════════════════════╝

-- The JARVIS Today tab stores exercises and cardio as JSON blobs
-- directly on the workout row (faster reads, no joins needed).
-- These two columns were missing from schema_v2.sql.

alter table workouts add column if not exists exercises jsonb;
alter table workouts add column if not exists cardio    jsonb;
