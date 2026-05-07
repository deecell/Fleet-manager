-- Add router cellular signal columns to sims table.
--
-- shared/schema.ts now declares sims.router_rssi (integer dBm) and
-- sims.router_signal_updated_at (timestamp). The InHand poller writes both
-- on every poll cycle so /admin/devices can show a "Router Sig" column
-- alongside the existing PowerMon RSSI column.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, safe to re-run.

ALTER TABLE sims
  ADD COLUMN IF NOT EXISTS router_rssi integer,
  ADD COLUMN IF NOT EXISTS router_signal_updated_at timestamp;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'sims'
  AND column_name IN ('router_rssi', 'router_signal_updated_at')
ORDER BY column_name;
