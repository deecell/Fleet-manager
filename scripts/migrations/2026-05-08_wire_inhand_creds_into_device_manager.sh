#!/bin/bash
#
# Production Deployment: Wire InHand API credentials into device-manager
# Created: 2026-05-08
#
# The InHand secrets already exist in AWS Secrets Manager:
#   - deecell-fleet-production/inhand-api-username
#   - deecell-fleet-production/inhand-api-password
#
# But the device-manager EC2 instance never picks them up because:
#   1. The IAM role attached to the EC2 instance does NOT grant
#      GetSecretValue on those two ARNs (it only allows database-url + simpro).
#   2. /opt/device-manager/start.sh does not fetch + export them.
#
# This script fixes both, then restarts the service and verifies the InHand
# poller boots correctly.
#
# Idempotent: re-running is safe — the IAM policy attachment uses a stable
# name (overwrites in place) and start.sh uses a sentinel-bracketed block
# that gets replaced rather than appended.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-05-08_wire_inhand_creds_into_device_manager.sh
#

set -e

REGION="us-east-2"
ROLE_NAME="deecell-fleet-production-device-manager-role"
POLICY_NAME="inhand-secrets-access"
USERNAME_SECRET="deecell-fleet-production/inhand-api-username"
PASSWORD_SECRET="deecell-fleet-production/inhand-api-password"

echo "=== Deecell Production Deployment ==="
echo "Wiring InHand API credentials into the device-manager service"
echo ""

# -- 1. Look up the secret ARNs (they have a random suffix) -----------------
echo "[1/6] Looking up InHand secret ARNs..."
USERNAME_ARN=$(aws secretsmanager describe-secret \
    --region "$REGION" \
    --secret-id "$USERNAME_SECRET" \
    --query 'ARN' --output text)
PASSWORD_ARN=$(aws secretsmanager describe-secret \
    --region "$REGION" \
    --secret-id "$PASSWORD_SECRET" \
    --query 'ARN' --output text)
echo "    username: $USERNAME_ARN"
echo "    password: $PASSWORD_ARN"

# -- 2. Attach inline IAM policy granting GetSecretValue on those ARNs ------
echo "[2/6] Granting device-manager role access to InHand secrets..."
POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["secretsmanager:GetSecretValue"],
    "Resource": ["$USERNAME_ARN", "$PASSWORD_ARN"]
  }]
}
EOF
)
aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "$POLICY_NAME" \
    --policy-document "$POLICY_DOC"
echo "    inline policy '$POLICY_NAME' attached to '$ROLE_NAME'"

# -- 3. Find the device-manager EC2 instance --------------------------------
echo "[3/6] Locating device-manager EC2 instance..."
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

# -- 4. Patch /opt/device-manager/start.sh on the EC2 instance --------------
# We use a sentinel-bracketed block so re-running this script replaces the
# block in place rather than appending. The block exports the three InHand
# env vars before the existing `exec node app/index.js` line.
echo "[4/6] Patching /opt/device-manager/start.sh via SSM..."

# Build the SSM commands as a JSON array. The patch script awks/seds the
# start.sh on the instance — keeping all logic on the instance side avoids
# quoting nightmares.
PATCH_SCRIPT=$(cat <<'PATCH'
set -e
START=/opt/device-manager/start.sh
sudo cp "$START" "$START.bak.$(date +%s)"

# Strip any previous sentinel-bracketed InHand block (idempotent re-run).
sudo awk '
  /^# >>> INHAND CREDS BEGIN/ { skip=1; next }
  /^# <<< INHAND CREDS END/   { skip=0; next }
  !skip
' "$START" | sudo tee "$START.tmp" > /dev/null

# Insert the InHand fetch block immediately before the `exec node` line.
sudo awk '
  /^exec node app\/index\.js/ && !inserted {
    print "# >>> INHAND CREDS BEGIN (managed by 2026-05-08_wire_inhand_creds_into_device_manager.sh)"
    print "export INHAND_API_USERNAME=$(aws secretsmanager get-secret-value \\"
    print "  --secret-id \"deecell-fleet-production/inhand-api-username\" \\"
    print "  --query SecretString --output text --region us-east-2)"
    print "export INHAND_API_PASSWORD=$(aws secretsmanager get-secret-value \\"
    print "  --secret-id \"deecell-fleet-production/inhand-api-password\" \\"
    print "  --query SecretString --output text --region us-east-2)"
    print "export INHAND_API_BASE_URL=https://na.inhandcloud.com"
    print "# <<< INHAND CREDS END"
    print ""
    inserted = 1
  }
  { print }
' "$START.tmp" | sudo tee "$START.new" > /dev/null

sudo mv "$START.new" "$START"
sudo rm -f "$START.tmp"
sudo chmod +x "$START"
sudo chown ubuntu:ubuntu "$START"

echo "=== Patched start.sh (preview) ==="
sudo grep -n -E "INHAND|exec node" "$START"
PATCH
)

PARAMS=$(jq -n --arg cmd "$PATCH_SCRIPT" '{commands: [$cmd]}')

COMMAND_ID=$(aws ssm send-command \
    --region "$REGION" \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --comment "Patch start.sh to export InHand creds" \
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

# -- 5. Wait for IAM propagation, then restart device-manager ---------------
echo "[5/6] Waiting 15s for IAM propagation, then restarting device-manager..."
sleep 15

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

# -- 6. Wait for first InHand poll cycle and verify -------------------------
echo "[6/6] Waiting ~140s for first InHand poll cycle..."
sleep 140

VERIFY_CMD_ID=$(aws ssm send-command \
    --region "$REGION" \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --comment "Verify InHand poller" \
    --parameters 'commands=["echo === INHAND LOG LINES (last 3 min) ===","sudo journalctl -u device-manager --since \"3 minutes ago\" --no-pager | grep -i -E \"inhand|router\" | tail -30","echo === DB SPOT-CHECK ===","DB_URL=$(aws secretsmanager get-secret-value --region us-east-2 --secret-id deecell-fleet-production/database-url --query SecretString --output text)","psql \"$DB_URL\" -c \"SELECT COUNT(*) AS sims_total, COUNT(*) FILTER (WHERE router_rssi IS NOT NULL) AS sims_with_signal, COUNT(*) FILTER (WHERE router_signal_updated_at > NOW() - INTERVAL '\''5 minutes'\'') AS recent FROM sims;\""]' \
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
echo "Look for: 'Starting InHand GPS location poller' and 'InHand poll complete'"
echo "If sims_with_signal > 0 in the DB spot-check, refresh /admin/devices."
echo "If anything looks wrong, the prior start.sh is at /opt/device-manager/start.sh.bak.<timestamp>"
