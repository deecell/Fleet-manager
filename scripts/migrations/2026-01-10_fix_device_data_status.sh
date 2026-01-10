#!/bin/bash
# Fix Device Data Status - January 10, 2026
# 
# Problem: Some devices show "No data" status even though they're reporting
# This script checks and fixes the data_status for affected devices
#
# Run from your MacBook at: /Users/amoeck/Development/Fleet-manager

set -e

echo "=========================================="
echo "Device Data Status Diagnostic & Fix Script"
echo "=========================================="
echo ""

# Step 1: Connect to EC2 via SSM
echo "Step 1: Connect to EC2 instance via SSM"
echo "Run this command first:"
echo ""
echo "  aws ssm start-session --target i-0a1b2c3d4e5f67890"
echo ""
echo "(Replace with your actual EC2 instance ID)"
echo ""
echo "Press Enter when connected to EC2..."
read

# Step 2: Get DATABASE_URL from Secrets Manager
echo "Step 2: On EC2, set the DATABASE_URL environment variable:"
echo ""
echo '  export DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id deecell-fleet-production/database-url --query SecretString --output text)'
echo ""
echo "Press Enter when DATABASE_URL is set..."
read

# Step 3: Check current device statuses
echo "Step 3: Check current device statuses"
echo ""
echo "Run this SQL to see all device statuses:"
echo ""
cat << 'EOF'
psql "$DATABASE_URL" << 'SQL'
SELECT 
    serial_number,
    device_name,
    connection_status,
    data_status,
    consecutive_disconnects,
    last_reported_at,
    last_seen_at
FROM power_mon_devices
ORDER BY last_reported_at DESC NULLS LAST;
SQL
EOF
echo ""
echo "Press Enter after reviewing the results..."
read

# Step 4: Check for devices that should be "reporting"
echo "Step 4: Find devices with recent data that show 'no_data'"
echo ""
echo "These devices have reported in the last hour but still show 'no_data':"
echo ""
cat << 'EOF'
psql "$DATABASE_URL" << 'SQL'
SELECT 
    serial_number,
    device_name,
    data_status,
    last_reported_at,
    NOW() - last_reported_at as time_since_report
FROM power_mon_devices
WHERE data_status = 'no_data'
  AND last_reported_at > NOW() - INTERVAL '1 hour';
SQL
EOF
echo ""
echo "Press Enter to continue..."
read

# Step 5: Fix data_status for recently reporting devices
echo "Step 5: Fix data_status for devices that reported recently"
echo ""
echo "This will set data_status = 'reporting' for devices that have"
echo "reported in the last hour but still show 'no_data':"
echo ""
cat << 'EOF'
psql "$DATABASE_URL" << 'SQL'
UPDATE power_mon_devices
SET 
    data_status = 'reporting',
    connection_status = 'online',
    updated_at = NOW()
WHERE data_status = 'no_data'
  AND last_reported_at > NOW() - INTERVAL '1 hour'
RETURNING serial_number, device_name, data_status;
SQL
EOF
echo ""
echo "Press Enter after running the fix..."
read

# Step 6: Verify the fix
echo "Step 6: Verify the fix worked"
echo ""
echo "Check the updated statuses:"
echo ""
cat << 'EOF'
psql "$DATABASE_URL" << 'SQL'
SELECT 
    serial_number,
    device_name,
    connection_status,
    data_status,
    last_reported_at
FROM power_mon_devices
ORDER BY data_status, last_reported_at DESC NULLS LAST;
SQL
EOF
echo ""
echo "=========================================="
echo "Done! Refresh the admin page to see changes."
echo "=========================================="
