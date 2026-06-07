-- People tab schema fixes
-- Run in Supabase SQL Editor

-- Add unique constraint on icloud_uid so sync dedup works
ALTER TABLE people ADD CONSTRAINT people_icloud_uid_unique UNIQUE (icloud_uid);

-- Make icloud_uid null for empty strings (so constraint doesn't block null rows)
UPDATE people SET icloud_uid = NULL WHERE icloud_uid = '';
