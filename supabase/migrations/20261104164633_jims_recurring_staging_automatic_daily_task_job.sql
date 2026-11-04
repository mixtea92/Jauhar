-- Staging automatic recurring-task generation. No bank payment or PV creation.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;
-- Run daily 00:10 UTC = 08:10 in Malaysia; idempotent unique(instruction_id,period_month).
SELECT cron.schedule(
  'jims-recurring-ap-tasks-staging-v1',
  '10 0 * * *',
  'SELECT private.jims_recurring_generate_v1();'
);