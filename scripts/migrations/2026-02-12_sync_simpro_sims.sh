#!/bin/bash
#
# Production Migration: Sync all SIMPro SIMs into the sims table
# Created: 2026-02-12
#
# What this does:
# - Upserts all 46 Wireless Logic SIM cards from SIMPro into the sims table
# - Populates ICCID, MSISDN, IMSI for each SIM
# - Links SIMs to organization_id = 1 (Deecell)
# - Does NOT assign truck_id (that must be done separately once we know the mapping)
# - Uses ON CONFLICT (iccid) to avoid duplicates
#
# Why this is needed:
# - The InHand GPS poller matches devices to SIMs by MSISDN (mobileNumber field)
# - All 46 SIMs need to be in the database with their MSISDN so matching works
# - Currently only 2 SIMs exist in production
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-02-12_sync_simpro_sims.sh
#

set -e

REGION="us-east-2"
INSTANCE_ID="i-05443904f977d7301"

echo "=== Deecell Production Migration ==="
echo "Migration: Sync SIMPro SIMs to database"
echo ""
echo "This will insert/update all 46 Wireless Logic SIM cards into the sims table."
echo "Existing SIMs (matched by ICCID) will have their MSISDN and IMSI updated."
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

echo ""
echo "Step 1: Getting production DATABASE_URL from AWS Secrets Manager..."
DATABASE_URL=$(aws secretsmanager get-secret-value \
    --secret-id deecell-fleet-production/database-url \
    --query SecretString \
    --output text \
    --region $REGION)

if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: Failed to get DATABASE_URL from Secrets Manager"
    exit 1
fi
echo "Got DATABASE_URL successfully."

echo ""
echo "Step 2: Upserting all 46 SIMPro SIMs..."

psql "$DATABASE_URL" << 'EOSQL'
-- Upsert all Wireless Logic SIMs from SIMPro
-- organization_id = 1 (Deecell)
-- ON CONFLICT by iccid: update msisdn, imsi, status

