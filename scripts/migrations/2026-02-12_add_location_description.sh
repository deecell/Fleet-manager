#!/bin/bash
#
# Production Database Migration: Add location_description column to trucks
# Created: 2026-02-12
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-02-12_add_location_description.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"
SECRET_ID="deecell-fleet-production/database-url"

echo "=== Deecell Production Database Migration ==="
echo "Migration: Add location_description column to trucks table"
echo ""

SQL_COMMANDS=$(cat <<'SQL'
-- =============================================
-- Add location_description column for reverse geocoded location names
-- e.g., "Los Angeles, CA" or "Detroit, MI"
-- =============================================

ALTER TABLE trucks ADD COLUMN IF NOT EXISTS location_description TEXT;

-- Verify the column was added
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'trucks' AND column_name = 'location_description';

SQL
)

echo "SQL to execute:"
echo "----------------------------------------"
echo "$SQL_COMMANDS"
echo "----------------------------------------"
echo ""

read -p "Connect to production database and run this SQL? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Starting SSM session to EC2..."
echo ""
echo "Once connected, run these commands:"
echo ""
echo "export DATABASE_URL=\$(aws secretsmanager get-secret-value --secret-id $SECRET_ID --query SecretString --output text --region $REGION)"
echo ""
echo "psql \"\$DATABASE_URL\" << 'EOF'"
echo "$SQL_COMMANDS"
echo "EOF"
echo ""
echo "Then type 'exit' to close the session."
echo ""
echo "----------------------------------------"
echo ""

aws ssm start-session --target $INSTANCE_ID --region $REGION
