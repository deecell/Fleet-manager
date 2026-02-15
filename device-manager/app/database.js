/**
 * Database Connection for Device Manager
 * 
 * Uses the same PostgreSQL database as the web app.
 * Optimized for batch writes and high throughput.
 */

const fs = require('fs');
const { Pool } = require('pg');
const { config } = require('./config');
const logger = require('./logger');

let pool = null;

/**
 * Initialize the database connection pool
 */
function initDatabase() {
  if (pool) {
    return pool;
  }

  // Parse the connection URL and force our SSL settings
  const url = new URL(config.database.url);
  
  // Remove sslmode from search params - we'll control SSL via pool options
  url.searchParams.delete('sslmode');
  
  const connectionUrl = url.toString();
  logger.info('Database connection configured', { 
    host: url.hostname,
    database: url.pathname.slice(1)
  });

  pool = new Pool({
    connectionString: connectionUrl,
    max: config.database.poolSize,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: {
      rejectUnauthorized: false
    }
  });

  pool.on('error', (err) => {
    logger.error('Unexpected database pool error', { error: err.message });
  });

  pool.on('connect', () => {
    logger.debug('New database connection established');
  });

  logger.info('Database pool initialized', { poolSize: config.database.poolSize });
  return pool;
}

/**
 * Get the database pool
 */
function getPool() {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return pool;
}

/**
 * Execute a query
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await getPool().query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query executed', { duration, rows: result.rowCount });
    return result;
  } catch (err) {
    logger.error('Query failed', { error: err.message, query: text.substring(0, 100) });
    throw err;
  }
}

/**
 * Get all active devices with credentials for polling
 */
async function getActiveDevicesWithCredentials() {
  const result = await query(`
    SELECT 
      d.id as device_id,
      d.organization_id,
      d.serial_number,
      d.device_name,
      d.truck_id,
      d.status,
      d.connection_status as device_connection_status,
      d.consecutive_disconnects,
      d.battery_voltage,
      d.number_of_batteries,
      d.battery_ah,
      c.applink_url,
      c.connection_key,
      c.access_key,
      s.cohort_id,
      s.last_successful_poll_at,
      s.connection_status,
      s.backfill_status,
      s.gap_start_at
    FROM power_mon_devices d
    INNER JOIN device_credentials c ON c.device_id = d.id AND c.is_active = true
    LEFT JOIN device_sync_status s ON s.device_id = d.id
    LEFT JOIN trucks t ON t.id = d.truck_id
    WHERE (d.truck_id IS NULL OR t.is_active = true)
      AND (d.connection_status IS NULL OR d.connection_status NOT IN ('unstable', 'offline', 'no_power'))
    ORDER BY d.id
  `);
  
  // Log any skipped unstable/offline/no_power devices for visibility
  const skippedResult = await query(`
    SELECT d.serial_number, d.device_name, d.connection_status, d.consecutive_disconnects 
    FROM power_mon_devices d
    LEFT JOIN trucks t ON t.id = d.truck_id
    WHERE (d.truck_id IS NULL OR t.is_active = true) 
      AND d.connection_status IN ('unstable', 'offline', 'no_power')
  `);
  if (skippedResult.rows.length > 0) {
    const red = '\x1b[31m';
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    console.log(`Skipping ${skippedResult.rows.length} offline/unstable devices:`);
    for (const d of skippedResult.rows) {
      const status = `[${d.connection_status}]`.padEnd(12);
      const name = (d.device_name || d.serial_number).padEnd(30);
      console.log(`        ${red}${status}${reset}${dim}${name}(${d.consecutive_disconnects} disconnects)${reset}`);
    }
  }
  
  // Log devices skipped due to inactive trucks
  const inactiveTruckResult = await query(`
    SELECT d.serial_number, d.device_name, t.truck_number
    FROM power_mon_devices d
    INNER JOIN trucks t ON t.id = d.truck_id
    WHERE t.is_active = false
  `);
  if (inactiveTruckResult.rows.length > 0) {
    const yellow = '\x1b[33m';
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    console.log(`Skipping ${inactiveTruckResult.rows.length} devices with inactive trucks:`);
    for (const d of inactiveTruckResult.rows) {
      const tag = `[inactive]`.padEnd(12);
      const name = (d.device_name || d.serial_number).padEnd(30);
      console.log(`        ${yellow}${tag}${reset}${dim}${name}(${d.truck_number})${reset}`);
    }
  }
  
  return result.rows;
}

