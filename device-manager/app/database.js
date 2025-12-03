/**
 * Database Connection for Device Manager
 * 
 * Uses the same PostgreSQL database as the web app.
 * Optimized for batch writes and high throughput.
 */

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

  pool = new Pool({
    connectionString: config.database.url,
    max: config.database.poolSize,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
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
    WHERE d.is_active = true
    ORDER BY d.id
  `);
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
    SET status = 'online', last_seen_at = NOW(), updated_at = NOW()
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
 */
async function markDeviceDisconnected(deviceId, lastSuccessfulPoll) {
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
  
  await query(`
    UPDATE power_mon_devices 
    SET status = 'offline', updated_at = NOW()
    WHERE id = $1
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
 * Parked detection threshold: chassis voltage < 13.8V means parked
 */
const PARKED_VOLTAGE_THRESHOLD = 13.8;

/**
 * Update device snapshot (latest reading for dashboard)
 * Also tracks parked status and accumulates parked time
 */
async function upsertDeviceSnapshot(snapshot) {
  const now = new Date();
  const todayDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Determine if currently parked based on chassis voltage (voltage2)
  const isCurrentlyParked = (snapshot.voltage2 || 0) < PARKED_VOLTAGE_THRESHOLD;
  
  // Get current snapshot to check previous state
  const currentResult = await query(
    'SELECT is_parked, parked_since, today_parked_minutes, parked_date FROM device_snapshots WHERE device_id = $1',
    [snapshot.deviceId]
  );
  
  let isParked = isCurrentlyParked;
  let parkedSince = isCurrentlyParked ? now : null;
  let todayParkedMinutes = 0;
  let baseMinutesFromPreviousSessions = 0;
  
  if (currentResult.rows.length > 0) {
    const current = currentResult.rows[0];
    const wasParked = current.is_parked;
    const previousParkedDate = current.parked_date;
    
    // Carry forward minutes from today (excluding current parking session)
    if (previousParkedDate === todayDate) {
      baseMinutesFromPreviousSessions = current.today_parked_minutes || 0;
    }
    
    if (wasParked && current.parked_since) {
      if (isCurrentlyParked) {
        // Still parked - keep the original parked_since and calculate total time
        parkedSince = new Date(current.parked_since);
        
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
        // Transition: was parked, now moving
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
      }
    } else if (!wasParked && isCurrentlyParked) {
      // Transition: was moving, now parked - start new session
      parkedSince = now;
      todayParkedMinutes = baseMinutesFromPreviousSessions; // Keep previous sessions
    } else if (!wasParked && !isCurrentlyParked) {
      // Still moving - keep accumulated minutes from previous sessions
      todayParkedMinutes = baseMinutesFromPreviousSessions;
    }
  }
  
  // Log parked status at info level for visibility
  if (isCurrentlyParked) {
    logger.info('Truck parked - accumulating time', { 
      deviceId: snapshot.deviceId, 
      voltage2: snapshot.voltage2,
      todayParkedMinutes: Math.round(todayParkedMinutes),
      parkedSince: parkedSince
    });
  }
  
  await query(`
    INSERT INTO device_snapshots 
      (organization_id, device_id, truck_id, voltage1, voltage2, current, power, temperature, soc, energy, charge, runtime, rssi, power_status_string, is_parked, parked_since, today_parked_minutes, parked_date, recorded_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
    ON CONFLICT (device_id) 
    DO UPDATE SET
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
      today_parked_minutes = $17,
      parked_date = $18,
      recorded_at = $19,
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
    Math.round(todayParkedMinutes), // Must be integer for database column
    todayDate,
    snapshot.recordedAt,
  ]);
  
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
  updateDeviceInfo,
  getDevicesNeedingBackfill,
  updateBackfillProgress,
  bulkInsertMeasurements,
  upsertDeviceSnapshot,
  closeDatabase,
};
