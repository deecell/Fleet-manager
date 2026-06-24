#!/bin/bash
#
# Production Database Migration: Unstick devices wedged by the midnight firmware
# mass-close storm (probing / flapping / unstable -> clean slate)
# Created: 2026-06-24
#
# At 00:00 UTC the PowerMon-W firmware closes every live session at once
# (reason=2). The reconnect storm instant-drops, trips the flapping circuit
# breaker fleet-wide, and devices get stranded in 'flapping' / 'probing' /
# 'unstable' even though the trucks are reachable — showing as "No data".
#
# The code fix (firmware-recovery window + verdict reachability + orphaned-
# probing reconciliation) prevents this from recurring, but devices already
# wedged need this one-time reset. It clears connection_status (+ counters) for
# every device currently in 'probing'/'flapping'/'unstable' that has active
# credentials, so each gets a fresh connection attempt on the next poll.
# 'offline' is admin-set and left untouched.
#
# Safe to re-run (idempotent — already-clean rows aren't matched).
#
# Architecture:
#   - SQL lives in 2026-06-24_unstick_probing.sql (sidecar file).
#   - Uses AWS SSM `send-command` (NOT `start-session`) so the SQL is shipped via
#     the AWS API as structured data — no terminal paste, no heredoc bugs.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-06-24_unstick_probing.sh
#

set -e

REGION="us-east-2"
SECRET_ID="deecell-fleet-production/database-url"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_FILE="$SCRIPT_DIR/2026-06-24_unstick_probing.sql"

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
echo "Migration: Unstick midnight-wedged devices (probing/flapping/unstable -> clean)"
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
    --comment "Migration: unstick midnight-wedged devices" \
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
echo "Done. Wedged devices were reset to a clean state and will reconnect on the"
echo "next poll cycle (~1-2 min). Watch the device-manager log:"
echo "  aws ssm start-session --target $INSTANCE_ID --region $REGION"
echo "  sudo journalctl -u device-manager.service -f"
echo "Devices that are genuinely offline will re-trip the breaker; reachable ones"
echo "will come back online and start reporting data again."
echo "=========================================================================="