/**
 * Update device sync status after a poll
 */
async function updateDevicePollStatus(deviceId, success, errorMessage = null) {
  const now = new Date();
  
  if (success) {
    await query(`
      UPDATE device_sync_status 
      SET 
        last_poll_at = $1,
        last_successful_poll_at = $1,
        consecutive_poll_failures = 0,
        connection_status = 'connected',
        error_message = NULL,
        updated_at = $1
      WHERE device_id = $2
    `, [now, deviceId]);
    
    // Also update last_seen_at in power_mon_devices so admin UI shows current timestamp
    await query(`
      UPDATE power_mon_devices 
      SET last_seen_at = $1, updated_at = $1
      WHERE id = $2
    `, [now, deviceId]);
  } else {
    await query(`
      UPDATE device_sync_status 
      SET 
        last_poll_at = $1,
        consecutive_poll_failures = consecutive_poll_failures + 1,
        error_message = $2,
        updated_at = $1
      WHERE device_id = $3
    `, [now, errorMessage, deviceId]);
  }
}

/**
 * Create or update device sync status record
 */
async function upsertDeviceSyncStatus(deviceId, orgId, cohortId) {
  await query(`
    INSERT INTO device_sync_status (device_id, organization_id, cohort_id, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (device_id) 
    DO UPDATE SET cohort_id = $3, updated_at = NOW()
  `, [deviceId, orgId, cohortId]);
}

/**
 * Mark device as connected
 * Resets consecutive disconnects since we established a stable connection
 */
async function markDeviceConnected(deviceId) {
  await query(`
    UPDATE device_sync_status 
    SET 
      connection_status = 'connected',
      last_connected_at = NOW(),
      consecutive_poll_failures = 0,
      updated_at = NOW()
    WHERE device_id = $1
  `, [deviceId]);
  
  await query(`
    UPDATE power_mon_devices 
    SET 
      status = 'online', 
      last_seen_at = NOW(), 
      connection_status = 'online',
      consecutive_disconnects = 0,
      marked_unstable_at = NULL,
      marked_offline_at = NULL,
      updated_at = NOW()
    WHERE id = $1
  `, [deviceId]);
}

/**
 * Update device info from PowerMon (serial, firmware, hardware revision)
 * Called on first successful connection to auto-populate device details
 */
async function updateDeviceInfo(deviceId, deviceInfo) {
  const updates = [];
  const params = [deviceId];
  let paramIndex = 2;
  
  if (deviceInfo.serialNumber) {
    updates.push(`serial_number = $${paramIndex++}`);
    params.push(deviceInfo.serialNumber);
  }
  if (deviceInfo.firmwareVersion) {
    updates.push(`firmware_version = $${paramIndex++}`);
    params.push(deviceInfo.firmwareVersion);
  }
  if (deviceInfo.hardwareRevision) {
    updates.push(`hardware_revision = $${paramIndex++}`);
    params.push(deviceInfo.hardwareRevision);
  }
  if (deviceInfo.deviceName) {
    updates.push(`device_name = $${paramIndex++}`);
    params.push(deviceInfo.deviceName);
  }
  
  if (updates.length === 0) return;
  
  updates.push('updated_at = NOW()');
  
  await query(`
    UPDATE power_mon_devices 
    SET ${updates.join(', ')}
    WHERE id = $1
  `, params);
  
  logger.info('Updated device info', { deviceId, ...deviceInfo });
}

