#!/bin/bash
#
# Production Database Migration: Add source column to sim_location_history
# Created: 2026-06-24
#
# WHY: The Drizzle schema (shared/schema.ts) defines a `source` column on
# sim_location_history (default 'cell_tower'), and dev has it via db:push.
# But production's table was built by startup-migrations.ts BEFORE that column
# existed, so prod is missing it. The InHand poller now INSERTs router GPS fixes
# with source='router_gps', which fails in prod until this column is added.
#
# Safe + idempotent: ADD COLUMN IF NOT EXISTS. Existing cell-tower writes are
# unaffected (they rely on the column default and never name it).
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-06-24_add_source_to_sim_location_history.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"
SECRET_ID="deecell-fleet-production/database-url"

echo "=== Deecell Production Database Migration ==="
echo "Migration: Add source column to sim_location_history table"
echo ""

SQL_COMMANDS=$(cat <<'SQL'
-- =============================================
-- Add source column so router GPS fixes can be tagged 'router_gps'
-- (distinguishes them from existing SIMPro 'cell_tower' rows)
-- =============================================

ALTER TABLE sim_location_history ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'cell_tower';

-- Verify the column was added
SELECT column_name, data_type, column_default FROM information_schema.columns
WHERE table_name = 'sim_location_history' AND column_name = 'source';

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
