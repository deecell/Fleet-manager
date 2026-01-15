#!/bin/bash
# Migration: Drop voltage column from Shelly tables
# Date: January 16, 2026
# Purpose: Remove voltage column - Shelly doesn't have voltage, it comes from PowerMon
#
# Run from MacBook: /Users/amoeck/Development/Fleet-manager
# Prerequisites: AWS CLI configured, SSM access to EC2

set -e

echo "=== Drop Voltage Column from Shelly Tables ==="
echo ""

# Get the EC2 instance ID (Device Manager instance)
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*device-manager*" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

if [ "$INSTANCE_ID" == "None" ] || [ -z "$INSTANCE_ID" ]; then
  echo "ERROR: Could not find running device-manager EC2 instance"
  exit 1
fi

echo "Found EC2 instance: $INSTANCE_ID"
echo ""

# Execute migration via SSM
echo "Executing migration..."
aws ssm start-session --target "$INSTANCE_ID" --document-name AWS-StartInteractiveCommand --parameters command="bash -c '
export DATABASE_URL=\$(aws secretsmanager get-secret-value --secret-id deecell-fleet-production/database-url --query SecretString --output text)

echo \"Connected to production database\"
echo \"\"

# Drop voltage column from shelly_snapshots
echo \"Dropping voltage column from shelly_snapshots...\"
psql \"\$DATABASE_URL\" -c \"ALTER TABLE shelly_snapshots DROP COLUMN IF EXISTS voltage;\"

# Drop voltage column from shelly_readings
echo \"Dropping voltage column from shelly_readings...\"
psql \"\$DATABASE_URL\" -c \"ALTER TABLE shelly_readings DROP COLUMN IF EXISTS voltage;\"

echo \"\"
echo \"Verifying changes...\"
psql \"\$DATABASE_URL\" -c \"SELECT column_name FROM information_schema.columns WHERE table_name = '\''shelly_snapshots'\'' ORDER BY ordinal_position;\"
psql \"\$DATABASE_URL\" -c \"SELECT column_name FROM information_schema.columns WHERE table_name = '\''shelly_readings'\'' ORDER BY ordinal_position;\"

echo \"\"
echo \"=== Migration Complete ===\"
'"

echo ""
echo "Migration script complete!"
