#!/bin/bash
#
# Deploy libpowermon v1.12 update + rebuild native addon on EC2
# Created: 2026-02-14
#
# This script:
# 1. Pushes updated library files and C++ wrapper to GitHub
# 2. SSMs into EC2 to pull changes and rebuild the native addon + bridge
# 3. Restarts the device manager
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-02-14_update_libpowermon_v112.sh
#
# CHANGES IN v1.12:
# - initBle() removed from Powermon class (was already optional for WiFi)
# - Log decode signature: vector<char> instead of vector<uint8_t>, no tz_index
# - Schedule repeat: uint32_t -> uint8_t
# - DeviceInfo now includes mac[6] field
# - Library binaries ~46% larger (436KB -> 637KB)
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"

echo "=== Deploy libpowermon v1.12 to EC2 Device Manager ==="
echo ""
echo "Changes in this update:"
echo "  - Updated libpowermon_bin library to Git tag v1.12"
echo "  - Removed deprecated initBle() call from wrapper"
echo "  - Added MAC address to DeviceInfo output"
echo "  - Library binaries ~46% larger (potential crash fix)"
echo ""

read -p "Deploy to production EC2? (y/n) " -n 1 -r
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
echo "============================================"
cat <<'COMMANDS'
# 1. Pull latest code
cd /home/ec2-user/fleet-manager
git pull origin main

# 2. Rebuild the native addon (node-gyp)
cd device-manager
npm rebuild

# 3. Rebuild the bridge binary
make clean && make

# 4. Verify the build
node -e "const addon = require('./build/Release/powermon_addon.node'); const v = addon.PowermonDevice.getLibraryVersion(); console.log('Library version:', v.string);"

# 5. Restart device manager
sudo systemctl restart device-manager
sudo systemctl status device-manager

# 6. Watch logs for a minute to verify stability
sudo journalctl -u device-manager -f --no-pager
COMMANDS
echo "============================================"
echo ""
echo "IMPORTANT: After restarting, watch logs for ~2 minutes to verify:"
echo "  - All devices connect successfully"
echo "  - DCL-Moeck-Shop (Ethernet PowerMon-W, fw 1.18) no longer crashes"
echo "  - No terminate() calls in the logs"
echo ""

aws ssm start-session --target $INSTANCE_ID --region $REGION
