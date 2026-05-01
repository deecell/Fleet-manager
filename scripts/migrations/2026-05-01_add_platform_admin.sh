#!/bin/bash
#
# Production Database Migration: Add users.is_platform_admin + seed Andy (Task #8)
# Created: 2026-05-01
#
# Replaces the shared ADMIN_PASSWORD model with per-admin email/password
# identity. This script:
#   1. Adds the users.is_platform_admin boolean column.
#   2. Bootstraps the deecell-internal organization (slug-unique).
#   3. Seeds Andy (andy@deecell.com) as the first platform admin with
#      password_hash = NULL — no plaintext credential ever lives in the
#      script itself.
#
# Andy's password-setup email is sent by the application's startup
# bootstrap on the next ECS deploy: it detects Andy exists with NULL
# password and no active invitation token, mints a token, and emails
# him via SendGrid. This is idempotent — once an active token exists,
# subsequent boots skip re-sending.
#
# Deploy order:
#   1. Run this script (creates column + org + Andy row).
#   2. Roll the ECS web service to the new app image.
#   3. App boot mints invitation token + emails Andy. Watch CloudWatch
#      for "[admin-bootstrap] Andy seed user invited; email sent=true".
# If the email never arrives, /forgot-password on /admin/login is the
# manual fallback.
#
# Idempotent: ADD COLUMN IF NOT EXISTS, ON CONFLICT DO NOTHING for the
# org, WHERE NOT EXISTS for Andy. Safe to re-run. NOTE: the SQL does NOT
# auto-repair Andy's is_platform_admin flag — once revoked, it stays
# revoked across reboots and re-runs.
#
# Architecture:
#   - SQL lives in 2026-05-01_add_platform_admin.sql (sidecar file).
#   - Uses AWS SSM `send-command` (NOT `start-session`) so the SQL is shipped
#     via the AWS API as structured data - no terminal paste, no shell PATH
#     issues, no bash 3.2 heredoc bugs. Output is fetched and printed locally.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-05-01_add_platform_admin.sh
#

set -e

REGION="us-east-2"
SECRET_ID="deecell-fleet-production/database-url"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_FILE="$SCRIPT_DIR/2026-05-01_add_platform_admin.sql"

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
echo "Migration: Add users.is_platform_admin column + seed Andy as first platform admin"
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
    --comment "Migration: add users.is_platform_admin column + seed Andy" \
    --parameters "$PARAMS" \
    --query 'Command.CommandId' \
    --output text \
    --region "$REGION")

echo "      Command ID: $COMMAND_ID"
echo ""
echo "[5/5] Waiting for completion..."

# Poll for terminal status (Success | Failed | Cancelled | TimedOut)
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

# -- Print output -----------------------------------------------------------
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
