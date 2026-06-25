-- =============================================
-- Preview: existing indexes on sim_location_history
-- =============================================
SELECT indexname FROM pg_indexes
WHERE tablename = 'sim_location_history'
ORDER BY indexname;

-- =============================================
-- Apply: composite index backing the per-truck 24h movement query
-- (getTruckMovementMiles, the /admin/devices "Moved (24h)" column).
-- CONCURRENTLY = no write lock while it builds; IF NOT EXISTS = idempotent.
-- NOTE: psql here runs in autocommit (no -1), so CONCURRENTLY is allowed.
-- =============================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS sim_location_truck_time_idx
  ON sim_location_history (truck_id, recorded_at);

-- =============================================
-- Verify: the new index is present (rows returned = success)
-- =============================================
SELECT indexname FROM pg_indexes
WHERE tablename = 'sim_location_history'
  AND indexname = 'sim_location_truck_time_idx';
