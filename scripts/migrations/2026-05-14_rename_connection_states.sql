-- Rename device-manager connection_status states to be causally honest:
--   no_power     → flapping  (we observed instant disconnects, not actual power loss)
--   weak_signal  → flapping  (was a transient early-warning state, now collapsed)
--
-- The unstable / offline / online / connecting / disconnected / probing values
-- are unchanged.
--
-- Idempotent: re-running on already-migrated rows is a no-op (the WHERE clause
-- filters out anything that doesn't still hold a legacy value).

BEGIN;

UPDATE power_mon_devices
SET connection_status = 'flapping',
    updated_at = NOW()
WHERE connection_status IN ('no_power', 'weak_signal');

-- Show what changed (psql will print the row count above; this gives counts by
-- final state so the operator can sanity-check).
SELECT connection_status, COUNT(*) AS device_count
FROM power_mon_devices
GROUP BY connection_status
ORDER BY connection_status NULLS LAST;

COMMIT;