/**
 * Mark device as disconnected and record gap start
 * Tracks disconnect reason and consecutive disconnects for stability detection
 * @param {number} deviceId - Device ID
 * @param {Date} lastSuccessfulPoll - Last successful poll timestamp
 * @param {number} disconnectReason - Disconnect reason code from PowerMon (optional)
 */
async function markDeviceDisconnected(deviceId, lastSuccessfulPoll, disconnectReason = null) {
  await query(`
    UPDATE device_sync_status 
    SET 
      connection_status = 'disconnected',
      last_disconnected_at = NOW(),
      gap_start_at = COALESCE(gap_start_at, $2),
      backfill_status = CASE 
        WHEN gap_start_at IS NULL THEN 'pending' 
        ELSE backfill_status 
      END,
      updated_at = NOW()
    WHERE device_id = $1
  `, [deviceId, lastSuccessfulPoll]);
  
  // Update power_mon_devices with disconnect info
  // Increment consecutive_disconnects to detect unstable connections
  // Use consecutive_disconnects + 1 >= 5 to mark as unstable on the 5th disconnect
  // (checking post-increment value to avoid off-by-one error)
  await query(`
    UPDATE power_mon_devices 
    SET 
      status = 'offline', 
      connection_status = CASE 
        WHEN connection_status = 'unstable' THEN 'unstable'
        WHEN consecutive_disconnects + 1 >= 5 THEN 'unstable' 
        ELSE 'offline' 
      END,
      data_status = CASE 
        WHEN connection_status = 'online' AND data_status = 'reporting' THEN 'stale'
        ELSE 'no_data'
      END,
      last_disconnect_reason = COALESCE($2, last_disconnect_reason),
      consecutive_disconnects = consecutive_disconnects + 1,
      updated_at = NOW()
    WHERE id = $1
  `, [deviceId, disconnectReason]);
}

/**
 * Mark device as receiving data (reporting)
 * Called when we successfully receive measurement data
 */
async function markDeviceReporting(deviceId) {
  const now = new Date();
  await query(`
    UPDATE power_mon_devices 
    SET 
      last_reported_at = $2,
      data_status = 'reporting',
      connection_status = 'online',
      consecutive_disconnects = 0,
      updated_at = $2
    WHERE id = $1
  `, [deviceId, now]);
}

/**
 * Mark device data as stale (connected but no data)
 * Called when device is connected but hasn't sent data for a threshold period
 */
async function markDeviceStale(deviceId) {
  await query(`
    UPDATE power_mon_devices 
    SET 
      data_status = 'stale',
      updated_at = NOW()
    WHERE id = $1 AND connection_status = 'online'
  `, [deviceId]);
}

/**
 * Mark device as unstable or no_power (circuit breaker triggered)
 * Called when the in-memory circuit breaker opens to persist the status
 * This ensures the device is skipped on process restart
 * @param {number} deviceId
 * @param {string} status - 'unstable' or 'no_power'
 */
async function markDeviceUnstable(deviceId, status = 'unstable') {
  const validStatuses = ['unstable', 'no_power'];
  if (!validStatuses.includes(status)) status = 'unstable';
  logger.warn(`Marking device as ${status} in database`, { deviceId });
  await query(`
    UPDATE power_mon_devices 
    SET 
      connection_status = $2,
      marked_unstable_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
  `, [deviceId, status]);
}

/**
 * Get offline devices that are ready for recovery attempt
 * Returns devices marked offline for longer than the backoff period
 * @param {number} backoffMs - Backoff period in milliseconds (default 10 minutes)
 */
