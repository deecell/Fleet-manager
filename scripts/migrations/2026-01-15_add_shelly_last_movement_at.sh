#!/bin/bash
#
# Production Database Migration: Add last_movement_at column to shelly_snapshots
# Created: 2026-01-15
#
# Purpose: Tracks when movement was last detected by the Shelly sensor.
#          Used for the 30-minute buffer to prevent false IDLING detection
#          at stoplights, traffic, and quick fuel stops.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-01-15_add_shelly_last_movement_at.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"
SECRET_ID="deecell-fleet-production/database-url"

echo "=== Deecell Production Database Migration ==="
echo "Migration: Add last_movement_at to shelly_snapshots"
echo ""

# The SQL to run
SQL_COMMANDS=$(cat <<'SQL'
-- =============================================
-- Add last_movement_at column to shelly_snapshots
-- =============================================

-- Add column for tracking when movement was last detected
ALTER TABLE shelly_snapshots
ADD COLUMN IF NOT EXISTS last_movement_at TIMESTAMP;

-- Add comment explaining the column's purpose
COMMENT ON COLUMN shelly_snapshots.last_movement_at IS 
  'When movement was last detected by Shelly sensor (for 30-min idle buffer)';

-- Verify the change
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'shelly_snapshots' 
AND column_name = 'last_movement_at';

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
