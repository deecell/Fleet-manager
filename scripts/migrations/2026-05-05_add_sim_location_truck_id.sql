-- ===========================================================================
-- Add `truck_id` column to `sim_location_history` (production parity).
--
-- Schema (shared/schema.ts L491-L512) defines this column, but it was never
-- migrated to production. The historical export query filters
-- `WHERE organization_id = … AND truck_id = … AND recorded_at BETWEEN …`,
-- so without this column every historical export crashes with:
--   ERROR:  column "truck_id" does not exist
--
-- ON DELETE SET NULL mirrors the Drizzle schema's `references(() => trucks.id,
-- { onDelete: "set null" })`.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- ===========================================================================

BEGIN;

ALTER TABLE sim_location_history
    ADD COLUMN IF NOT EXISTS truck_id INTEGER
        REFERENCES trucks(id) ON DELETE SET NULL;

-- Backfill from the owning SIM's current truck assignment. New rows written
-- by the SIMPro/InHand pollers already populate truck_id directly, so this
-- one-shot backfill catches the historical rows.
UPDATE sim_location_history slh
SET    truck_id = s.truck_id
FROM   sims s
WHERE  slh.sim_id = s.id
  AND  slh.truck_id IS NULL
  AND  s.truck_id IS NOT NULL;

-- Composite index matches the export query's filter
-- (organization_id, truck_id, recorded_at) and the per-bucket DISTINCT ON
-- ordering. Without this the query falls back to the existing
-- sim_location_org_idx + filter, which scans wide on busy orgs.
CREATE INDEX IF NOT EXISTS sim_location_truck_time_idx
    ON sim_location_history (organization_id, truck_id, recorded_at);

COMMIT;

-- Sanity check
SELECT
    COUNT(*)                                 AS total_rows,
    COUNT(truck_id)                          AS rows_with_truck_id,
    COUNT(*) - COUNT(truck_id)               AS rows_still_null
FROM sim_location_history;