INSERT INTO sims (organization_id, iccid, msisdn, imsi, status, is_active, created_at, updated_at)
VALUES
  (1, '89444611503504517838', '883190603571831', '204046848315000', 'active', true, NOW(), NOW()),
  (1, '89444611503504517846', '883190603571826', '204046848315001', 'active', true, NOW(), NOW()),
  (1, '89444611503504517853', '883190603571829', '204046848315002', 'active', true, NOW(), NOW()),
  (1, '89444611503504517861', '883190603571828', '204046848315003', 'active', true, NOW(), NOW()),
  (1, '89444611503504517879', '883190603571830', '204046848315004', 'active', true, NOW(), NOW()),
  (1, '89444611503504517887', '883190603571824', '204046848315005', 'active', true, NOW(), NOW()),
  (1, '89444611503504517895', '883190603571825', '204046848315006', 'active', true, NOW(), NOW()),
  (1, '89444611503504517903', '883190603571827', '204046848315007', 'active', true, NOW(), NOW()),
  (1, '89444611503504517911', '883190603571832', '204046848315008', 'active', true, NOW(), NOW()),
  (1, '89444611503504517929', '883190603571823', '204046848315009', 'active', true, NOW(), NOW()),
  (1, '89444611503504616259', '883190603400849', '204046848324842', 'active', true, NOW(), NOW()),
  (1, '89444611503504616267', '883190603400851', '204046848324843', 'active', true, NOW(), NOW()),
  (1, '89444611503504616275', '883190603400852', '204046848324844', 'active', true, NOW(), NOW()),
  (1, '89444611503504616283', '883190603400853', '204046848324845', 'active', true, NOW(), NOW()),
  (1, '89444611503504616291', '883190603400850', '204046848324846', 'active', true, NOW(), NOW()),
  (1, '89444611503504616309', '883190603400854', '204046848324847', 'active', true, NOW(), NOW()),
  (1, '89444611503507317822', '883190603659407', '204043547936934', 'active', true, NOW(), NOW()),
  (1, '89444611503507317830', '883190603659408', '204043547936935', 'active', true, NOW(), NOW()),
  (1, '89444611503507317848', '883190603659421', '204043547936936', 'active', true, NOW(), NOW()),
  (1, '89444611503507317855', '883190603659435', '204043547936937', 'active', true, NOW(), NOW()),
  (1, '89444611503507317863', '883190603659411', '204043547936938', 'active', true, NOW(), NOW()),
  (1, '89444611503507317871', '883190603659432', '204043547936939', 'active', true, NOW(), NOW()),
  (1, '89444611503507317889', '883190603659413', '204043547936940', 'active', true, NOW(), NOW()),
  (1, '89444611503507317897', '883190603659423', '204043547936941', 'active', true, NOW(), NOW()),
  (1, '89444611503507317905', '883190603659415', '204043547936942', 'active', true, NOW(), NOW()),
  (1, '89444611503507317913', '883190603659416', '204043547936943', 'active', true, NOW(), NOW()),
  (1, '89444611503507318077', '883190603657508', '204043547936959', 'active', true, NOW(), NOW()),
  (1, '89444611503507318085', '883190603657503', '204043547936960', 'active', true, NOW(), NOW()),
  (1, '89444611503507318093', '883190603657506', '204043547936961', 'active', true, NOW(), NOW()),
  (1, '89444611503507318101', '883190603657501', '204043547936962', 'active', true, NOW(), NOW()),
  (1, '89444611503507318119', '883190603657509', '204043547936963', 'active', true, NOW(), NOW()),
  (1, '89444611503507318127', '883190603657507', '204043547936964', 'active', true, NOW(), NOW()),
  (1, '89444611503507318135', '883190603657502', '204043547936965', 'active', true, NOW(), NOW()),
  (1, '89444611503507318143', '883190603657504', '204043547936966', 'active', true, NOW(), NOW()),
  (1, '89444611503507318150', '883190603657505', '204043547936967', 'active', true, NOW(), NOW()),
  (1, '89444611503507318325', '883190603657500', '204043547936984', 'active', true, NOW(), NOW()),
  (1, '89444611503508862610', '883190603748135', '204046824064028', 'active', true, NOW(), NOW()),
  (1, '89444611503508862628', '883190603748138', '204046824064029', 'active', true, NOW(), NOW()),
  (1, '89444611503508862636', '883190603748134', '204046824064030', 'active', true, NOW(), NOW()),
  (1, '89444611503508862644', '883190603748139', '204046824064031', 'active', true, NOW(), NOW()),
  (1, '89444611503508862651', '883190603748136', '204046824064032', 'active', true, NOW(), NOW()),
  (1, '89444611503508862669', '883190603748142', '204046824064033', 'active', true, NOW(), NOW()),
  (1, '89444611503508862677', '883190603748137', '204046824064034', 'active', true, NOW(), NOW()),
  (1, '89444611503508862685', '883190603748143', '204046824064035', 'active', true, NOW(), NOW()),
  (1, '89444611503508862693', '883190603748140', '204046824064036', 'active', true, NOW(), NOW()),
  (1, '89444611503508862701', '883190603748141', '204046824064037', 'active', true, NOW(), NOW())
ON CONFLICT (iccid) DO UPDATE SET
  msisdn = EXCLUDED.msisdn,
  imsi = EXCLUDED.imsi,
  status = EXCLUDED.status,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

EOSQL

echo ""
echo "Step 3: Verifying SIM count..."
psql "$DATABASE_URL" -c "SELECT COUNT(*) as total_sims, COUNT(CASE WHEN truck_id IS NOT NULL THEN 1 END) as linked_to_truck FROM sims WHERE is_active = true;"

echo ""
echo "Step 4: Showing all active SIMs..."
psql "$DATABASE_URL" -c "SELECT id, msisdn, iccid, imsi, truck_id, status FROM sims WHERE is_active = true ORDER BY id;"

echo ""
echo "=== Migration complete ==="
echo ""
echo "NEXT STEP: Link SIMs to trucks."
echo "The InHand poller will now match devices by MSISDN and update truck GPS locations."
echo "But each SIM needs a truck_id to know which truck to update."
echo ""
echo "Once you know which InHand router is on which truck, run:"
echo "  UPDATE sims SET truck_id = <truck_id> WHERE msisdn = '<msisdn>';"
