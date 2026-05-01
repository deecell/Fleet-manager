-- =============================================
-- export_jobs.kind: dispatch column for export worker
-- =============================================
-- Adds a `kind` column to export_jobs so the worker can branch between
-- 'snapshot' (current customer fleet snapshot), 'historical' (per-truck
-- time-series, when shipped), and 'admin_devices' (Task #5 admin export).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DEFAULT 'snapshot' so existing
-- rows backfill safely. The worker's pre-existing `historical_mode` branch
-- still wins for legacy rows where historical_mode = true, so we don't need
-- to retroactively rewrite the kind for those rows.

ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'snapshot';

-- Verification
SELECT 'export_jobs.kind added/verified' AS result;

SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'export_jobs'
  AND column_name = 'kind';

SELECT kind, COUNT(*) AS job_count
FROM export_jobs
GROUP BY kind
ORDER BY kind;
