#!/bin/bash
#
# Production Database: Verify and assign truck to user
# Created: 2026-01-22
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-01-22_verify_and_assign_truck.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"
SECRET_ID="deecell-fleet-production/database-url"

echo "=== Deecell Production Database ==="
echo "Task: Verify and assign truck to andy.moeck@gmail.com"
echo ""

SQL_VERIFY=$(cat <<'SQL'
-- =============================================
-- Step 1: Check user's current assigned_truck_id
-- =============================================
SELECT id, email, first_name, last_name, organization_id, assigned_truck_id, role
FROM users 
WHERE email = 'andy.moeck@gmail.com';

-- =============================================
-- Step 2: List available trucks in user's organization
-- =============================================
SELECT t.id, t.truck_number, t.make, t.model, t.organization_id
FROM trucks t
WHERE t.organization_id = (SELECT organization_id FROM users WHERE email = 'andy.moeck@gmail.com')
ORDER BY t.id;

SQL
)

SQL_ASSIGN=$(cat <<'SQL'
-- =============================================
-- Step 3: Assign truck to user (change TRUCK_ID to actual truck ID)
-- =============================================
UPDATE users 
SET assigned_truck_id = TRUCK_ID
WHERE email = 'andy.moeck@gmail.com';

-- Verify the assignment
SELECT id, email, first_name, assigned_truck_id 
FROM users 
WHERE email = 'andy.moeck@gmail.com';

SQL
)

echo "=== STEP 1: Verify user and available trucks ==="
echo ""
echo "Run this SQL first to see current state:"
echo "----------------------------------------"
echo "$SQL_VERIFY"
echo "----------------------------------------"
echo ""
echo ""
echo "=== STEP 2: Assign truck (if needed) ==="
echo ""
echo "Replace TRUCK_ID with the actual truck ID from Step 1, then run:"
echo "----------------------------------------"
echo "$SQL_ASSIGN"
echo "----------------------------------------"
echo ""

read -p "Connect to production database? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Starting SSM session to EC2..."
echo ""
echo "Once connected, run:"
echo ""
echo "export DATABASE_URL=\$(aws secretsmanager get-secret-value --secret-id $SECRET_ID --query SecretString --output text --region $REGION)"
echo ""
echo "psql \"\$DATABASE_URL\""
echo ""
echo "Then paste the SQL commands above."
echo "Type 'exit' to close when done."
echo ""
echo "----------------------------------------"
echo ""

aws ssm start-session --target $INSTANCE_ID --region $REGION
