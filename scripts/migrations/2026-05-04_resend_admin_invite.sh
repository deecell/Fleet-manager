#!/bin/bash
#
# Re-send Admin Invitation Email for andy@deecell.com
# Created: 2026-05-04
#
# This script mints a fresh invitation token and sends the password-setup
# email via SendGrid. Use when the previous invitation expired or was never
# received.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-05-04_resend_admin_invite.sh
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

if ! command -v aws >/dev/null 2>&1; then
    echo "Error: aws CLI is required."
    exit 1
fi

echo "=== Deecell: Re-send Admin Invitation ==="
echo "Target: $ANDY_EMAIL"
echo ""

# -- 1. Look up EC2 instance --------------------------------------------------
echo "[1/4] Looking up device-manager EC2 instance..."
INSTANCE_ID=$(aws ec2 describe-instances \
    --filters "Name=instance-state-name,Values=running" "Name=tag:Name,Values=*device-manager*" \
    --query 'Reservations[*].Instances[*].InstanceId' \
    --output text --region "$REGION")

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
    echo "Error: No running device-manager EC2 instance found."
    exit 1
fi
echo "      Found: $INSTANCE_ID"
echo ""

# -- 2. Fetch SendGrid API key locally (EC2 role lacks Secrets Manager access) ----
echo "[2/5] Fetching SendGrid API key from Secrets Manager..."
SENDGRID_SECRET_NAME=$(aws secretsmanager list-secrets \
    --region "$REGION" \
    --filters Key=name,Values="$SENDGRID_SECRET_PREFIX" \
    --query "SecretList[0].Name" \
    --output text)

if [ -z "$SENDGRID_SECRET_NAME" ] || [ "$SENDGRID_SECRET_NAME" = "None" ]; then
    echo "Error: SendGrid secret not found with prefix: $SENDGRID_SECRET_PREFIX"
    exit 1
fi

SENDGRID_API_KEY=$(aws secretsmanager get-secret-value \
    --secret-id "$SENDGRID_SECRET_NAME" \
    --region "$REGION" \
    --query SecretString \
    --output text)

if [ -z "$SENDGRID_API_KEY" ]; then
    echo "Error: SendGrid API key is empty."
    exit 1
fi
echo "      Resolved (key length: ${#SENDGRID_API_KEY} chars)"
echo ""

read -p "Send a new invitation email to $ANDY_EMAIL? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# -- 3. Write the remote script and build SSM params ----------
echo ""
echo "[3/5] Building SSM command..."

REMOTE_SCRIPT=$(cat <<'REMOTESCRIPT'
set -e

export DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id __SECRET_ID__ --query SecretString --output text --region __REGION__)

PSQL=$(command -v psql || ls /usr/bin/psql /usr/local/bin/psql /usr/lib/postgresql/*/bin/psql 2>/dev/null | head -1)
if [ -z "$PSQL" ]; then echo "ERROR: psql not found"; exit 1; fi

echo "[invite] Expiring any old invitation tokens for __ANDY_EMAIL__..."
"$PSQL" "$DATABASE_URL" -c "UPDATE invitation_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = (SELECT id FROM users WHERE email = '__ANDY_EMAIL__' LIMIT 1) AND used_at IS NULL AND expires_at > NOW();"

ANDY_USER_ID=$("$PSQL" "$DATABASE_URL" -tA -c "SELECT id FROM users WHERE email = '__ANDY_EMAIL__' AND is_platform_admin = true LIMIT 1;")
ANDY_ORG_ID=$("$PSQL" "$DATABASE_URL" -tA -c "SELECT organization_id FROM users WHERE email = '__ANDY_EMAIL__' AND is_platform_admin = true LIMIT 1;")
if [ -z "$ANDY_USER_ID" ] || [ -z "$ANDY_ORG_ID" ]; then echo "ERROR: Andy not found as platform admin"; exit 1; fi
echo "[invite] Andy user_id=$ANDY_USER_ID org_id=$ANDY_ORG_ID"

INVITE_TOKEN=$(openssl rand -base64 48 | tr -dc "A-Za-z0-9" | head -c 32)
if [ ${#INVITE_TOKEN} -ne 32 ]; then echo "ERROR: token generation failed"; exit 1; fi

"$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO invitation_tokens (user_id, organization_id, token, expires_at, created_at) VALUES ($ANDY_USER_ID, $ANDY_ORG_ID, '$INVITE_TOKEN', NOW() + INTERVAL '7 days', NOW());"
echo "[invite] Token minted (expires in 7 days)"

SENDGRID_API_KEY="__SENDGRID_API_KEY__"
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
  echo "[invite] OK - invitation email sent to __ANDY_EMAIL__ (HTTP 202)"
else
  echo "[invite] ERROR: SendGrid HTTP $HTTP_CODE"
  cat /tmp/sendgrid.response
  echo ""
  echo "[invite] Token was minted. Use /forgot-password at __APP_URL__/admin/login as fallback."
  exit 1
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
REMOTE_SCRIPT="${REMOTE_SCRIPT//__SENDGRID_API_KEY__/$SENDGRID_API_KEY}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__SENDER_EMAIL__/$SENDER_EMAIL}"
REMOTE_SCRIPT="${REMOTE_SCRIPT//__SENDER_NAME__/$SENDER_NAME}"

# Convert the single script string into a JSON commands array for SSM
PARAMS=$(python3 -c "
import json, sys
script = sys.stdin.read()
lines = script.strip().split('\n')
print(json.dumps({'commands': lines}))
" <<< "$REMOTE_SCRIPT")

# -- 4. Send SSM command ------------------------------------------------------
echo "[4/5] Sending command to $INSTANCE_ID via SSM..."
COMMAND_ID=$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --comment "Re-send admin invitation for $ANDY_EMAIL" \
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

echo "=== Status: $STATUS ==="
echo ""
echo "--- Output ---"
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
    echo "--- Errors ---"
    echo "$ERR"
fi

if [ "$STATUS" != "Success" ]; then
    exit 1
fi

echo ""
echo "Done! Check your inbox at $ANDY_EMAIL for the invitation."
