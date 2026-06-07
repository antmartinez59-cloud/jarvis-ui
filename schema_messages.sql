-- JARVIS Messaging Schema
-- Run in Supabase SQL Editor

-- Outbound message drafts + sent log
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'draft',     -- draft, approved, sent, failed
  method TEXT DEFAULT 'twilio',    -- twilio, shortcut
  twilio_sid TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

-- Inbound SMS from Tony via Twilio (two-way interface)
CREATE TABLE IF NOT EXISTS sms_inbox (
  id SERIAL PRIMARY KEY,
  from_number TEXT,
  body TEXT,
  jarvis_reply TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow anon key access
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON sms_inbox FOR ALL USING (true) WITH CHECK (true);
