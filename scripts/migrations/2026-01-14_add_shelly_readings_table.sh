#!/bin/bash
# Migration: Add shelly_readings table for historical vibration data
# Date: 2026-01-14
# Purpose: Store historical Shelly vibration readings for calibration and analysis

set -e

echo "=== Migration: Add shelly_readings Table ==="
echo "This creates a table to store historical vibration readings from Shelly devices."
echo ""

# Check if we're running from the right place
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL not set."
    echo ""
    echo "To run this migration:"
    echo "1. Connect to EC2 via SSM:"
    echo "   aws ssm start-session --target i-0b2f3c4d5e6f7a8b9"
    echo ""
    echo "2. Get the DATABASE_URL from Secrets Manager:"
    echo "   export DATABASE_URL=\$(aws secretsmanager get-secret-value --secret-id deecell-fleet-production/database-url --query SecretString --output text)"
    echo ""
    echo "3. Run the SQL commands below manually in psql:"
    exit 1
fi

echo "Running migration against database..."
echo ""

psql "$DATABASE_URL" << 'EOF'
-- Create shelly_readings table for historical vibration data
CREATE TABLE IF NOT EXISTS shelly_readings (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    shelly_device_id INTEGER NOT NULL REFERENCES shelly_devices(id) ON DELETE CASCADE,
    truck_id INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
    pulse_count INTEGER NOT NULL,
    frequency REAL DEFAULT 0,
    is_moving BOOLEAN DEFAULT FALSE,
    temperature REAL,
    voltage REAL,
    rssi INTEGER,
    recorded_at TIMESTAMP NOT NULL
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS shelly_reading_device_idx ON shelly_readings(shelly_device_id);
CREATE INDEX IF NOT EXISTS shelly_reading_org_idx ON shelly_readings(organization_id);
CREATE INDEX IF NOT EXISTS shelly_reading_time_idx ON shelly_readings(recorded_at);
CREATE INDEX IF NOT EXISTS shelly_reading_device_time_idx ON shelly_readings(shelly_device_id, recorded_at);

-- Verify table was created
SELECT 'Table created successfully. Row count:' as status, count(*) as count FROM shelly_readings;
EOF

echo ""
echo "=== Migration Complete ==="
echo ""
echo "The shelly_readings table is now available."
echo "Historical readings will be logged for each webhook from the Shelly device."