async function getOfflineDevicesForRecovery(backoffMs = 600000) {
  const result = await query(`
    SELECT 
      d.id as device_id,
      d.organization_id,
      d.serial_number,
      d.device_name,
      d.truck_id,
      d.status,
      d.consecutive_disconnects,
      d.marked_offline_at,
      c.applink_url,
      c.connection_key,
      c.access_key,
      s.cohort_id,
      s.last_successful_poll_at,
      s.connection_status
    FROM power_mon_devices d
    INNER JOIN device_credentials c ON c.device_id = d.id AND c.is_active = true
    LEFT JOIN device_sync_status s ON s.device_id = d.id
    LEFT JOIN trucks t ON t.id = d.truck_id
    WHERE (d.truck_id IS NULL OR t.is_active = true)
      AND d.connection_status = 'offline'
      AND (
        d.marked_offline_at IS NULL 
        OR d.marked_offline_at < NOW() - INTERVAL '1 millisecond' * $1
      )
    ORDER BY d.marked_offline_at ASC NULLS FIRST
  `, [backoffMs]);
  
  if (result.rows.length > 0) {
    logger.info('Found offline devices ready for recovery check', { 
      count: result.rows.length,
      devices: result.rows.map(d => d.device_name || d.serial_number)
    });
  }
  
  return result.rows;
}

/**
 * Update marked_offline_at timestamp for a device
 * Used to reset the backoff timer after a failed recovery attempt
 */
async function updateMarkedOfflineAt(deviceId) {
  await query(`
    UPDATE power_mon_devices 
    SET 
      marked_offline_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
  `, [deviceId]);
}

/**
 * Get unstable devices that are ready for recovery attempt
 * Returns devices marked unstable for longer than the backoff period
 * @param {number} backoffMs - Backoff period in milliseconds (default 5 minutes)
 */
async function getUnstableDevicesReadyForRecovery(backoffMs = 300000) {
  const result = await query(`
    SELECT 
      d.id as device_id,
      d.organization_id,
      d.serial_number,
      d.device_name,
      d.truck_id,
      d.status,
      d.consecutive_disconnects,
      d.marked_unstable_at,
      c.applink_url,
      c.connection_key,
      c.access_key,
      s.cohort_id,
      s.last_successful_poll_at,
      s.connection_status
    FROM power_mon_devices d
    INNER JOIN device_credentials c ON c.device_id = d.id AND c.is_active = true
    LEFT JOIN device_sync_status s ON s.device_id = d.id
    LEFT JOIN trucks t ON t.id = d.truck_id
    WHERE (d.truck_id IS NULL OR t.is_active = true)
      AND d.connection_status = 'unstable'
      AND (
        d.marked_unstable_at IS NULL 
        OR d.marked_unstable_at < NOW() - INTERVAL '1 millisecond' * $1
      )
    ORDER BY d.marked_unstable_at ASC NULLS FIRST
  `, [backoffMs]);
  
  if (result.rows.length > 0) {
    logger.info('Found unstable devices ready for recovery', { 
      count: result.rows.length,
      devices: result.rows.map(d => d.device_name || d.serial_number)
    });
  }
  
  return result.rows;
}

/**
 * Reset device stability after successful recovery
 * Called when a previously unstable device successfully reconnects
 */
async function resetDeviceStability(deviceId) {
  logger.info('Resetting device stability after recovery', { deviceId });
  await query(`
    UPDATE power_mon_devices 
    SET 
      connection_status = 'online',
      consecutive_disconnects = 0,
      marked_unstable_at = NULL,
      updated_at = NOW()
    WHERE id = $1
  `, [deviceId]);
}

/**
 * Reset device disconnect counter after successful poll
 * Called immediately when poll succeeds to keep DB in sync with memory
 * This ensures process restarts don't cause circuit breaker to retrip
 */
async function resetDeviceDisconnects(deviceId) {
  await query(`
    UPDATE power_mon_devices 
    SET 
      consecutive_disconnects = 0,
      updated_at = NOW()
    WHERE id = $1 AND consecutive_disconnects > 0
  `, [deviceId]);
}

/**
 * Get devices needing backfill
 */
