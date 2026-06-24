#!/bin/bash
#
# Production Database Migration: Sync sims.truck_id from power_mon_devices.truck_id
# Created: 2026-06-24
#
# WHY: The admin "Assign Truck" action only set truck_id on power_mon_devices,
# never on the linked sims row. The InHand GPS poller writes truck location
# based on sims.truck_id, so any device assigned to a truck through the UI had
# its GPS fixes silently dropped (signal still showed, location stayed blank —
# e.g. DCL-Howard / MHR-01). The code path is fixed going forward; this script
# backfills existing assignments so already-assigned trucks start recording.
#
# Safe + idempotent: only updates rows where the SIM's truck_id differs from
# its device's truck_id. Re-running it changes nothing once in sync.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-06-24_sync_sim_truck_from_device.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"
SECRET_ID="deecell-fleet-production/database-url"

echo "=== Deecell Production Database Migration ==="
echo "Migration: Sync sims.truck_id from power_mon_devices.truck_id"
echo ""

SQL_COMMANDS=$(cat <<'SQL'
-- =============================================
-- Preview 1: assigned-mismatch rows (device has a truck, SIM doesn't match)
-- =============================================
SELECT s.device_name, s.truck_id AS sim_truck_id, d.truck_id AS device_truck_id
FROM sims s
JOIN power_mon_devices d ON d.id = s.device_id AND d.organization_id = s.organization_id
WHERE d.truck_id IS NOT NULL
  AND s.truck_id IS DISTINCT FROM d.truck_id;

-- =============================================
-- Preview 2: stale links (device unassigned, SIM still points at a truck)
-- =============================================
SELECT s.device_name, s.truck_id AS sim_truck_id, d.truck_id AS device_truck_id
FROM sims s
JOIN power_mon_devices d ON d.id = s.device_id AND d.organization_id = s.organization_id
WHERE d.truck_id IS NULL
  AND s.truck_id IS NOT NULL;

-- =============================================
-- Apply 1: copy the device's truck_id onto the linked SIM
-- =============================================
UPDATE sims s
SET truck_id = d.truck_id, updated_at = NOW()
FROM power_mon_devices d
WHERE s.device_id = d.id
  AND s.organization_id = d.organization_id
  AND d.truck_id IS NOT NULL
  AND s.truck_id IS DISTINCT FROM d.truck_id;

-- =============================================
-- Apply 2: clear stale SIM links where the device is no longer assigned
-- (old unassignDevice never cleared sims.truck_id, so GPS could keep
-- attributing fixes to a truck the device has left)
-- =============================================
UPDATE sims s
SET truck_id = NULL, updated_at = NOW()
FROM power_mon_devices d
WHERE s.device_id = d.id
  AND s.organization_id = d.organization_id
  AND d.truck_id IS NULL
  AND s.truck_id IS NOT NULL;

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
