#!/bin/bash
# Migration: Add pulse count tracking columns to shelly_devices
# Date: 2026-01-14
# Purpose: Enable frequency calculation from pulse count deltas
#
# Run from your MacBook:
#   cd /Users/amoeck/Development/Fleet-manager
#   chmod +x scripts/migrations/2026-01-14_add_shelly_pulse_tracking.sh
#   ./scripts/migrations/2026-01-14_add_shelly_pulse_tracking.sh

set -e

echo "=== Shelly Pulse Tracking Migration ==="
echo ""

# Get DATABASE_URL from AWS Secrets Manager via SSM -> EC2
echo "Step 1: Connecting to EC2 via SSM to get DATABASE_URL..."
echo ""

# Start SSM session and run commands
aws ssm start-session --target i-0123456789abcdef0 --document-name AWS-StartInteractiveCommand --parameters command="bash -c '
export DATABASE_URL=\$(aws secretsmanager get-secret-value --secret-id deecell-fleet-production/database-url --query SecretString --output text)

echo \"Step 2: Adding new columns to shelly_devices table...\"
echo \"\"

psql \"\$DATABASE_URL\" <<EOF
-- Add pulse count tracking columns
ALTER TABLE shelly_devices 
ADD COLUMN IF NOT EXISTS last_pulse_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_pulse_count_at TIMESTAMP;

-- Verify columns were added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = '\''shelly_devices'\'' 
AND column_name IN ('\''last_pulse_count'\'', '\''last_pulse_count_at'\'');
EOF

echo \"\"
echo \"Migration complete!\"
'"

echo ""
echo "=== Migration Complete ==="