async function getDevicesNeedingBackfill(limit = 5) {
  const result = await query(`
    SELECT 
      s.device_id,
      s.organization_id,
      s.gap_start_at,
      s.gap_end_at,
      s.last_log_file_id,
      s.last_log_offset,
      d.serial_number,
      d.battery_voltage,
      d.number_of_batteries,
      d.battery_ah,
      c.applink_url
    FROM device_sync_status s
    INNER JOIN power_mon_devices d ON d.id = s.device_id
    INNER JOIN device_credentials c ON c.device_id = d.id AND c.is_active = true
    WHERE s.backfill_status = 'pending'
    ORDER BY s.gap_start_at ASC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

/**
 * Update backfill progress
 */
async function updateBackfillProgress(deviceId, lastFileId, lastOffset, samplesSynced, status) {
  await query(`
    UPDATE device_sync_status 
    SET 
      last_log_file_id = $2,
      last_log_offset = $3,
      total_samples_synced = total_samples_synced + $4,
      last_log_sync_at = NOW(),
      backfill_status = $5,
      gap_start_at = CASE WHEN $5 = 'completed' THEN NULL ELSE gap_start_at END,
      gap_end_at = CASE WHEN $5 = 'completed' THEN NULL ELSE gap_end_at END,
      updated_at = NOW()
    WHERE device_id = $1
  `, [deviceId, lastFileId, lastOffset, samplesSynced, status]);
}

/**
 * Bulk insert device measurements
 */
async function bulkInsertMeasurements(measurements) {
  if (measurements.length === 0) return;

  const values = [];
  const params = [];
  let paramIndex = 1;

  for (const m of measurements) {
    values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
    params.push(
      m.organizationId,
      m.deviceId,
      m.truckId,
      m.voltage1,
      m.voltage2,
      m.current,
      m.power,
      m.temperature,
      m.soc,
      m.energy,
      m.charge,
      m.runtime,
      m.rssi || null,
      m.source,
      m.recordedAt,
      m.powerStatusString || null
    );
  }

  await query(`
    INSERT INTO device_measurements 
      (organization_id, device_id, truck_id, voltage1, voltage2, current, power, temperature, soc, energy, charge, runtime, rssi, source, recorded_at, power_status_string)
    VALUES ${values.join(', ')}
    ON CONFLICT DO NOTHING
  `, params);

  logger.debug('Bulk inserted measurements', { count: measurements.length });
}

/**
 * Parked detection threshold: chassis voltage < 13.0V means parked
 */
const PARKED_VOLTAGE_THRESHOLD = 13.0;

/**
 * Update device snapshot (latest reading for dashboard)
 * Also tracks parked status and accumulates parked time
 */
async function upsertDeviceSnapshot(snapshot) {
  // Validate required fields upfront
  if (!snapshot.deviceId) {
    logger.error('upsertDeviceSnapshot: Missing deviceId', { snapshot });
    throw new Error('deviceId is required for snapshot upsert');
  }
  if (!snapshot.organizationId) {
    logger.error('upsertDeviceSnapshot: Missing organizationId', { deviceId: snapshot.deviceId });
    throw new Error('organizationId is required for snapshot upsert');
  }
  
  logger.debug('upsertDeviceSnapshot: Starting', { 
    deviceId: snapshot.deviceId, 
    truckId: snapshot.truckId,
    organizationId: snapshot.organizationId 
  });
  
  const now = new Date();
  const todayDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const currentMonth = todayDate.substring(0, 7); // YYYY-MM
  
  // Determine if currently parked based on chassis voltage (voltage2)
  const isCurrentlyParked = (snapshot.voltage2 || 0) < PARKED_VOLTAGE_THRESHOLD;
  
  // Get current snapshot to check previous state
  const currentResult = await query(
    'SELECT is_parked, parked_since, driving_since, today_parked_minutes, parked_date, month_parked_minutes, parked_month FROM device_snapshots WHERE device_id = $1',
    [snapshot.deviceId]
  );
  
  let isParked = isCurrentlyParked;
  let parkedSince = isCurrentlyParked ? now : null;
  let drivingSince = isCurrentlyParked ? null : now;
  let todayParkedMinutes = 0;
  let baseMinutesFromPreviousSessions = 0;
  let monthParkedMinutes = 0;
  let baseMonthMinutes = 0;
  
  if (currentResult.rows.length > 0) {
    const current = currentResult.rows[0];
    const wasParked = current.is_parked;
    const previousParkedDate = current.parked_date;
    const previousParkedMonth = current.parked_month;
    
    // Carry forward minutes from today (excluding current parking session)
    if (previousParkedDate === todayDate) {
      baseMinutesFromPreviousSessions = current.today_parked_minutes || 0;
    }
    
    // Handle monthly minutes
    // month_parked_minutes stores ONLY completed days (not including today)
    // Final MTD = month_parked_minutes + todayParkedMinutes
    if (previousParkedMonth === currentMonth) {
      // Same month - carry forward the "completed days" total
      baseMonthMinutes = current.month_parked_minutes || 0;
      
      // If day changed, add yesterday's completed parked time to monthly total
      if (previousParkedDate !== todayDate) {
        const yesterdayFinalMinutes = current.today_parked_minutes || 0;
        baseMonthMinutes += yesterdayFinalMinutes;
      }
    }
    // If month changed, baseMonthMinutes stays at 0 (reset for new month)
    
    if (wasParked && current.parked_since) {
      if (isCurrentlyParked) {
        // Still parked - keep the original parked_since and calculate total time
        parkedSince = new Date(current.parked_since);
        drivingSince = null;
        
        // Calculate minutes in current parking session from parked_since to now
        const currentSessionMinutes = (now - parkedSince) / 1000 / 60;
        
        // If same day, use base minutes + current session
        // If parked_since is from a previous day, only count from midnight
        const parkedSinceDate = parkedSince.toISOString().split('T')[0];
        if (parkedSinceDate === todayDate) {
          // Parking started today - total is current session duration
          todayParkedMinutes = currentSessionMinutes;
        } else {
          // Parking started yesterday or earlier - count from midnight
          const midnight = new Date(now);
          midnight.setHours(0, 0, 0, 0);
          todayParkedMinutes = (now - midnight) / 1000 / 60;
        }
      } else {
        // Transition: was parked, now moving - start driving session
        // Calculate final duration of this parking session
        const sessionEnd = now;
        const sessionStart = new Date(current.parked_since);
        const sessionStartDate = sessionStart.toISOString().split('T')[0];
        
        if (sessionStartDate === todayDate) {
          // Session started today - add full session
          const sessionMinutes = (sessionEnd - sessionStart) / 1000 / 60;
          todayParkedMinutes = baseMinutesFromPreviousSessions + sessionMinutes;
        } else {
          // Session started before today - count from midnight
          const midnight = new Date(now);
          midnight.setHours(0, 0, 0, 0);
          todayParkedMinutes = (sessionEnd - midnight) / 1000 / 60;
        }
        parkedSince = null;
        drivingSince = now; // Start driving session
      }
    } else if (!wasParked && isCurrentlyParked) {
      // Transition: was moving, now parked - start new parking session
      parkedSince = now;
      drivingSince = null; // End driving session
      todayParkedMinutes = baseMinutesFromPreviousSessions; // Keep previous sessions
    } else if (!wasParked && !isCurrentlyParked) {
      // Still moving - keep accumulated minutes and driving_since
      todayParkedMinutes = baseMinutesFromPreviousSessions;
      drivingSince = current.driving_since ? new Date(current.driving_since) : now;
    }
  }
  
  // Calculate month-to-date parked minutes for display (completed days + today)
  // Note: We store baseMonthMinutes (completed days only) in the database
  // and calculate the full MTD at display time as: month_parked_minutes + today_parked_minutes
  monthParkedMinutes = baseMonthMinutes + todayParkedMinutes;
  
  // Log parked status at info level for visibility
  if (isCurrentlyParked) {
    let truckLabel = `device#${snapshot.deviceId}`;
    try {
      const truckResult = await query(
        'SELECT d.device_name, t.truck_number FROM power_mon_devices d LEFT JOIN trucks t ON t.id = d.truck_id WHERE d.id = $1',
        [snapshot.deviceId]
      );
      if (truckResult.rows.length > 0) {
        const r = truckResult.rows[0];
        truckLabel = r.device_name ? `${r.device_name} (${r.truck_number})` : r.truck_number;
      }
    } catch (e) {}
    const cyan = '\x1b[36m';
    const bold = '\x1b[1m';
    const dim = '\x1b[2m';
    const rst = '\x1b[0m';
    const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const name = truckLabel.padEnd(30);
    const v1 = (snapshot.voltage1?.toFixed(2) || '-').padStart(6);
    const v2 = (snapshot.voltage2?.toFixed(4) || '-').padStart(8);
    const today = String(Math.round(todayParkedMinutes)).padStart(5);
    const month = String(Math.round(monthParkedMinutes)).padStart(6);
    const since = parkedSince ? parkedSince.toISOString().replace('T', ' ').replace(/\.\d+Z/, '') : 'n/a';
    console.log(`${dim}${ts}${rst} ${cyan}INFO ${rst} ${bold}${name}${rst} ${dim}parked${rst}  v1=${v1}  v2=${v2}  ${dim}today=${rst}${today}m  ${dim}month=${rst}${month}m  ${dim}since=${rst}${since}`);
  }
  
  try {
    await query(`
      INSERT INTO device_snapshots 
        (organization_id, device_id, truck_id, voltage1, voltage2, current, power, temperature, soc, energy, charge, runtime, rssi, power_status_string, is_parked, parked_since, driving_since, today_parked_minutes, parked_date, month_parked_minutes, parked_month, recorded_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW())
      ON CONFLICT (device_id) 
      DO UPDATE SET
        truck_id = $3,
        voltage1 = $4,
        voltage2 = $5,
        current = $6,
        power = $7,
        temperature = $8,
        soc = $9,
        energy = $10,
        charge = $11,
        runtime = $12,
        rssi = $13,
        power_status_string = $14,
        is_parked = $15,
        parked_since = $16,
        driving_since = $17,
        today_parked_minutes = $18,
        parked_date = $19,
        month_parked_minutes = $20,
        parked_month = $21,
        recorded_at = $22,
        updated_at = NOW()
    `, [
      snapshot.organizationId,
      snapshot.deviceId,
      snapshot.truckId,
      snapshot.voltage1,
      snapshot.voltage2,
      snapshot.current,
      snapshot.power,
      snapshot.temperature,
      snapshot.soc,
      snapshot.energy,
      snapshot.charge,
      snapshot.runtime,
      snapshot.rssi || null,
      snapshot.powerStatusString || null,
      isParked,
      parkedSince,
      drivingSince,
      Math.round(todayParkedMinutes), // Must be integer for database column
      todayDate,
      Math.round(baseMonthMinutes), // Completed days only (MTD = this + todayParkedMinutes)
      currentMonth,
      snapshot.recordedAt,
    ]);
    
    logger.debug('upsertDeviceSnapshot: Success', { 
      deviceId: snapshot.deviceId, 
      truckId: snapshot.truckId,
      isParked,
      todayParkedMinutes: Math.round(todayParkedMinutes)
    });
  } catch (err) {
    logger.error('upsertDeviceSnapshot: Database error', {
      deviceId: snapshot.deviceId,
      truckId: snapshot.truckId,
      organizationId: snapshot.organizationId,
      error: err.message,
      code: err.code,
      detail: err.detail,
      constraint: err.constraint,
      table: err.table,
      column: err.column
    });
    throw err; // Re-throw so caller knows it failed
  }
}

