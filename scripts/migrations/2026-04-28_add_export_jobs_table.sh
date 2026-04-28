#!/bin/bash
#
# Production Database Migration: Add export_jobs table for async Fleet Export pipeline
# Created: 2026-04-28
#
# Adds the export_jobs table introduced by the Fleet Export feature (Tasks #1-#3).
# The table tracks every export request through its full lifecycle:
#   pending -> running -> completed | failed | expired
# and stores S3 metadata, signed-URL TTL, banner-dismiss state, and the
# historical-mode fields reserved for Task #4.
#
# Idempotent: uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS, so
# it is safe to re-run if the table already exists (e.g. if the ECS startup
# migration step has already applied it).
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-04-28_add_export_jobs_table.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"
SECRET_ID="deecell-fleet-production/database-url"

echo "=== Deecell Production Database Migration ==="
echo "Migration: Add export_jobs table for async Fleet Export pipeline"
echo ""

# The SQL to run
SQL_COMMANDS=$(cat <<'SQL'
-- =============================================
-- export_jobs: tracks async fleet export jobs
-- =============================================
CREATE TABLE IF NOT EXISTS export_jobs (
    id                            SERIAL PRIMARY KEY,
    organization_id               INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id                       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- What to export
    bundle_key                    TEXT NOT NULL,
    format                        TEXT NOT NULL,                     -- 'csv' | 'xlsx'
    filters                       JSONB,                             -- { fleetId?, operationalStatus?, searchQuery? }
    include_columns               JSONB,                             -- string[]
    exclude_columns               JSONB,                             -- string[]

    -- Historical mode (reserved for Task #4 — single truck, <=1 yr, <=1 row/min)
    historical_mode               BOOLEAN DEFAULT FALSE,
    historical_truck_id           INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
    historical_start_time         TIMESTAMP,
    historical_end_time           TIMESTAMP,
    historical_interval_seconds   INTEGER DEFAULT 60,

    -- Status & lifecycle
    status                        TEXT NOT NULL DEFAULT 'pending',   -- pending | running | completed | failed | expired
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

-- Indexes powering: per-org listing, banner queries, worker claim, sweeper.
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
SELECT
    'export_jobs created/verified - row count: ' || COUNT(*) AS result
FROM export_jobs;

SELECT
    indexname
FROM pg_indexes
WHERE tablename = 'export_jobs'
ORDER BY indexname;
SQL
)

echo "SQL to execute:"
echo "----------------------------------------"
echo "$SQL_COMMANDS"
echo "----------------------------------------"
echo ""

read -p "Connect to production database and run this SQL? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Starting SSM session to EC2..."
echo ""
echo "Once connected, run these commands:"
echo ""
echo "export DATABASE_URL=\$(aws secretsmanager get-secret-value --secret-id $SECRET_ID --query SecretString --output text --region $REGION)"
echo ""
echo "psql \"\$DATABASE_URL\" << 'EOF'"
echo "$SQL_COMMANDS"
echo "EOF"
echo ""
echo "Then type 'exit' to close the session."
echo ""
echo "----------------------------------------"
echo ""

aws ssm start-session --target $INSTANCE_ID --region $REGION
