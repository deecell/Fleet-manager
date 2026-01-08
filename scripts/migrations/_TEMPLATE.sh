#!/bin/bash
#
# Production Database Migration: [DESCRIPTION]
# Created: [DATE]
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/YYYY-MM-DD_description.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"
SECRET_ID="deecell-fleet-production/database-url"

echo "=== Deecell Production Database Migration ==="
echo "Migration: [DESCRIPTION]"
echo ""

# The SQL to run
SQL_COMMANDS=$(cat <<'SQL'
-- =============================================
-- PASTE YOUR SQL HERE
-- =============================================

-- Example:
-- CREATE TABLE IF NOT EXISTS my_table (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(128)
-- );

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
