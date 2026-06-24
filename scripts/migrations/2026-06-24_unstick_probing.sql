-- Production fix: unstick devices wedged by the midnight (00:00 UTC) firmware
-- mass-close storm.
--
-- At 00:00 UTC the PowerMon-W firmware closes every live session at once
-- (reason=2). The reconnect storm instant-drops, trips the flapping circuit
-- breaker fleet-wide, and devices get stranded in 'flapping' / 'probing' /
-- 'unstable' even though the trucks are reachable. The code fix (firmware-
-- recovery window + verdict reachability + orphaned-probing reconciliation)
-- prevents recurrence, but devices already wedged need a one-time reset.
--
-- This resets every device currently in 'probing', 'flapping', or 'unstable'
-- (that has active credentials) back to a clean slate so it gets a fresh
-- connection attempt on the next poll. 'offline' is admin-set and left alone.
--
-- Safe to re-run (idempotent — already-clean rows are simply not matched).

\echo '--- BEFORE: wedged device counts by status ---'
SELECT connection_status, COUNT(*) AS devices
FROM power_mon_devices
WHERE connection_status IN ('probing', 'flapping', 'unstable')
GROUP BY connection_status
ORDER BY connection_status;

\echo ''
\echo '--- Resetting wedged devices with active credentials ---'
UPDATE power_mon_devices d
SET
    connection_status = NULL,
    consecutive_disconnects = 0,
    marked_unstable_at = NULL,
    updated_at = NOW()
WHERE d.connection_status IN ('probing', 'flapping', 'unstable')
  AND EXISTS (
      SELECT 1 FROM device_credentials c
      WHERE c.device_id = d.id AND c.is_active = true
  )
RETURNING d.device_name, d.serial_number;

\echo ''
\echo '--- AFTER: any remaining wedged rows (should be only those without active credentials) ---'
SELECT connection_status, COUNT(*) AS devices
FROM power_mon_devices
WHERE connection_status IN ('probing', 'flapping', 'unstable')
GROUP BY connection_status
ORDER BY connection_status;
