#!/bin/bash
#
# Production Deployment: InHand Networks GPS Location Poller
# Created: 2026-02-10
#
# This deployment adds the InHand Networks GPS location poller to the
# Device Manager on the EC2 instance. No database migration needed — 
# trucks table already has latitude, longitude, last_location_update columns.
#
# What this does:
# - Adds InHand API credentials to the Device Manager environment
# - The new inhand-poller.js and inhand-client.js files are deployed with the code
# - Polls InHand API every 2 minutes for GPS lat/long of all routers
# - Matches devices to SIM records using MSISDN (Phone number)
# - Updates truck locations with GPS coordinates
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-02-10_add_inhand_gps_poller.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"

echo "=== Deecell Production Deployment ==="
echo "Deployment: InHand Networks GPS Location Poller"
echo ""
echo "This will:"
echo "  1. Add InHand API credentials to the Device Manager environment on EC2"
echo "  2. The code changes (inhand-client.js, inhand-poller.js) deploy with the normal CI/CD"
echo ""
echo "New environment variables needed on EC2 Device Manager:"
echo "  INHAND_API_USERNAME  - InHand Networks login email"
echo "  INHAND_API_PASSWORD  - InHand Networks login password"
echo "  INHAND_API_BASE_URL  - https://na.inhandcloud.com (North America region)"
echo ""
echo "Optional environment variables (only if you have OAuth2 client credentials):"
echo "  INHAND_CLIENT_ID     - OAuth2 client ID"
echo "  INHAND_CLIENT_SECRET - OAuth2 client secret"
echo ""
echo "No database migration needed — trucks table already has lat/long columns."
echo ""

read -p "Connect to EC2 to add InHand environment variables? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Starting SSM session to EC2..."
echo ""
echo "Once connected, run these commands to add InHand credentials:"
echo ""
echo "# 1. Store InHand credentials in AWS Secrets Manager"
echo "aws secretsmanager create-secret \\"
echo "  --name deecell-fleet-production/inhand-api-username \\"
echo "  --secret-string 'YOUR_INHAND_USERNAME' \\"
echo "  --region $REGION"
echo ""
echo "aws secretsmanager create-secret \\"
echo "  --name deecell-fleet-production/inhand-api-password \\"
echo "  --secret-string 'YOUR_INHAND_PASSWORD' \\"
echo "  --region $REGION"
echo ""
echo "# 2. OR add to Device Manager systemd environment file directly:"
echo "sudo tee -a /etc/default/device-manager << 'EOF'"
echo "INHAND_API_USERNAME=YOUR_INHAND_USERNAME"
echo "INHAND_API_PASSWORD=YOUR_INHAND_PASSWORD"
echo "INHAND_API_BASE_URL=https://na.inhandcloud.com"
echo "EOF"
echo ""
echo "# 3. Restart Device Manager to pick up new env vars:"
echo "sudo systemctl restart device-manager"
echo ""
echo "# 4. Check logs to verify InHand poller started:"
echo "sudo journalctl -u device-manager -f --since '1 min ago'"
echo "# Look for: 'Starting InHand GPS location poller'"
echo ""
echo "Then type 'exit' to close the session."
echo ""
echo "----------------------------------------"
echo ""

aws ssm start-session --target $INSTANCE_ID --region $REGION
