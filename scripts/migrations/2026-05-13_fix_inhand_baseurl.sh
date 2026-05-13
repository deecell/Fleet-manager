#!/bin/bash
#
# Production Hot-Fix: Flip INHAND_API_BASE_URL to the working hostname
# Created: 2026-05-13
#
# The 2026-05-08 migration wired the InHand creds into start.sh but pinned
# INHAND_API_BASE_URL to https://na.inhandcloud.com — which is DNS-dead from
# both EC2 and laptops (`getaddrinfo ENOTFOUND na.inhandcloud.com` in
# journalctl). The probe at scripts/probe/inhand_signal_probe.sh confirmed
# that https://iot.inhandnetworks.com (the global URL listed in the InHand
# Device Manager API doc) authenticates successfully and returns all 52
# IR302 routers.
#
# This script flips the env var on the device-manager EC2 instance and
# restarts the service. The fetched secrets, IAM policy, and managed block
# from the prior migration stay intact — we surgically rewrite only the one
# `export INHAND_API_BASE_URL=...` line inside the sentinel-bracketed block.
#
# Idempotent: re-running is safe — sed targets the exact prior URL by
# pattern, then verifies the new value before restarting.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-05-13_fix_inhand_baseurl.sh
#

set -e

REGION="us-east-2"
NEW_URL="https://iot.inhandnetworks.com"

echo "=== Deecell Production Hot-Fix ==="
echo "Flipping INHAND_API_BASE_URL -> $NEW_URL"
echo ""

# -- 1. Find the device-manager EC2 instance --------------------------------
echo "[1/4] Locating device-manager EC2 instance..."
INSTANCE_ID=$(aws ec2 describe-instances \
    --region "$REGION" \
    --filters "Name=instance-state-name,Values=running" "Name=tag:Name,Values=*device-manager*" \
    --query 'Reservations[0].Instances[0].InstanceId' \
    --output text)

if [ "$INSTANCE_ID" = "None" ] || [ -z "$INSTANCE_ID" ]; then
    echo "ERROR: No running device-manager EC2 instance found in $REGION" >&2
    exit 1
fi
echo "    instance: $INSTANCE_ID"

# -- 2. Patch start.sh on the EC2 instance ----------------------------------
echo "[2/4] Patching INHAND_API_BASE_URL via SSM..."

PATCH_SCRIPT=$(cat <<'PATCH'
set -e
START=/opt/device-manager/start.sh
sudo cp "$START" "$START.bak.$(date +%s)"

# Replace the URL on whatever the prior INHAND_API_BASE_URL line was set to.
# Matches both http(s)://na.inhandcloud.com and any older mistaken value, so
# re-running this script is a no-op once the line is correct.
sudo sed -i 's|^export INHAND_API_BASE_URL=.*$|export INHAND_API_BASE_URL=https://iot.inhandnetworks.com|' "$START"

echo "=== Patched start.sh (INHAND lines) ==="
sudo grep -n "INHAND_API_BASE_URL" "$START"
PATCH
)

PARAMS=$(jq -n --arg cmd "$PATCH_SCRIPT" '{commands: [$cmd]}')

COMMAND_ID=$(aws ssm send-command \
    --region "$REGION" \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --comment "Flip INHAND_API_BASE_URL to iot.inhandnetworks.com" \
    --parameters "$PARAMS" \
    --query 'Command.CommandId' \
    --output text)

echo "    command-id: $COMMAND_ID (waiting...)"
sleep 6
aws ssm get-command-invocation \
    --region "$REGION" \
    --instance-id "$INSTANCE_ID" \
    --command-id "$COMMAND_ID" \
    --query 'StandardOutputContent' --output text

# -- 3. Restart device-manager ----------------------------------------------
echo "[3/4] Restarting device-manager..."

RESTART_CMD_ID=$(aws ssm send-command \
    --region "$REGION" \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --comment "Restart device-manager" \
    --parameters 'commands=["sudo systemctl restart device-manager","sleep 4","sudo systemctl is-active device-manager"]' \
    --query 'Command.CommandId' \
    --output text)
sleep 8
aws ssm get-command-invocation \
    --region "$REGION" \
    --instance-id "$INSTANCE_ID" \
    --command-id "$RESTART_CMD_ID" \
    --query 'StandardOutputContent' --output text

# -- 4. Wait for first InHand poll cycle and verify -------------------------
echo "[4/4] Waiting ~140s for first InHand poll cycle, then verifying..."
sleep 140

VERIFY_CMD_ID=$(aws ssm send-command \
    --region "$REGION" \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --comment "Verify InHand poller after URL flip" \
    --parameters 'commands=["echo === INHAND LOG LINES (last 3 min) ===","sudo journalctl -u device-manager --since \"3 minutes ago\" --no-pager | grep -i -E \"inhand|router|ENOTFOUND\" | tail -40","echo === DB SPOT-CHECK ===","DB_URL=$(aws secretsmanager get-secret-value --region us-east-2 --secret-id deecell-fleet-production/database-url --query SecretString --output text)","psql \"$DB_URL\" -c \"SELECT COUNT(*) AS sims_total, COUNT(*) FILTER (WHERE router_rssi IS NOT NULL) AS sims_with_signal, COUNT(*) FILTER (WHERE router_signal_updated_at > NOW() - INTERVAL '\''5 minutes'\'') AS recent FROM sims;\""]' \
    --query 'Command.CommandId' \
    --output text)
sleep 10
aws ssm get-command-invocation \
    --region "$REGION" \
    --instance-id "$INSTANCE_ID" \
    --command-id "$VERIFY_CMD_ID" \
    --query 'StandardOutputContent' --output text

echo ""
echo "=== Done ==="
echo "Look for: 'InHand poll complete' with simsRssiUpdated > 0."
echo "If sims_with_signal jumps from 0 to ~52, the per-device signal"
echo "endpoint is wired up correctly. The ENOTFOUND lines should stop."
echo "Backup of the prior start.sh is at /opt/device-manager/start.sh.bak.<timestamp>"
