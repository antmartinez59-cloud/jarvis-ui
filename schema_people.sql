-- JARVIS People Tab Schema
-- Run in Supabase SQL Editor

-- Core people table
CREATE TABLE IF NOT EXISTS people (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,                          -- display name
  contact_name TEXT,                           -- actual name in phone/iCloud
  relationship_type TEXT DEFAULT 'friend',     -- family, best_friend, close_friend, professional
  phone TEXT,
  email TEXT,
  birthday DATE,
  last_contacted DATE,
  photo_url TEXT,
  notes TEXT,
  is_core_circle BOOLEAN DEFAULT false,
  is_tia_vault BOOLEAN DEFAULT false,          -- Tia only, separate encrypted access
  icloud_uid TEXT,                             -- links to iCloud contact for sync
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shared history / memory notes per person
CREATE TABLE IF NOT EXISTS people_history (
  id SERIAL PRIMARY KEY,
  person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tia's Vault — encrypted separately
CREATE TABLE IF NOT EXISTS tia_vault (
  id SERIAL PRIMARY KEY,
  category TEXT DEFAULT 'note',               -- note, date, feeling, plan
  content TEXT NOT NULL,                      -- stored as-is (RLS + app-level access control)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed core circle
INSERT INTO people (name, contact_name, relationship_type, is_core_circle) VALUES
  ('Bryce',   '🥪🥪 Unseasoned Bryce 🍗🍗 (THE OPP)', 'best_friend',   true),
  ('Jacob',   'Jacob M',                               'best_friend',   true),
  ('Mom',     'Mom',                                   'family',        true),
  ('Dad',     'Dad',                                   'family',        true),
  ('Logan',   'Logan',                                 'close_friend',  true),
  ('Gavin',   'Gavin',                                 'close_friend',  true),
  ('Cash',    'Cash',                                  'close_friend',  true),
  ('Christian','Christian',                            'close_friend',  true),
  ('Spencer', 'Spencer',                               'close_friend',  true),
  ('Tia',     'Tia',                                   'special',       true)
ON CONFLICT DO NOTHING;
