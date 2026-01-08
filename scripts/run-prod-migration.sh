#!/bin/bash
#
# Production Database Migration Script
# Run from your MacBook Pro terminal
#
# Prerequisites:
#   1. AWS CLI installed: brew install awscli
#   2. Session Manager plugin: brew install --cask session-manager-plugin
#   3. AWS credentials configured: aws configure
#
# Usage:
#   ./scripts/run-prod-migration.sh migrations/my_migration.sql
#

set -e

REGION="us-east-2"
SECRET_ID="deecell-fleet-production/database-url"

# Check for SQL file argument
if [ -z "$1" ]; then
    echo "Usage: $0 <sql-file>"
    echo "Example: $0 migrations/shelly_devices_production.sql"
    exit 1
fi

SQL_FILE="$1"

if [ ! -f "$SQL_FILE" ]; then
    echo "Error: SQL file not found: $SQL_FILE"
    exit 1
fi

echo "=== Deecell Production Database Migration ==="
echo ""

# Step 1: Get EC2 instance ID
echo "[1/4] Finding Device Manager EC2 instance..."
INSTANCE_ID=$(aws ec2 describe-instances \
    --filters "Name=instance-state-name,Values=running" "Name=tag:Name,Values=*device-manager*" \
    --query 'Reservations[*].Instances[*].InstanceId' \
    --output text --region $REGION)

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" == "None" ]; then
    echo "Error: Could not find Device Manager instance"
    exit 1
fi

echo "    Found: $INSTANCE_ID"
echo ""

# Step 2: Read SQL file
echo "[2/4] Reading SQL file: $SQL_FILE"
SQL_CONTENT=$(cat "$SQL_FILE")
echo "    $(echo "$SQL_CONTENT" | wc -l | tr -d ' ') lines of SQL"
echo ""

# Step 3: Create remote script
echo "[3/4] Preparing migration..."
REMOTE_SCRIPT=$(cat <<'SCRIPT'
export DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id deecell-fleet-production/database-url --query SecretString --output text --region us-east-2)
if [ -z "$DATABASE_URL" ]; then
    echo "Error: Could not retrieve DATABASE_URL"
    exit 1
fi
echo "Connected to database. Running migration..."
SCRIPT
)

# Step 4: Run via SSM
echo "[4/4] Connecting to EC2 and running migration..."
echo ""
echo "--- Starting SSM Session ---"
echo "Once connected, run these commands:"
echo ""
echo "export DATABASE_URL=\$(aws secretsmanager get-secret-value --secret-id $SECRET_ID --query SecretString --output text --region $REGION)"
echo ""
echo "psql \"\$DATABASE_URL\" << 'EOF'"
echo "$SQL_CONTENT"
echo "EOF"
echo ""
echo "--- End of commands ---"
echo ""
echo "Starting session now..."
echo ""

aws ssm start-session --target $INSTANCE_ID --region $REGION