/**
 * Startup recovery sweep: Reset devices stuck in unstable state
 * 
 * When the device manager crashes (e.g., due to native library terminate()),
 * devices may be incorrectly left in 'unstable' status. This sweep resets
 * only unstable devices to a connectable state so they get picked up by
 * getActiveDevicesWithCredentials() and get a fresh connection attempt.
 * 
 * Offline devices are NOT auto-reset — they stay offline until an admin
 * manually sets them back online via the admin dashboard.
 * 
 * Only resets devices that have active credentials and active trucks.
 * 
 * @returns {Object} Summary of reset operations
 */
async function startupRecoverySweep() {
  logger.info('=== STARTUP RECOVERY SWEEP ===');
  
  const unstableResult = await query(`
    UPDATE power_mon_devices d
    SET 
      connection_status = NULL,
      consecutive_disconnects = 0,
      marked_unstable_at = NULL,
      updated_at = NOW()
    WHERE d.connection_status IN ('unstable', 'no_power')
      AND EXISTS (
        SELECT 1 FROM device_credentials c 
        WHERE c.device_id = d.id AND c.is_active = true
      )
      AND (d.truck_id IS NULL OR EXISTS (
        SELECT 1 FROM trucks t WHERE t.id = d.truck_id AND t.is_active = true
      ))
    RETURNING d.id, d.device_name, d.serial_number, d.connection_status
  `);
  
  const summary = {
    unstableReset: unstableResult.rows.length,
    unstableDevices: unstableResult.rows.map(d => d.device_name || d.serial_number),
  };
  
  if (summary.unstableReset > 0) {
    logger.info('Recovery sweep reset unstable devices', summary);
  } else {
    logger.info('Recovery sweep: No stuck unstable devices found');
  }
  
  return summary;
}

