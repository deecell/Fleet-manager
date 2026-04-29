#!/bin/bash
#
# Production Database Migration: Add export_jobs table for async Fleet Export pipeline
# Created: 2026-04-28
#
# Adds the export_jobs table introduced by the Fleet Export feature (Tasks #1-#3).
# The table tracks every export request through its full lifecycle:
#   pending -> running -> completed | failed | expired
# and stores S3 metadata, signed-URL TTL, banner-dismiss state, and the
# historical-mode fields reserved for Task #4.
#
# Idempotent: uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS, so
# it is safe to re-run if the table already exists (e.g. if the ECS startup
# migration step has already applied it).
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-04-28_add_export_jobs_table.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"
SECRET_ID="deecell-fleet-production/database-url"

# SQL file lives next to this script (avoids bash 3.2 nested-heredoc bugs on macOS)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_FILE="$SCRIPT_DIR/2026-04-28_add_export_jobs_table.sql"

if [ ! -f "$SQL_FILE" ]; then
    echo "Error: SQL file not found: $SQL_FILE"
    exit 1
fi

SQL_COMMANDS=$(cat "$SQL_FILE")

echo "=== Deecell Production Database Migration ==="
echo "Migration: Add export_jobs table for async Fleet Export pipeline"
echo ""
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
