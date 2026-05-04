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
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-05-01_add_platform_admin.sh
#

set -e

REGION="us-east-2"
SECRET_ID="deecell-fleet-production/database-url"
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
    echo "Error: python3 is required."
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

# -- 3. Resolve SendGrid secret name locally (EC2 role lacks ListSecrets) ----
echo ""
echo "[3/6] Resolving SendGrid secret name..."
SENDGRID_SECRET_NAME=$(aws secretsmanager list-secrets \
    --region "$REGION" \
    --filters Key=name,Values="$SENDGRID_SECRET_PREFIX" \
    --query "SecretList[0].Name" \
    --output text)

if [ -z "$SENDGRID_SECRET_NAME" ] || [ "$SENDGRID_SECRET_NAME" = "None" ]; then
    echo "Error: SendGrid secret not found with prefix: $SENDGRID_SECRET_PREFIX"
    exit 1
fi
echo "      Found: $SENDGRID_SECRET_NAME"

# -- 4. Build SSM params ----------------------------------------------------
echo ""
echo "[4/6] Building SSM command payload..."

SQL_CONTENT=$(cat "$SQL_FILE")

REMOTE_SCRIPT=$(cat <<'REMOTESCRIPT'
set -e

PSQL=$(command -v psql || ls /usr/bin/psql /usr/local/bin/psql /usr/lib/postgresql/*/bin/psql 2>/dev/null | head -1)
if [ -z "$PSQL" ]; then
  echo "psql not found on PATH, installing postgresql-client..."
  (command -v apt-get >/dev/null && apt-get update -qq && apt-get install -y -qq postgresql-client) \
    || (command -v dnf >/dev/null && dnf install -y postgresql15) \
    || (command -v yum >/dev/null && yum install -y postgresql15) \
    || { echo "ERROR: could not install psql"; exit 1; }
  PSQL=$(command -v psql)
fi
echo "Using: $PSQL"

export DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id __SECRET_ID__ --query SecretString --output text --region __REGION__)

TMPFILE=$(mktemp /tmp/migration.XXXXXX.sql)
cat > $TMPFILE <<'SQLDONE'
__SQL_CONTENT__
SQLDONE

"$PSQL" "$DATABASE_URL" -f "$TMPFILE"
rm -f "$TMPFILE"

echo ""
echo "[migration:invite] Checking whether Andy needs an invitation email..."
NEEDS_INVITE=$("$PSQL" "$DATABASE_URL" -tA -c "SELECT CASE WHEN u.password_hash IS NULL AND u.is_platform_admin = true AND NOT EXISTS (SELECT 1 FROM invitation_tokens t WHERE t.user_id = u.id AND t.used_at IS NULL AND t.expires_at > NOW()) THEN 'yes' ELSE 'no' END FROM users u WHERE u.email = '__ANDY_EMAIL__' LIMIT 1;")
echo "[migration:invite] needs_invite=$NEEDS_INVITE"

if [ "$NEEDS_INVITE" = "yes" ]; then
  ANDY_USER_ID=$("$PSQL" "$DATABASE_URL" -tA -c "SELECT id FROM users WHERE email = '__ANDY_EMAIL__' LIMIT 1;")
  ANDY_ORG_ID=$("$PSQL" "$DATABASE_URL" -tA -c "SELECT organization_id FROM users WHERE email = '__ANDY_EMAIL__' LIMIT 1;")
  if [ -z "$ANDY_USER_ID" ] || [ -z "$ANDY_ORG_ID" ]; then
    echo "[migration:invite] ERROR: could not resolve Andy user/org id. Skipping email."
  else
    INVITE_TOKEN=$(openssl rand -base64 48 | tr -dc "A-Za-z0-9" | head -c 32)
    if [ ${#INVITE_TOKEN} -ne 32 ]; then
      echo "[migration:invite] ERROR: failed to generate 32-char invite token"; exit 1
    fi

    "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO invitation_tokens (user_id, organization_id, token, expires_at, created_at) VALUES ($ANDY_USER_ID, $ANDY_ORG_ID, '$INVITE_TOKEN', NOW() + INTERVAL '7 days', NOW());"
    echo "[migration:invite] Token minted (expires in 7 days)"

    SENDGRID_API_KEY=$(aws secretsmanager get-secret-value --secret-id "__SENDGRID_SECRET_NAME__" --region __REGION__ --query SecretString --output text)
    if [ -z "$SENDGRID_API_KEY" ]; then
      echo "[migration:invite] ERROR: SendGrid API key empty. Token was minted (use /forgot-password as fallback)."; exit 1
    fi

    INVITE_URL="__APP_URL__/accept-invitation?token=$INVITE_TOKEN"

    cat > /tmp/send_invite.py <<'PYEOF'
import json, os, sys

invite_url = os.environ["INVITE_URL"]
html = (
    '<p style="margin:0 0 16px 0;color:#18181b;font-size:16px;">Hi __ANDY_FIRST__,</p>'
    '<p style="margin:0 0 24px 0;color:#3f3f46;font-size:14px;line-height:1.6;">'
    "You've been invited to join <strong>__ORG_NAME__</strong> on Deecell Fleet Manager "
    "as a platform administrator. Click the button below to set your password and access the admin console:"
    '</p>'
    '<p style="margin:0 0 24px 0;text-align:center;">'
    '<a href="' + invite_url + '" style="display:inline-block;background-color:#FA4B1E;color:#ffffff;'
    'font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:6px;">'
    'Accept Invitation</a></p>'
    '<p style="margin:0 0 16px 0;color:#71717a;font-size:12px;">'
    'This invitation expires in 7 days. If the button does not work, copy and paste this link into your browser:'
    '<br><a href="' + invite_url + '" style="color:#FA4B1E;word-break:break-all;">' + invite_url + '</a></p>'
)

payload = json.dumps({
    "personalizations": [{"to": [{"email": "__ANDY_EMAIL__"}]}],
    "from": {"email": "__SENDER_EMAIL__", "name": "__SENDER_NAME__"},
    "subject": "You\u2019re invited to join __ORG_NAME__ on Deecell Fleet Manager",
    "content": [{"type": "text/html", "value": html}]
})

print(payload)
PYEOF

    export INVITE_URL
    PAYLOAD=$(python3 /tmp/send_invite.py)

    HTTP_CODE=$(curl -sS -o /tmp/sendgrid.response -w "%{http_code}" \
      -X POST https://api.sendgrid.com/v3/mail/send \
      -H "Authorization: Bearer $SENDGRID_API_KEY" \
      -H "Content-Type: application/json" \
      --data "$PAYLOAD")

    if [ "$HTTP_CODE" = "202" ]; then
      echo "[migration:invite] OK SendGrid accepted invitation email for __ANDY_EMAIL__ (HTTP 202)."
    else
      echo "[migration:invite] ERROR: SendGrid HTTP $HTTP_CODE. Response:"; cat /tmp/sendgrid.response; echo
      echo "[migration:invite] Token was minted; Andy can use /forgot-password as fallback."
      exit 1
    fi
  fi
else
  echo "[migration:invite] Skipping email (Andy already has a password OR an active invitation token, OR was revoked)."
fi
REMOTESCRIPT
)

# Replace placeholders with actual values
REMOTE_SCRIPT="${REMOTE_SCRIPT//__SECRET_ID__/$SECRET_ID}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__REGION__/$REGION}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__ANDY_EMAIL__/$ANDY_EMAIL}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__ANDY_FIRST__/$ANDY_FIRST_NAME}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__ORG_NAME__/$ORG_NAME}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__APP_URL__/$APP_URL}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__SENDGRID_SECRET_NAME__/$SENDGRID_SECRET_NAME}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__SENDER_EMAIL__/$SENDER_EMAIL}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__SENDER_NAME__/$SENDER_NAME}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__SQL_CONTENT__/$SQL_CONTENT}"

# Convert the script into a JSON commands array for SSM
PARAMS=$(python3 -c "
import json, sys
script = sys.stdin.read()
lines = script.strip().split('\n')
print(json.dumps({'commands': lines}))
" <<< "$REMOTE_SCRIPT")

# -- 4. Send command --------------------------------------------------------
echo "[5/6] Sending command to $INSTANCE_ID via SSM..."
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
echo "[6/6] Waiting for completion..."

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
