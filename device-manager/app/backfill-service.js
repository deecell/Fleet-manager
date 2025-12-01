/**
 * Backfill Service
 * 
 * Detects gaps in data and uses log sync to backfill missing samples.
 * Runs as a background task, processing devices with pending backfills.
 */

const path = require('path');
const { config } = require('./config');
const logger = require('./logger');
const db = require('./database');
const batchWriter = require('./batch-writer');

// Load log sync module
const logSync = require(path.join(__dirname, '../lib/log-sync.js'));

class BackfillService {
  constructor() {
    this.isRunning = false;
    this.checkTimer = null;
    this.activeBackfills = new Map(); // deviceId -> Promise
    
    this.stats = {
      totalBackfills: 0,
      successfulBackfills: 0,
      failedBackfills: 0,
      totalSamplesBackfilled: 0,
      lastCheckTime: null,
    };
  }

  /**
   * Start the backfill service
   */
  start() {
    if (this.isRunning) {
      logger.warn('Backfill service already running');
      return;
    }

    this.isRunning = true;
    this.scheduleCheck();
    
    logger.info('Backfill service started', {
      gapThresholdMs: config.backfill.gapThresholdMs,
      maxConcurrent: config.backfill.maxConcurrentBackfills,
    });
  }

  /**
   * Stop the backfill service
   */
  async stop() {
    this.isRunning = false;
    
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }

    // Wait for active backfills to complete
    if (this.activeBackfills.size > 0) {
      logger.info('Waiting for active backfills to complete', {
        count: this.activeBackfills.size,
      });
      await Promise.allSettled(this.activeBackfills.values());
    }
    
    logger.info('Backfill service stopped', this.stats);
  }

  /**
   * Schedule the next check for pending backfills
   */
  scheduleCheck() {
    if (!this.isRunning) return;

    // Check every 30 seconds
    this.checkTimer = setTimeout(() => this.checkAndProcess(), 30000);
  }

  /**
   * Check for and process pending backfills
   */
  async checkAndProcess() {
    if (!this.isRunning) return;

    this.stats.lastCheckTime = new Date();

    try {
      // Get devices needing backfill
      const availableSlots = config.backfill.maxConcurrentBackfills - this.activeBackfills.size;
      
      if (availableSlots <= 0) {
        logger.debug('No available backfill slots', {
          active: this.activeBackfills.size,
        });
        this.scheduleCheck();
        return;
      }

      const devices = await db.getDevicesNeedingBackfill(availableSlots);
      
      if (devices.length > 0) {
        logger.info('Processing pending backfills', { count: devices.length });
      }

      // Start backfill for each device
      for (const device of devices) {
        if (!this.activeBackfills.has(device.device_id)) {
          const promise = this.processBackfill(device);
          this.activeBackfills.set(device.device_id, promise);
          
          // Clean up when done
          promise.finally(() => {
            this.activeBackfills.delete(device.device_id);
          });
        }
      }

    } catch (err) {
      logger.error('Error checking for backfills', { error: err.message });
    }

    this.scheduleCheck();
  }

  /**
   * Process backfill for a single device
   */
  async processBackfill(deviceInfo) {
    const deviceId = deviceInfo.device_id;
    const log = logger.child({ 
      deviceId, 
      serial: deviceInfo.serial_number,
      operation: 'backfill' 
    });

    log.info('Starting backfill', {
      gapStart: deviceInfo.gap_start_at,
      gapEnd: deviceInfo.gap_end_at,
    });

    this.stats.totalBackfills++;

    try {
      // Update status to in_progress
      await db.updateBackfillProgress(
        deviceId, 
        deviceInfo.last_log_file_id, 
        deviceInfo.last_log_offset,
        0,
        'in_progress'
      );

      // Load the native addon and connect to device
      const powermon = require(path.join(__dirname, '../build/Release/powermon_addon.node'));
      const device = powermon.createInstance();
      
      // Parse applink URL
      const urlParams = new URL(deviceInfo.applink_url);
      const params = new URLSearchParams(urlParams.search);
      
      const result = device.Connect(
        params.get('n'),
        params.get('s'),
        parseInt(params.get('h') || '0', 10),
        params.get('c')
      );

      if (result !== 0) {
        throw new Error(`Failed to connect to device: ${result}`);
      }

      // Prepare sync state from database
      const syncState = deviceInfo.last_log_file_id ? {
        deviceSerial: deviceInfo.serial_number,
        lastFileId: parseInt(deviceInfo.last_log_file_id, 10),
        lastFileOffset: deviceInfo.last_log_offset || 0,
        totalSamplesSynced: 0,
      } : null;

      // Run log sync
      let totalSamples = 0;
      const syncResult = await logSync.syncDeviceLogs(
        device,
        deviceInfo.serial_number,
        syncState,
        (phase, progress, message) => {
          log.debug('Backfill progress', { phase, progress, message });
        }
      );

      // Process synced samples
      if (syncResult.samples && syncResult.samples.length > 0) {
        totalSamples = syncResult.samples.length;
        
        // Convert samples to measurements and enqueue
        for (const sample of syncResult.samples) {
          const measurement = {
            organizationId: deviceInfo.organization_id,
            deviceId: deviceId,
            truckId: null, // Could look up from device
            fleetId: null,
            voltage1: sample.voltage1,
            voltage2: sample.voltage2,
            current: sample.current,
            power: sample.power || (sample.voltage1 * sample.current),
            temperature: sample.temperature,
            soc: sample.soc,
            energy: sample.energy,
            charge: sample.charge,
            runtime: sample.runtime,
            source: 'backfill',
            recordedAt: new Date(sample.timestamp),
          };
          
          batchWriter.enqueue(measurement);
        }

        log.info('Backfill samples enqueued', { count: totalSamples });
      }

      // Disconnect
      device.Disconnect();

      // Update status to completed
      await db.updateBackfillProgress(
        deviceId,
        syncResult.newState?.lastFileId?.toString() || deviceInfo.last_log_file_id,
        syncResult.newState?.lastFileOffset || 0,
        totalSamples,
        'completed'
      );

      this.stats.successfulBackfills++;
      this.stats.totalSamplesBackfilled += totalSamples;

      log.info('Backfill completed', { samplesBackfilled: totalSamples });

    } catch (err) {
      this.stats.failedBackfills++;
      log.error('Backfill failed', { error: err.message });

      // Update status to failed
      await db.query(`
        UPDATE device_sync_status 
        SET 
          backfill_status = 'failed',
          error_message = $2,
          updated_at = NOW()
        WHERE device_id = $1
      `, [deviceId, err.message]);
    }
  }

  /**
   * Manually trigger backfill for a device
   */
  async triggerBackfill(deviceId) {
    const devices = await db.query(`
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
      WHERE s.device_id = $1
    `, [deviceId]);

    if (devices.rows.length === 0) {
      throw new Error(`Device ${deviceId} not found`);
    }

    // Mark as pending
    await db.query(`
      UPDATE device_sync_status 
      SET backfill_status = 'pending', updated_at = NOW()
      WHERE device_id = $1
    `, [deviceId]);

    // Process immediately if slot available
    if (this.activeBackfills.size < config.backfill.maxConcurrentBackfills) {
      const promise = this.processBackfill(devices.rows[0]);
      this.activeBackfills.set(deviceId, promise);
      promise.finally(() => this.activeBackfills.delete(deviceId));
      return promise;
    }

    return null;
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      activeBackfills: this.activeBackfills.size,
    };
  }
}

// Singleton instance
const backfillService = new BackfillService();

module.exports = { backfillService };
