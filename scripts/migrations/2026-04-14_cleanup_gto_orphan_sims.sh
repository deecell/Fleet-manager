#!/bin/bash
#
# Cleanup orphan SIMs from GTO Fast Racing (org_id=9)
# Created: April 14, 2026
#
# The first SIM sync assigned all 46 SIMs to GTO Fast Racing.
# This removes the ones that don't have a matching device in that org.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   chmod +x scripts/migrations/2026-04-14_cleanup_gto_orphan_sims.sh
#   ./scripts/migrations/2026-04-14_cleanup_gto_orphan_sims.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"
SECRET_ID="deecell-fleet-production/database-url"

echo "=== Cleanup Orphan SIMs from GTO Fast Racing ==="
echo ""

SQL_COMMANDS=$(cat <<'SQL'
-- Show what will be deleted
SELECT id, iccid, msisdn, device_name, device_id, truck_id
FROM sims
WHERE organization_id = 9 AND device_id IS NULL;

-- Delete orphan SIMs (no device match) from GTO Fast Racing
DELETE FROM sims
WHERE organization_id = 9 AND device_id IS NULL;
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
