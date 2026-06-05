-- ╔══════════════════════════════════════════════════════════╗
-- ║  JARVIS Schema v11 — user_settings table                 ║
-- ║  Stores cross-device settings (voice profile, prefs)     ║
-- ║  Run in: Supabase → SQL Editor                           ║
-- ╚══════════════════════════════════════════════════════════╝

-- Generic key-value store for user settings
-- Used for: voice fingerprint profile, preferences, etc.
create table if not exists user_settings (
  key   text primary key,
  value text not null,
  updated_at timestamptz default now()
);

-- Auto-update timestamp on change
create or replace function update_user_settings_ts()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_settings_updated on user_settings;
create trigger user_settings_updated
  before update on user_settings
  for each row execute procedure update_user_settings_ts();
