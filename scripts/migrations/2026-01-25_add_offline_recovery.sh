#!/bin/bash
# Migration: Add Automatic Offline Device Recovery
# Date: 2026-01-25
# 
# This migration adds:
# 1. marked_offline_at column to power_mon_devices table
# 2. Automatic recovery feature that checks offline devices every 10 minutes
#
# Usage:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-01-25_add_offline_recovery.sh

set -e

echo "=========================================="
echo "Add Automatic Offline Device Recovery"
echo "Date: 2026-01-25"
echo "=========================================="

# Step 1: Add the marked_offline_at column to production database
echo ""
echo "Step 1: Adding marked_offline_at column to power_mon_devices..."
echo ""
echo "Please run this SQL command via SSM → EC2 → psql:"
echo ""
echo '  export DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id deecell-fleet-production/database-url --query SecretString --output text)'
echo '  psql "$DATABASE_URL" -c "ALTER TABLE power_mon_devices ADD COLUMN IF NOT EXISTS marked_offline_at TIMESTAMP;"'
echo ""

# Step 2: Deploy the device manager update
echo "Step 2: Deploy device manager on EC2..."
echo ""
echo "Run these commands on the EC2 instance:"
echo ""
echo "  cd /opt/device-manager"
echo "  sudo git pull origin main"
echo "  sudo systemctl restart device-manager"
echo "  sleep 5"
echo "  sudo systemctl status device-manager"
echo ""

# Step 3: Verify the feature
echo "Step 3: Verify automatic recovery is running..."
echo ""
echo "After 10 minutes, check logs for recovery attempts:"
echo ""
echo '  sudo journalctl -u device-manager --since "15 minutes ago" | grep -i "offline"'
echo ""

echo "=========================================="
echo "Feature: Automatic Offline Device Recovery"
echo "=========================================="
echo ""
echo "How it works:"
echo "1. Every 10 minutes, checks for offline devices"
echo "2. Pings applink URL to verify device router is reachable"
echo "3. If reachable, attempts full connection"
echo "4. If successful, device resumes normal polling"
echo "5. If unreachable/failed, tries again in 10 minutes"
echo ""
echo "The ping check prevents crashes by avoiding connection"
echo "attempts to unreachable devices."
echo ""
echo "=========================================="
echo "Migration instructions complete!"
echo "=========================================="
