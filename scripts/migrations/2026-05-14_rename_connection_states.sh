#!/bin/bash
#
# Production Database Migration: Rename connection_status values
# Created: 2026-05-14
#
# Renames legacy device-manager connection_status values to the new causally-
# honest taxonomy:
#   no_power     → flapping
#   weak_signal  → flapping
#
# Why: the old names claimed a root cause (power loss / weak cellular signal)
# we never actually observed. We only observed "the device's connection won't
# stay up". `flapping` describes that observation honestly; the operator can
# triage from the FLAPPING DIAGNOSTIC log line which prints router reachability
# and GPS freshness.
#
# Companion code change drops process.exit(1) on circuit-break (30+ days of
# prod logs showed zero SIGABRT/SIGSEGV/core-dumps — the worker-killing
# defense was solving a problem that doesn't exist). Bad devices are now
# isolated in-place; the supervisor's solo-probe loop handles recovery.
#
# Idempotent: ADD COLUMN IF NOT EXISTS — wait, no, this is just an UPDATE
# with a WHERE-IN filter. Safe to re-run; second run is a no-op.
#
# Architecture:
#   - SQL lives in 2026-05-14_rename_connection_states.sql (sidecar file).
#   - Uses AWS SSM `send-command` (NOT `start-session`) so the SQL is shipped
#     via the AWS API as structured data — no terminal paste, no bash 3.2
#     heredoc bugs. Output is fetched and printed locally.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-05-14_rename_connection_states.sh
#

set -e

REGION="us-east-2"
SECRET_ID="deecell-fleet-production/database-url"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_FILE="$SCRIPT_DIR/2026-05-14_rename_connection_states.sql"

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
echo "Migration: Rename connection_status no_power/weak_signal → flapping"
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
    --comment "Migration: rename connection_status no_power/weak_signal -> flapping" \
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
