-- =============================================================================
-- Detach the two DCL-Moeck SIM rows (step 1 of 2)
-- =============================================================================
-- Wireless Logic Custom Field 1 was set BACKWARDS on the two Moeck SIMs, so each
-- SIM/router got linked to the OTHER PowerMon device (DCL-Moeck-Fleet ↔
-- DCL-Moeck-Hauler). Custom Field 1 is now corrected in Wireless Logic.
--
-- Neither automatic path repairs a direct swap: the periodic SIMPro sync never
-- re-links from Custom Field 1, and the "Refresh SIM" button refuses to steal a
-- SIM that's currently linked to a DIFFERENT device (409 SIM_ALREADY_LINKED) —
-- so in a swap both refreshes deadlock.
--
-- This script breaks the deadlock by DETACHING whatever SIM is currently linked
-- to each of the two devices (device_id/truck_id -> NULL) and clearing stale
-- router signal. After this runs, finish in the admin UI: click "Refresh SIM
-- from Wireless Logic" on each device. Refresh then re-links each device from
-- its now-correct Custom Field 1 using the system's authoritative, tested path.
--
-- Safe to re-run (it just re-detaches; harmless before you click Refresh). The
-- periodic sync will NOT re-link a detached row, so there's no race.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

\echo ''
\echo '--- BEFORE (current linkage) ---'
SELECT d.device_name AS powermon,
       d.id          AS device_id,
       s.id          AS sim_id,
       s.iccid,
       s.msisdn,
       s.device_name AS sim_cf1,
       s.truck_id    AS sim_truck_id
FROM power_mon_devices d
LEFT JOIN sims s ON s.device_id = d.id
WHERE d.device_name IN ('DCL-Moeck-Fleet', 'DCL-Moeck-Hauler')
ORDER BY d.device_name, s.id;

-- Detach whatever SIM(s) are currently linked to the two Moeck devices.
UPDATE sims SET
  device_id = NULL,
  truck_id = NULL,
  router_rssi = NULL,
  router_signal_updated_at = NULL,
  updated_at = NOW()
WHERE device_id IN (
  SELECT id FROM power_mon_devices
  WHERE device_name IN ('DCL-Moeck-Fleet', 'DCL-Moeck-Hauler')
);

\echo ''
\echo '--- AFTER (these rows should now show device_id = NULL) ---'
SELECT id          AS sim_id,
       iccid,
       msisdn,
       device_name AS sim_cf1,
       device_id,
       truck_id
FROM sims
WHERE device_name IN ('DCL-Moeck-Fleet', 'DCL-Moeck-Hauler')
ORDER BY device_name, id;

COMMIT;
