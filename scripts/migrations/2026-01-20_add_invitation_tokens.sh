#!/bin/bash
#
# Production Database Migration: Add invitation_tokens table
# Created: 2026-01-20
#
# This table stores invitation tokens for the new user invitation flow.
# Users are now invited via email and set their own passwords.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-01-20_add_invitation_tokens.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"
SECRET_ID="deecell-fleet-production/database-url"

echo "=== Deecell Production Database Migration ==="
echo "Migration: Add invitation_tokens table"
echo ""

SQL_COMMANDS=$(cat <<'SQL'
-- =============================================
-- Add invitation_tokens table for user invitations
-- =============================================

CREATE TABLE IF NOT EXISTS invitation_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS invitation_token_idx ON invitation_tokens(token);
CREATE INDEX IF NOT EXISTS invitation_user_idx ON invitation_tokens(user_id);
CREATE INDEX IF NOT EXISTS invitation_expires_idx ON invitation_tokens(expires_at);

-- Verify table was created
SELECT 'invitation_tokens table created successfully' AS status;
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'invitation_tokens' ORDER BY ordinal_position;

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
