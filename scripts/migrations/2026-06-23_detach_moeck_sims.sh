#!/bin/bash
#
# Production Database Migration: Detach the two DCL-Moeck SIM rows (step 1 of 2)
# Created: 2026-06-23
#
# Wireless Logic Custom Field 1 was set BACKWARDS on the two Moeck SIMs, so each
# SIM/router was linked to the OTHER PowerMon device (DCL-Moeck-Fleet ↔
# DCL-Moeck-Hauler). Custom Field 1 is now corrected in Wireless Logic.
#
# Neither automatic path repairs a direct swap: the periodic SIMPro sync never
# re-links from Custom Field 1, and the "Refresh SIM" button refuses to steal a
# SIM linked to a DIFFERENT device (409 SIM_ALREADY_LINKED), so both refreshes
# deadlock. This script breaks the deadlock by detaching whatever SIM is
# currently linked to each of the two devices (device_id/truck_id -> NULL) and
# clearing stale router signal.
#
# STEP 2 (do this after the script succeeds): in the admin UI on /admin/devices,
# click "Refresh SIM from Wireless Logic" on DCL-Moeck-Fleet, then on
# DCL-Moeck-Hauler. Each re-links from its now-correct Custom Field 1.
#
# Safe to re-run (just re-detaches). Idempotent before you click Refresh.
#
# Architecture:
#   - SQL lives in 2026-06-23_detach_moeck_sims.sql (sidecar file).
#   - Uses AWS SSM `send-command` (NOT `start-session`) so the SQL is shipped via
#     the AWS API as structured data — no terminal paste, no heredoc bugs.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-06-23_detach_moeck_sims.sh
#

set -e

REGION="us-east-2"
SECRET_ID="deecell-fleet-production/database-url"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_FILE="$SCRIPT_DIR/2026-06-23_detach_moeck_sims.sql"

if [ ! -f "$SQL_FILE" ]; then
    echo "Error: SQL file not found: $SQL_FILE"
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required (used to build JSON params for SSM)."
    exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
    echo "Error: aws CLI is required."
    exit 1
fi

echo "=== Deecell Production Database Migration ==="
echo "Migration: Detach the two DCL-Moeck SIM rows (then Refresh SIM in admin UI)"
echo ""

# -- 1. Look up the running device-manager EC2 instance ----------------------
echo "[1/5] Looking up device-manager EC2 instance in $REGION..."
INSTANCE_ID=$(aws ec2 describe-instances \
    --filters "Name=instance-state-name,Values=running" "Name=tag:Name,Values=*device-manager*" \
    --query 'Reservations[*].Instances[*].InstanceId' \
    --output text --region "$REGION")

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
    echo "Error: No running device-manager EC2 instance found in $REGION."
    exit 1
fi
echo "      Found: $INSTANCE_ID"
echo ""

# -- 2. Show SQL preview ----------------------------------------------------
echo "[2/5] SQL to execute:"
echo "----------------------------------------"
cat "$SQL_FILE"
echo "----------------------------------------"
echo ""

read -p "Run this migration on production? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# -- 3. Build SSM params (JSON-escaped via python3) -------------------------
echo ""
echo "[3/5] Building SSM command payload..."
PARAMS=$(SECRET_ID="$SECRET_ID" REGION="$REGION" SQL_FILE="$SQL_FILE" python3 - <<'PYEOF'
import json, os
sql = open(os.environ["SQL_FILE"]).read()
secret = os.environ["SECRET_ID"]
region = os.environ["REGION"]
commands = [
    "set -e",
    "PSQL=$(command -v psql || ls /usr/bin/psql /usr/local/bin/psql /usr/lib/postgresql/*/bin/psql 2>/dev/null | head -1)",
    'if [ -z "$PSQL" ]; then',
    '  echo "psql not found on PATH, installing postgresql-client..."',
    '  (command -v apt-get >/dev/null && apt-get update -qq && apt-get install -y -qq postgresql-client) \\',
    '    || (command -v dnf >/dev/null && dnf install -y postgresql15) \\',
    '    || (command -v yum >/dev/null && yum install -y postgresql15) \\',
    '    || { echo "ERROR: could not install psql"; exit 1; }',
    '  PSQL=$(command -v psql)',
    'fi',
    'echo "Using: $PSQL"',
    f'export DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id {secret} --query SecretString --output text --region {region})',
    'TMPFILE=$(mktemp /tmp/migration.XXXXXX.sql)',
    "cat > $TMPFILE <<'SQLDONE'\n" + sql + "\nSQLDONE",
    '"$PSQL" "$DATABASE_URL" -f "$TMPFILE"',
    'rm -f "$TMPFILE"',
]
print(json.dumps({"commands": commands}))
PYEOF
)

# -- 4. Send command --------------------------------------------------------
echo "[4/5] Sending command to $INSTANCE_ID via SSM..."
COMMAND_ID=$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --comment "Migration: detach DCL-Moeck SIM rows" \
    --parameters "$PARAMS" \
    --query 'Command.CommandId' \
    --output text \
    --region "$REGION")

echo "      Command ID: $COMMAND_ID"
echo ""
echo "[5/5] Waiting for completion..."

while true; do
    STATUS=$(aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$INSTANCE_ID" \
        --region "$REGION" \
        --query 'Status' \
        --output text 2>/dev/null || echo "Pending")
    case "$STATUS" in
        Success|Failed|Cancelled|TimedOut)
            break
            ;;
        *)
            printf "."
            sleep 2
            ;;
    esac
done
echo ""
echo ""

echo "=== Final Status: $STATUS ==="
echo ""
echo "--- Standard Output ---"
aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --region "$REGION" \
    --query 'StandardOutputContent' \
    --output text

ERR=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --region "$REGION" \
    --query 'StandardErrorContent' \
    --output text)

if [ -n "$ERR" ] && [ "$ERR" != "None" ]; then
    echo ""
    echo "--- Standard Error ---"
    echo "$ERR"
fi

if [ "$STATUS" != "Success" ]; then
    exit 1
fi

echo ""
echo "=========================================================================="
echo "STEP 2 — finish in the admin UI (/admin/devices):"
echo "  1. Click 'Refresh SIM from Wireless Logic' on DCL-Moeck-Fleet"
echo "  2. Click 'Refresh SIM from Wireless Logic' on DCL-Moeck-Hauler"
echo "Each re-links from its now-correct Custom Field 1. Then watch the InHand"
echo "poll log (~2 min) — both should appear under matchedDevices on the right truck."
echo "=========================================================================="
