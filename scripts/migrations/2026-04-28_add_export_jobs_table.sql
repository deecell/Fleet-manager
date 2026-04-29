-- =============================================
-- export_jobs: tracks async fleet export jobs
-- =============================================
-- Idempotent: safe to re-run if the table already exists.

CREATE TABLE IF NOT EXISTS export_jobs (
    id                            SERIAL PRIMARY KEY,
    organization_id               INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id                       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- What to export
    bundle_key                    TEXT NOT NULL,
    format                        TEXT NOT NULL,
    filters                       JSONB,
    include_columns               JSONB,
    exclude_columns               JSONB,

    -- Historical mode (reserved for Task #4)
    historical_mode               BOOLEAN DEFAULT FALSE,
    historical_truck_id           INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
    historical_start_time         TIMESTAMP,
    historical_end_time           TIMESTAMP,
    historical_interval_seconds   INTEGER DEFAULT 60,

    -- Status & lifecycle
    status                        TEXT NOT NULL DEFAULT 'pending',
    error_message                 TEXT,
    row_count                     INTEGER,
    column_count                  INTEGER,
    file_size_bytes               BIGINT,

    -- S3 + signed URL
    s3_key                        TEXT,
    s3_filename                   TEXT,
    download_url                  TEXT,
    download_url_expires_at       TIMESTAMP,

    -- Banner / notification state
    notified_at                   TIMESTAMP,
    dismissed_at                  TIMESTAMP,

    -- Audit timestamps
    requested_at                  TIMESTAMP DEFAULT NOW(),
    started_at                    TIMESTAMP,
    completed_at                  TIMESTAMP,
    created_at                    TIMESTAMP DEFAULT NOW(),
    updated_at                    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS export_job_org_idx
    ON export_jobs (organization_id);

CREATE INDEX IF NOT EXISTS export_job_org_status_idx
    ON export_jobs (organization_id, status);

CREATE INDEX IF NOT EXISTS export_job_user_status_idx
    ON export_jobs (user_id, status);

CREATE INDEX IF NOT EXISTS export_job_status_idx
    ON export_jobs (status);

CREATE INDEX IF NOT EXISTS export_job_expires_idx
    ON export_jobs (download_url_expires_at);

-- Verification
SELECT 'export_jobs created/verified - row count: ' || COUNT(*) AS result
FROM export_jobs;

SELECT indexname
FROM pg_indexes
WHERE tablename = 'export_jobs'
ORDER BY indexname;
