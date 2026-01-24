#!/bin/bash
# Migration: Fix Device Manager Offline Device Polling
# Date: 2026-01-24
# 
# This migration deploys the updated device manager code that skips both
# 'offline' AND 'unstable' devices during polling, preventing crashes when
# devices are powered off.
#
# Problem: Native PowerMon library crashes (ABRT signal) when trying to connect
# to powered-off devices. The circuit breaker only skipped 'unstable' devices,
# not 'offline' ones.
#
# Fix: Update getActiveDevicesWithCredentials() to skip devices with
# connection_status IN ('unstable', 'offline')
#
# Usage:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-01-24_fix_offline_device_polling.sh

set -e

echo "=========================================="
echo "Device Manager: Fix Offline Device Polling"
echo "Date: 2026-01-24"
echo "=========================================="

# Step 1: Verify we have the latest code
echo ""
echo "Step 1: Pulling latest code from git..."
git pull origin main

# Step 2: Verify the fix is present in the code
echo ""
echo "Step 2: Verifying fix is in device-manager/app/database.js..."
if grep -q "NOT IN ('unstable', 'offline')" device-manager/app/database.js; then
    echo "✅ Fix verified - query now skips both 'offline' and 'unstable' devices"
else
    echo "❌ Error: Fix not found in database.js"
    echo "Please ensure you have pulled the latest code"
    exit 1
fi

# Step 3: Connect to EC2 and deploy
echo ""
echo "Step 3: Deploying to EC2..."
echo ""
echo "Please run these commands on the EC2 instance:"
echo ""
echo "  cd /opt/device-manager"
echo "  sudo git pull origin main"
echo "  sudo systemctl restart device-manager"
echo "  sleep 5"
echo "  sudo systemctl status device-manager"
echo ""

# Step 4: Optional - Mark powered-off devices as 'offline' instead of 'unstable'
echo "Step 4 (Optional): If you need to mark specific devices as 'offline', run:"
echo ""
echo "  psql \"\$DATABASE_URL\" -c \"UPDATE power_mon_devices SET connection_status = 'offline' WHERE id IN (13, 15);\""
echo ""
echo "Note: Both 'offline' and 'unstable' devices are now skipped during polling."
echo "- Use 'offline' for devices that are simply powered off (temporary)"
echo "- Use 'unstable' for devices with hardware/firmware issues (needs manual intervention)"
echo ""

echo "=========================================="
echo "Migration instructions complete!"
echo "=========================================="
