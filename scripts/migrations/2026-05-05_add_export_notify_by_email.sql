-- =============================================
-- export_jobs.notify_by_email: opt-in email flag
-- =============================================
-- Adds a `notify_by_email` boolean to export_jobs. The worker only fires
-- the SendGrid "ready" / "failed" emails when this flag is TRUE; the
-- recent-exports table + ExportsBanner are the default notification
-- surfaces for everyone (admin + customer).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DEFAULT FALSE so existing rows
-- backfill to "no email" — matches the new opt-in product behavior.

ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS notify_by_email BOOLEAN NOT NULL DEFAULT FALSE;

-- Verification
SELECT 'export_jobs.notify_by_email added/verified' AS result;

SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'export_jobs'
  AND column_name = 'notify_by_email';

SELECT notify_by_email, COUNT(*) AS job_count
FROM export_jobs
GROUP BY notify_by_email
ORDER BY notify_by_email;