/**
 * Record which device was being actively polled when a crash occurs
 * Written to a file so it survives process crash
 * @param {number|null} deviceId - Device ID being polled, or null to clear
 * @param {string|null} deviceName - Device name for logging
 */
function recordActiveDevice(deviceId, deviceName) {
  const fs = require('fs');
  const crashAttributionFile = '/tmp/device-manager-active-device.json';
  
  try {
    if (deviceId === null) {
      if (fs.existsSync(crashAttributionFile)) {
        fs.unlinkSync(crashAttributionFile);
      }
    } else {
      fs.writeFileSync(crashAttributionFile, JSON.stringify({
        deviceId,
        deviceName,
        timestamp: new Date().toISOString()
      }));
    }
  } catch (err) {
    // Non-critical, don't fail
  }
}

/**
 * Read crash attribution file to find which device caused a crash
 * @returns {Object|null} Device info or null if no crash attribution data
 */
function readCrashAttribution() {
  const fs = require('fs');
  const crashAttributionFile = '/tmp/device-manager-active-device.json';
  
  try {
    if (fs.existsSync(crashAttributionFile)) {
      const data = JSON.parse(fs.readFileSync(crashAttributionFile, 'utf8'));
      fs.unlinkSync(crashAttributionFile);
      return data;
    }
  } catch (err) {
    // Non-critical
  }
  return null;
}

