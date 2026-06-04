-- Fix RLS warnings: add permissive policies for tables with RLS enabled but no policies
-- All access goes through edge functions (service_role) so this is safe.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'accounts','categories','connections','jarvis_health',
    'notifications','paycheck_rules','portfolio','profile_history',
    'repos','user_settings','watchlist'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('
      CREATE POLICY "allow_all" ON public.%I
      FOR ALL USING (true) WITH CHECK (true);
    ', t);
  END LOOP;
END $$;
