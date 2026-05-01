#!/bin/bash
#
# Production Database Migration: Add users.is_platform_admin + seed Andy (Task #8)
# Created: 2026-05-01
#
# Replaces the shared ADMIN_PASSWORD model with per-admin email/password
# identity. This script does the FULL cutover in one run:
#   1. Adds the users.is_platform_admin boolean column.
#   2. Bootstraps the deecell-internal organization (slug-unique).
#   3. Seeds Andy (andy@deecell.com) as the first platform admin with
#      password_hash = NULL — no plaintext credential ever lives in the
#      script itself.
#   4. Mints a 32-char URL-safe invitation token and INSERTs it into
#      invitation_tokens (7-day expiry).
#   5. Pulls the SendGrid API key from Secrets Manager and POSTs the
#      "Accept Invitation" email to Andy via the SendGrid v3 API.
#
# The application's startup bootstrap (server/routes.ts →
# ensureDeecellInternalSetup) is a no-op fallback for the same flow:
# if step 5 fails (SendGrid down, missing secret, etc.) the next ECS
# deploy will detect Andy still has NULL password + no active invite
# and re-mint + re-send. Either path is idempotent.
#
# Deploy order (preferred):
#   1. Run THIS script. SQL applied + Andy emailed in one shot.
#   2. Roll the ECS web service to the new app image.
# If step 1's email fails (script exit non-zero after token mint),
# /forgot-password on /admin/login is the documented manual fallback.
#
# Idempotent in three places:
#   - ADD COLUMN IF NOT EXISTS for the flag.
#   - ON CONFLICT DO NOTHING for the org.
#   - WHERE NOT EXISTS for Andy.
#   - Email step is gated on (NULL password ∧ isPlatformAdmin ∧ no active
#     invitation token), so re-runs after a successful first run skip
#     the SendGrid call.
# NOTE: the SQL does NOT auto-repair Andy's is_platform_admin flag —
# once revoked, it stays revoked across reboots and re-runs.
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
# SendGrid secret name has a Terraform-generated unique_suffix; we resolve
# it dynamically on the EC2 side via `aws secretsmanager list-secrets`.
SENDGRID_SECRET_PREFIX="deecell-fleet-production/sendgrid-api-key"
APP_URL="https://app.deecell.com"
ANDY_EMAIL="andy@deecell.com"
ANDY_FIRST_NAME="Andy"
ORG_NAME="Deecell Internal"
SENDER_EMAIL="hello@deecell.com"
SENDER_NAME="Deecell Fleet Manager"

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
PARAMS=$(
    SECRET_ID="$SECRET_ID" \
    REGION="$REGION" \
    SQL_FILE="$SQL_FILE" \
    SENDGRID_SECRET_PREFIX="$SENDGRID_SECRET_PREFIX" \
    APP_URL="$APP_URL" \
    ANDY_EMAIL="$ANDY_EMAIL" \
    ANDY_FIRST_NAME="$ANDY_FIRST_NAME" \
    ORG_NAME="$ORG_NAME" \
    SENDER_EMAIL="$SENDER_EMAIL" \
    SENDER_NAME="$SENDER_NAME" \
    python3 - <<'PYEOF'
import json, os
sql = open(os.environ["SQL_FILE"]).read()
secret = os.environ["SECRET_ID"]
region = os.environ["REGION"]
sg_prefix = os.environ["SENDGRID_SECRET_PREFIX"]
app_url = os.environ["APP_URL"]
andy_email = os.environ["ANDY_EMAIL"]
andy_first = os.environ["ANDY_FIRST_NAME"]
org_name = os.environ["ORG_NAME"]
sender_email = os.environ["SENDER_EMAIL"]
sender_name = os.environ["SENDER_NAME"]

# The HTML body mirrors the Accept Invitation template in
# server/services/email-service.ts (`sendInvitationEmail`). The button
# brand color (#FA4B1E) and structure are kept in sync intentionally so
# the migration-sent email looks identical to the in-app invite flow.
html_template = (
    '<p style="margin:0 0 16px 0;color:#18181b;font-size:16px;">Hi ANDY_FIRST,</p>'
    '<p style="margin:0 0 24px 0;color:#3f3f46;font-size:14px;line-height:1.6;">'
    "You've been invited to join <strong>ORG_NAME</strong> on Deecell Fleet Manager as a platform administrator. "
    'Click the button below to set your password and access the admin console:'
    '</p>'
    '<p style="margin:0 0 24px 0;text-align:center;">'
    '<a href="INVITE_URL" style="display:inline-block;background-color:#FA4B1E;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:6px;">'
    'Accept Invitation'
    '</a>'
    '</p>'
    '<p style="margin:0 0 16px 0;color:#71717a;font-size:12px;">'
    'This invitation expires in 7 days. If the button does not work, copy and paste this link into your browser:'
    '<br><a href="INVITE_URL" style="color:#FA4B1E;word-break:break-all;">INVITE_URL</a>'
    '</p>'
)

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
    '',
    '# ---- Send Andy the password-setup invitation email ------------------',
    '# This is part of the migration run (per Task #8 acceptance criteria),',
    '# not deferred to app boot. Idempotent: only sends if Andy still has',
    '# NULL password_hash AND no active invitation token.',
    f'echo ""',
    'echo "[migration:invite] Checking whether Andy needs an invitation email..."',
    f'NEEDS_INVITE=$("$PSQL" "$DATABASE_URL" -tA -c "SELECT CASE WHEN u.password_hash IS NULL AND u.is_platform_admin = true AND NOT EXISTS (SELECT 1 FROM invitation_tokens t WHERE t.user_id = u.id AND t.used_at IS NULL AND t.expires_at > NOW()) THEN \'yes\' ELSE \'no\' END FROM users u WHERE u.email = \'{andy_email}\' LIMIT 1;")',
    'echo "[migration:invite] needs_invite=$NEEDS_INVITE"',
    'if [ "$NEEDS_INVITE" = "yes" ]; then',
    f'  ANDY_USER_ID=$("$PSQL" "$DATABASE_URL" -tA -c "SELECT id FROM users WHERE email = \'{andy_email}\' LIMIT 1;")',
    f'  ANDY_ORG_ID=$("$PSQL" "$DATABASE_URL" -tA -c "SELECT organization_id FROM users WHERE email = \'{andy_email}\' LIMIT 1;")',
    '  if [ -z "$ANDY_USER_ID" ] || [ -z "$ANDY_ORG_ID" ]; then',
    '    echo "[migration:invite] ERROR: could not resolve Andy user/org id. Skipping email."',
    '  else',
    '    # nanoid-equivalent: 32 URL-safe alphanumeric chars from openssl',
    '    INVITE_TOKEN=$(openssl rand -base64 48 | tr -dc "A-Za-z0-9" | head -c 32)',
    '    if [ ${#INVITE_TOKEN} -ne 32 ]; then',
    '      echo "[migration:invite] ERROR: failed to generate 32-char invite token"; exit 1',
    '    fi',
    '    "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO invitation_tokens (user_id, organization_id, token, expires_at, created_at) VALUES ($ANDY_USER_ID, $ANDY_ORG_ID, \'$INVITE_TOKEN\', NOW() + INTERVAL \'7 days\', NOW());"',
    f'    SENDGRID_SECRET_NAME=$(aws secretsmanager list-secrets --region {region} --filters Key=name,Values={sg_prefix} --query "SecretList[0].Name" --output text)',
    '    if [ -z "$SENDGRID_SECRET_NAME" ] || [ "$SENDGRID_SECRET_NAME" = "None" ]; then',
    '      echo "[migration:invite] ERROR: SendGrid secret not found. Token was minted (use /forgot-password as fallback)."; exit 1',
    '    fi',
    f'    SENDGRID_API_KEY=$(aws secretsmanager get-secret-value --secret-id "$SENDGRID_SECRET_NAME" --region {region} --query SecretString --output text)',
    '    if [ -z "$SENDGRID_API_KEY" ]; then',
    '      echo "[migration:invite] ERROR: SendGrid API key empty. Token was minted (use /forgot-password as fallback)."; exit 1',
    '    fi',
    f'    INVITE_URL="{app_url}/accept-invitation?token=$INVITE_TOKEN"',
    f'    HTML_BODY=$(cat <<HTMLDONE\n{html_template}\nHTMLDONE\n)',
    '    HTML_BODY="${HTML_BODY//ANDY_FIRST/' + andy_first + '}"',
    '    HTML_BODY="${HTML_BODY//ORG_NAME/' + org_name + '}"',
    '    HTML_BODY="${HTML_BODY//INVITE_URL/$INVITE_URL}"',
    '    PAYLOAD=$(HTML_BODY="$HTML_BODY" python3 -c "import json,os; print(json.dumps({\"personalizations\":[{\"to\":[{\"email\":\"' + andy_email + '\"}]}],\"from\":{\"email\":\"' + sender_email + '\",\"name\":\"' + sender_name + '\"},\"subject\":\"You\\u2019re invited to join ' + org_name + ' on Deecell Fleet Manager\",\"content\":[{\"type\":\"text/html\",\"value\":os.environ[\"HTML_BODY\"]}]}))")',
    '    HTTP_CODE=$(curl -sS -o /tmp/sendgrid.response -w "%{http_code}" -X POST https://api.sendgrid.com/v3/mail/send -H "Authorization: Bearer $SENDGRID_API_KEY" -H "Content-Type: application/json" --data "$PAYLOAD")',
    '    if [ "$HTTP_CODE" = "202" ]; then',
    f'      echo "[migration:invite] OK SendGrid accepted invitation email for {andy_email} (HTTP 202)."',
    '    else',
    '      echo "[migration:invite] ERROR: SendGrid HTTP $HTTP_CODE. Response:"; cat /tmp/sendgrid.response; echo',
    '      echo "[migration:invite] Token was minted; Andy can use /forgot-password as fallback."',
    '      exit 1',
    '    fi',
    '  fi',
    'else',
    '  echo "[migration:invite] Skipping email (Andy already has a password OR an active invitation token, OR was revoked)."',
    'fi',
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