/**
 * Mark a specific device as the crash culprit
 * Only this device gets marked unstable, not all devices
 * @param {number} deviceId - Device that was being polled during crash
 */
async function markCrashCulprit(deviceId) {
  logger.warn('Marking crash culprit device as unstable', { deviceId });
  await query(`
    UPDATE power_mon_devices 
    SET 
      connection_status = 'unstable',
      consecutive_disconnects = consecutive_disconnects + 1,
      marked_unstable_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
  `, [deviceId]);
}

/**
 * Gracefully close the database pool
 */
async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}

module.exports = {
  initDatabase,
  getPool,
  query,
  getActiveDevicesWithCredentials,
  updateDevicePollStatus,
  upsertDeviceSyncStatus,
  markDeviceConnected,
  markDeviceDisconnected,
  markDeviceReporting,
  markDeviceStale,
  markDeviceUnstable,
  getUnstableDevicesReadyForRecovery,
  getOfflineDevicesForRecovery,
  updateMarkedOfflineAt,
  resetDeviceStability,
  resetDeviceDisconnects,
  updateDeviceInfo,
  getDevicesNeedingBackfill,
  updateBackfillProgress,
  bulkInsertMeasurements,
  upsertDeviceSnapshot,
  closeDatabase,
  startupRecoverySweep,
  recordActiveDevice,
  readCrashAttribution,
  markCrashCulprit,
};
