#!/bin/bash
#
# Production Database Migration: Add Shelly vibration sensor tables
# Created: January 8, 2026
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-01-08_add_shelly_tables.sh
#
# STATUS: COMPLETED - Already run on production
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"
SECRET_ID="deecell-fleet-production/database-url"

echo "=== Deecell Production Database Migration ==="
echo "Migration: Add Shelly vibration sensor tables"
echo ""

SQL_COMMANDS=$(cat <<'SQL'
-- Shelly Devices table
CREATE TABLE IF NOT EXISTS shelly_devices (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    truck_id INTEGER REFERENCES trucks(id),
    device_id VARCHAR(64) NOT NULL UNIQUE,
    device_name VARCHAR(128),
    connection_status VARCHAR(32) DEFAULT 'offline',
    last_seen_at TIMESTAMP WITH TIME ZONE,
    last_frequency REAL DEFAULT 0,
    is_moving BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Shelly Snapshots table (for latest readings)
CREATE TABLE IF NOT EXISTS shelly_snapshots (
    id SERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES shelly_devices(id),
    frequency REAL NOT NULL,
    is_moving BOOLEAN DEFAULT FALSE,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shelly_devices_org ON shelly_devices(organization_id);
CREATE INDEX IF NOT EXISTS idx_shelly_devices_truck ON shelly_devices(truck_id);
CREATE INDEX IF NOT EXISTS idx_shelly_snapshots_device ON shelly_snapshots(device_id);
CREATE INDEX IF NOT EXISTS idx_shelly_snapshots_recorded ON shelly_snapshots(recorded_at);
SQL
)

echo "SQL to execute:"
echo "----------------------------------------"
echo "$SQL_COMMANDS"
echo "----------------------------------------"
echo ""
echo "NOTE: This migration was already run on January 8, 2026."
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
