#!/bin/bash
#
# Production Database Migration: Add (truck_id, recorded_at) index on sim_location_history
# Created: 2026-06-25
#
# WHY: The new "Moved (24h)" column on /admin/devices runs a per-truck movement
# query (getTruckMovementMiles) that window-functions over each truck's recent
# router_gps fixes in sim_location_history, filtered by truck_id + recorded_at.
# The admin Devices page polls every ~10s, and sim_location_history grows
# continuously (one row per truck every ~2 min, forever). Without an index on
# (truck_id, recorded_at), each poll sequentially scans the whole table. This
# composite index lets the planner range-scan only each truck's last-24h fixes.
#
# Safe + idempotent: uses CREATE INDEX CONCURRENTLY IF NOT EXISTS, so it does
# NOT lock the table for writes (the poller keeps inserting during the build)
# and re-running it changes nothing once the index exists.
#
# NOTE: CONCURRENTLY cannot run inside a transaction block — run each statement
# in autocommit (the psql heredoc below does this; do not wrap in BEGIN/COMMIT).
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-06-25_add_sim_location_truck_time_idx.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"
SECRET_ID="deecell-fleet-production/database-url"

echo "=== Deecell Production Database Migration ==="
echo "Migration: Add (truck_id, recorded_at) index on sim_location_history"
echo ""

SQL_COMMANDS=$(cat <<'SQL'
-- =============================================
-- Preview: existing indexes on sim_location_history
-- =============================================
SELECT indexname FROM pg_indexes
WHERE tablename = 'sim_location_history'
ORDER BY indexname;

-- =============================================
-- Apply: composite index backing the per-truck 24h movement query.
-- CONCURRENTLY = no write lock on the table while it builds.
-- =============================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS sim_location_truck_time_idx
  ON sim_location_history (truck_id, recorded_at);

-- =============================================
-- Verify: the new index is present (and valid)
-- =============================================
SELECT indexname FROM pg_indexes
WHERE tablename = 'sim_location_history'
  AND indexname = 'sim_location_truck_time_idx';

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
