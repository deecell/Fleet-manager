/**
 * Connection Pool Manager
 * 
 * Maintains persistent connections to PowerMon devices.
 * Devices are sharded into cohorts for staggered polling.
 */

const path = require('path');
const { config } = require('./config');
const logger = require('./logger');
const db = require('./database');

// Load the native addon - with graceful fallback to simulation mode
let powermon = null;
let simulationMode = false;

// Check if we're in simulation mode via environment variable
// SIMULATION_MODE=true skips loading native addon entirely (avoids crash on incompatible binaries)
if (process.env.SIMULATION_MODE === 'true' || process.env.SIMULATION_MODE === '1') {
  simulationMode = true;
  logger.info('Running in SIMULATION MODE - no real device connections');
} else {
  // Only attempt to load addon if not in simulation mode
  // Note: If addon is compiled for different architecture, Node will crash on require()
  // Set SIMULATION_MODE=true to avoid this on EC2 until addon is rebuilt for target platform
  const addonPath = path.join(__dirname, '../build/Release/powermon_addon.node');
  const fs = require('fs');
  
  if (!fs.existsSync(addonPath)) {
    logger.warn('PowerMon addon not found at ' + addonPath + ', running in simulation mode');
    simulationMode = true;
  } else {
    try {
      powermon = require(addonPath);
      logger.info('PowerMon addon loaded successfully');
    } catch (err) {
      logger.error('Failed to load PowerMon addon', { error: err.message });
      logger.warn('Set SIMULATION_MODE=true to avoid crash on incompatible binaries');
      simulationMode = true;
    }
  }
}

/**
 * Connection state for a single device
 */
// Circuit breaker configuration
const RAPID_DISCONNECT_THRESHOLD_MS = 5000; // Disconnect within 5s of connect = rapid
const MAX_RAPID_DISCONNECTS = 5; // After 5 rapid disconnects, mark as unstable
const UNSTABLE_BACKOFF_MS = 300000; // 5 minutes backoff for unstable devices

class DeviceConnection {
  constructor(deviceInfo) {
    this.deviceId = deviceInfo.device_id;
    this.orgId = deviceInfo.organization_id;
    this.serialNumber = deviceInfo.serial_number;
    this.deviceName = deviceInfo.device_name;
    this.truckId = deviceInfo.truck_id;
    this.applinkUrl = deviceInfo.applink_url;
    this.cohortId = deviceInfo.cohort_id || 0;
    
    // Battery configuration for Wh calculation
    this.batteryVoltage = deviceInfo.battery_voltage || null;
    this.numberOfBatteries = deviceInfo.number_of_batteries || null;
    this.batteryAh = deviceInfo.battery_ah || null;
    
    this.device = null; // PowerMon device instance
    this.status = 'disconnected'; // disconnected, connecting, connected, reconnecting
    this.lastPollAt = null;
    this.lastSuccessfulPollAt = deviceInfo.last_successful_poll_at;
    this.consecutiveFailures = 0;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    
    // Circuit breaker state
    this.lastConnectedAt = null; // Track when connection was established
    this.rapidDisconnectCount = deviceInfo.consecutive_disconnects || 0;
    this.isCircuitOpen = false; // If true, don't try to connect
    this.circuitResetAt = null; // When to try again
    this.intentionalDisconnect = false; // Flag to track intentional vs error disconnects
    
    this.log = logger.child({ 
      deviceId: this.deviceId, 
      serial: this.serialNumber,
      cohort: this.cohortId 
    });
  }
  
  /**
   * Calculate battery energy (Wh) from SoC and battery configuration
   * Formula: Wh = (SoC/100) × batteryVoltage × (numberOfBatteries × batteryAh)
   * 
   * @param {number} soc - State of charge percentage (0-100)
   * @returns {number|null} - Calculated Wh or null if battery config is missing
   */
  calculateWh(soc) {
    if (this.batteryVoltage == null || this.numberOfBatteries == null || this.batteryAh == null) {
      return null; // Cannot calculate without battery config
    }
    if (soc == null || isNaN(soc)) {
      return null;
    }
    
    const totalCapacityAh = this.numberOfBatteries * this.batteryAh;
    const wh = (soc / 100) * this.batteryVoltage * totalCapacityAh;
    return Math.round(wh * 100) / 100; // Round to 2 decimal places
  }
  
  /**
   * Check if this device should be skipped due to circuit breaker
   */
  shouldSkipConnection() {
    if (!this.isCircuitOpen) return false;
    
    // Check if cooldown has passed
    if (this.circuitResetAt && Date.now() > this.circuitResetAt) {
      this.log.info('Circuit breaker reset, will attempt reconnection');
      this.isCircuitOpen = false;
      this.circuitResetAt = null;
      return false;
    }
    
    return true;
  }

  /**
   * Connect to the device
   */
  connect() {
    if (!powermon) {
      this.log.error('PowerMon addon not available');
      return Promise.resolve(false);
    }

    if (this.status === 'connected') {
      return Promise.resolve(true);
    }
    
    // Circuit breaker check
    if (this.shouldSkipConnection()) {
      this.log.debug('Skipping connection - circuit breaker open', {
        rapidDisconnects: this.rapidDisconnectCount,
        resetAt: this.circuitResetAt
      });
      return Promise.resolve(false);
    }

    this.status = 'connecting';
    this.log.info('Connecting to device');

    return new Promise((resolve) => {
      try {
        // Parse applink URL to get access key
        const parsed = powermon.PowermonDevice.parseAccessURL(this.applinkUrl);
        
        // Create device instance
        this.device = new powermon.PowermonDevice();
        
        // Set connection timeout
        const timeout = setTimeout(() => {
          this.log.warn('Connection timeout');
          this.status = 'disconnected';
          if (this.device) {
            // Mark as non-intentional error disconnect before native teardown
            this.intentionalDisconnect = false;
            this.device.disconnect();
            this.device = null;
          }
          resolve(false);
        }, 15000);
        
        // Connect via WiFi using the parsed access key
        this.device.connect({
          accessKey: parsed.accessKey,
          onConnect: async () => {
            clearTimeout(timeout);
            this.status = 'connected';
            this.consecutiveFailures = 0;
            this.reconnectAttempts = 0;
            this.lastConnectedAt = Date.now(); // Track connection time for rapid disconnect detection
            this.log.info('Connected successfully');
            
            await db.markDeviceConnected(this.deviceId);
            
            // Fetch and update device info on first connection
            await this.fetchAndUpdateDeviceInfo();
            
            resolve(true);
          },
          onDisconnect: (reason) => {
            clearTimeout(timeout);
            
            // Check if this was an intentional disconnect (normal poll completion)
            // If intentional, don't count toward rapid disconnect threshold
            const wasIntentional = this.intentionalDisconnect;
            this.intentionalDisconnect = false; // Reset flag
            
            // Check for rapid disconnect (disconnect within threshold of connect)
            // Only count as rapid if NOT intentional (error/unexpected disconnects)
            const isRapidDisconnect = !wasIntentional && this.lastConnectedAt && 
              (Date.now() - this.lastConnectedAt) < RAPID_DISCONNECT_THRESHOLD_MS;
            
            if (isRapidDisconnect) {
              this.rapidDisconnectCount++;
              this.log.warn('Rapid disconnect detected (error)', { 
                reason, 
                rapidDisconnects: this.rapidDisconnectCount,
                connectionDurationMs: Date.now() - this.lastConnectedAt
              });
              
              // Check if we should open the circuit breaker
              if (this.rapidDisconnectCount >= MAX_RAPID_DISCONNECTS) {
                this.isCircuitOpen = true;
                this.circuitResetAt = Date.now() + UNSTABLE_BACKOFF_MS;
                this.log.error('Circuit breaker OPEN - too many rapid disconnects', {
                  rapidDisconnects: this.rapidDisconnectCount,
                  backoffMinutes: UNSTABLE_BACKOFF_MS / 60000,
                  resetAt: new Date(this.circuitResetAt).toISOString()
                });
                
                // Persist unstable status to database immediately
                // This ensures the device is skipped on process restart
                db.markDeviceUnstable(this.deviceId)
                  .catch(err => this.log.error('Failed to mark device unstable in database', { error: err.message }));
              }
            } else if (wasIntentional) {
              this.log.debug('Intentional disconnect (normal poll completion)', { reason });
            }
            
            if (this.status === 'connecting') {
              this.log.warn('Connection failed during connect', { reason });
              this.status = 'disconnected';
              // Track disconnect reason even during connection phase (not intentional)
              db.markDeviceDisconnected(this.deviceId, this.lastSuccessfulPollAt, reason)
                .catch(err => this.log.error('Failed to update disconnect status', { error: err.message }));
              resolve(false);
            } else if (wasIntentional) {
              // Intentional disconnect (normal poll completion) - don't track in database
              // Don't schedule reconnect since this was intentional
              this.status = 'disconnected';
            } else {
              this.log.info('Device disconnected (unexpected)', { reason, isRapidDisconnect });
              this.status = 'disconnected';
              // Only track unexpected disconnects in database
              db.markDeviceDisconnected(this.deviceId, this.lastSuccessfulPollAt, reason)
                .then(() => {
                  // Use longer backoff if circuit breaker is open
                  if (this.isCircuitOpen) {
                    this.log.info('Skipping reconnect - circuit breaker open');
                  } else {
                    this.scheduleReconnect();
                  }
                })
                .catch(err => {
                  this.log.error('Failed to update disconnect status', { error: err.message });
                  if (!this.isCircuitOpen) {
                    this.scheduleReconnect();
                  }
                });
            }
          }
        });
      } catch (err) {
        this.status = 'disconnected';
        this.log.error('Connection failed', { error: err.message });
        resolve(false);
      }
    });
  }

  /**
   * Disconnect from the device
   * @param {boolean} intentional - If true, this is a normal disconnect (not an error)
   */
  disconnect(intentional = true) {
    if (this.device) {
      try {
        // Mark as intentional so circuit breaker doesn't count it
        this.intentionalDisconnect = intentional;
        this.device.disconnect();
      } catch (err) {
        this.log.warn('Error during disconnect', { error: err.message });
      }
      this.device = null;
    }
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.status = 'disconnected';
    this.log.info('Disconnected');
  }

  /**
   * Fetch device info from PowerMon and update database
   * Called on first successful connection to auto-populate device details
   */
  async fetchAndUpdateDeviceInfo() {
    if (!this.device) return;
    
    try {
      // Get device info using callback API (method is 'getInfo' not 'getDeviceInfo')
      this.device.getInfo((result) => {
        if (!result.success) {
          this.log.warn('Failed to get device info', { code: result.code });
          return;
        }
        
        const info = result.data;
        const deviceInfo = {};
        
        // Map PowerMon info fields to database fields
        // PowerMon returns: serial, firmwareVersion, hardwareRevision, hardwareString, name
        if (info.serial) deviceInfo.serialNumber = info.serial;
        if (info.firmwareVersion) deviceInfo.firmwareVersion = info.firmwareVersion;
        if (info.hardwareString) deviceInfo.hardwareRevision = info.hardwareString;
        if (info.name) deviceInfo.deviceName = info.name;
        
        if (Object.keys(deviceInfo).length > 0) {
          this.log.info('Fetched device info from PowerMon', deviceInfo);
          db.updateDeviceInfo(this.deviceId, deviceInfo).catch((err) => {
            this.log.error('Failed to update device info in database', { error: err.message });
          });
        }
      });
    } catch (err) {
      this.log.warn('Error fetching device info', { error: err.message });
    }
  }

  /**
   * Poll the device for current data
   */
  poll() {
    if (this.status !== 'connected' || !this.device) {
      return Promise.resolve(null);
    }

    this.lastPollAt = new Date();

    return new Promise((resolve) => {
      try {
        // Get monitor data from device using callback API
        this.device.getMonitorData((result) => {
          if (!result.success) {
            this.consecutiveFailures++;
            this.log.warn('Poll failed', { 
              code: result.code, 
              failures: this.consecutiveFailures 
            });

            // Mark as disconnected if too many failures
            if (this.consecutiveFailures >= 3) {
              // Persist the failure to DB first (this increments consecutive_disconnects)
              db.markDeviceDisconnected(this.deviceId, this.lastSuccessfulPollAt)
                .then(() => {
                  // Disconnect with intentional=true since we already tracked the failure
                  // This prevents double-counting in onDisconnect
                  this.disconnect(true);
                  this.scheduleReconnect();
                });
            }

            resolve(null);
            return;
          }

          const data = result.data;
          this.lastSuccessfulPollAt = this.lastPollAt;
          this.consecutiveFailures = 0;
          
          // Reset rapid disconnect counter on successful poll
          // This gives the device a clean slate after stable operation
          // Always persist to DB to ensure memory/DB parity across restarts
          if (this.rapidDisconnectCount > 0) {
            this.log.debug('Resetting rapid disconnect count after successful poll', {
              previousCount: this.rapidDisconnectCount
            });
            this.rapidDisconnectCount = 0;
          }
          // Always sync to DB to handle cases where process restarts with stale data
          db.resetDeviceDisconnects(this.deviceId)
            .catch(err => this.log.warn('Failed to reset disconnect count in DB', { error: err.message }));

          // Calculate Wh from SoC and battery configuration
          // Formula: Wh = (SoC/100) × batteryVoltage × (numberOfBatteries × batteryAh)
          // Falls back to PowerMon energyMeter if battery config is missing
          const calculatedWh = this.calculateWh(data.soc);
          const energyValue = calculatedWh !== null ? calculatedWh : data.energyMeter;

          // Transform to measurement format
          const measurement = {
            organizationId: this.orgId,
            deviceId: this.deviceId,
            truckId: this.truckId,
            fleetId: null, // Will be looked up if needed
            voltage1: data.voltage1,
            voltage2: data.voltage2,
            current: data.current,
            power: data.power,
            temperature: data.temperature,
            soc: data.soc,
            energy: energyValue,
            charge: data.coulombMeter,
            runtime: data.runtime,
            rssi: data.rssi,
            powerStatus: data.powerStatus,
            powerStatusString: data.powerStatusString,
            source: 'poll',
            recordedAt: this.lastPollAt,
          };

          this.log.debug('Poll successful', { soc: data.soc, voltage: data.voltage1, calculatedWh: calculatedWh !== null });
          resolve(measurement);
        });
      } catch (err) {
        this.consecutiveFailures++;
        this.log.warn('Poll exception', { 
          error: err.message, 
          failures: this.consecutiveFailures 
        });
        resolve(null);
      }
    });
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= config.connection.maxReconnectAttempts) {
      this.log.error('Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(
      config.connection.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts),
      config.connection.maxReconnectDelayMs
    );

    this.status = 'reconnecting';
    this.reconnectAttempts++;

    this.log.info('Scheduling reconnect', { 
      attempt: this.reconnectAttempts, 
      delayMs: delay 
    });

    this.reconnectTimer = setTimeout(async () => {
      const success = await this.connect();
      if (!success) {
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Check if device is ready for polling
   */
  isReady() {
    return this.status === 'connected' && this.device !== null;
  }
}

/**
 * Connection Pool Manager
 * 
 * Manages all device connections, organized by cohort.
 */
class ConnectionPool {
  constructor() {
    this.connections = new Map(); // deviceId -> DeviceConnection
    this.cohorts = new Map(); // cohortId -> Set of deviceIds
    this.isRunning = false;
  }

  /**
   * Initialize the connection pool with devices from database
   */
  async initialize() {
    logger.info('Initializing connection pool');

    const devices = await db.getActiveDevicesWithCredentials();
    logger.info('Found active devices', { count: devices.length });

    // Assign devices to cohorts using hash-based sharding
    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      const cohortId = this.hashToCohort(device.serial_number);
      
      // Create connection object
      const conn = new DeviceConnection({
        ...device,
        cohort_id: cohortId,
      });
      
      this.connections.set(device.device_id, conn);
      
      // Add to cohort
      if (!this.cohorts.has(cohortId)) {
        this.cohorts.set(cohortId, new Set());
      }
      this.cohorts.get(cohortId).add(device.device_id);
      
      // Update cohort assignment in database
      await db.upsertDeviceSyncStatus(device.device_id, device.organization_id, cohortId);
    }

    logger.info('Connection pool initialized', { 
      devices: this.connections.size,
      cohorts: this.cohorts.size 
    });

    return this.connections.size;
  }

  /**
   * Hash a serial number to a cohort ID
   */
  hashToCohort(serialNumber) {
    let hash = 0;
    for (let i = 0; i < serialNumber.length; i++) {
      hash = ((hash << 5) - hash) + serialNumber.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % config.polling.cohortCount;
  }

  /**
   * Connect to all devices
   */
  async connectAll() {
    logger.info('Connecting to all devices');
    
    const results = { success: 0, failed: 0 };
    
    for (const conn of this.connections.values()) {
      const success = await conn.connect();
      if (success) {
        results.success++;
      } else {
        results.failed++;
      }
    }

    logger.info('Connection results', results);
    return results;
  }

  /**
   * Get devices in a specific cohort
   */
  getCohortDevices(cohortId) {
    const deviceIds = this.cohorts.get(cohortId) || new Set();
    return Array.from(deviceIds).map(id => this.connections.get(id)).filter(Boolean);
  }

  /**
   * Get all cohort IDs
   */
  getCohortIds() {
    return Array.from(this.cohorts.keys()).sort((a, b) => a - b);
  }

  /**
   * Get a specific device connection
   */
  getConnection(deviceId) {
    return this.connections.get(deviceId);
  }

  /**
   * Get all connections
   */
  getAllConnections() {
    return Array.from(this.connections.values());
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const stats = {
      totalDevices: this.connections.size,
      connected: 0,
      connecting: 0,
      disconnected: 0,
      reconnecting: 0,
      cohorts: this.cohorts.size,
    };

    for (const conn of this.connections.values()) {
      stats[conn.status]++;
    }

    return stats;
  }

  /**
   * Refresh device list from database
   */
  async refresh() {
    logger.info('Refreshing device list');
    
    const devices = await db.getActiveDevicesWithCredentials();
    const currentIds = new Set(this.connections.keys());
    const newIds = new Set(devices.map(d => d.device_id));

    // Remove devices no longer in database
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        const conn = this.connections.get(id);
        if (conn) {
          conn.disconnect();
          this.connections.delete(id);
          // Remove from cohort
          for (const cohort of this.cohorts.values()) {
            cohort.delete(id);
          }
        }
        logger.info('Removed device from pool', { deviceId: id });
      }
    }

    // Add new devices
    for (const device of devices) {
      if (!currentIds.has(device.device_id)) {
        const cohortId = this.hashToCohort(device.serial_number);
        const conn = new DeviceConnection({
          ...device,
          cohort_id: cohortId,
        });
        
        this.connections.set(device.device_id, conn);
        
        if (!this.cohorts.has(cohortId)) {
          this.cohorts.set(cohortId, new Set());
        }
        this.cohorts.get(cohortId).add(device.device_id);
        
        await db.upsertDeviceSyncStatus(device.device_id, device.organization_id, cohortId);
        
        // Attempt to connect
        await conn.connect();
        
        logger.info('Added device to pool', { deviceId: device.device_id, cohort: cohortId });
      }
    }

    logger.info('Device list refreshed', { 
      total: this.connections.size,
      added: devices.length - currentIds.size,
      removed: currentIds.size - newIds.size 
    });
  }

  /**
   * Attempt to recover unstable devices that have been waiting long enough
   * Called periodically to give unstable devices a chance to reconnect
   */
  async recoverUnstableDevices() {
    logger.debug('Checking for unstable devices ready for recovery');
    
    try {
      // Get devices that have been unstable for longer than the backoff period
      const unstableDevices = await db.getUnstableDevicesReadyForRecovery(UNSTABLE_BACKOFF_MS);
      
      if (unstableDevices.length === 0) {
        return { attempted: 0, recovered: 0 };
      }
      
      logger.info('Attempting to recover unstable devices', { 
        count: unstableDevices.length,
        devices: unstableDevices.map(d => d.device_name || d.serial_number)
      });
      
      let recovered = 0;
      
      for (const device of unstableDevices) {
        const cohortId = this.hashToCohort(device.serial_number);
        
        // Check if device is already in the pool (shouldn't be, but check anyway)
        if (this.connections.has(device.device_id)) {
          logger.warn('Unstable device already in pool, skipping', { deviceId: device.device_id });
          continue;
        }
        
        // Create new connection with reset state
        const conn = new DeviceConnection({
          ...device,
          cohort_id: cohortId,
          consecutive_disconnects: 0, // Reset for fresh start
        });
        
        // Add to pool
        this.connections.set(device.device_id, conn);
        
        if (!this.cohorts.has(cohortId)) {
          this.cohorts.set(cohortId, new Set());
        }
        this.cohorts.get(cohortId).add(device.device_id);
        
        // Attempt to connect
        const success = await conn.connect();
        
        if (success) {
          // Connection successful - stability will be reset by markDeviceConnected
          recovered++;
          logger.info('Unstable device recovered successfully', { 
            deviceId: device.device_id,
            serial: device.serial_number
          });
        } else {
          // Connection failed - remove from pool and let it try again later
          this.connections.delete(device.device_id);
          this.cohorts.get(cohortId)?.delete(device.device_id);
          
          // Update marked_unstable_at to restart the backoff timer
          await db.markDeviceUnstable(device.device_id);
          
          logger.warn('Unstable device recovery failed, will retry later', { 
            deviceId: device.device_id,
            serial: device.serial_number
          });
        }
      }
      
      logger.info('Unstable device recovery complete', { 
        attempted: unstableDevices.length, 
        recovered 
      });
      
      return { attempted: unstableDevices.length, recovered };
    } catch (err) {
      logger.error('Error recovering unstable devices', { error: err.message });
      return { attempted: 0, recovered: 0, error: err.message };
    }
  }

  /**
   * Disconnect all devices
   */
  disconnectAll() {
    logger.info('Disconnecting all devices');
    
    for (const conn of this.connections.values()) {
      conn.disconnect();
    }
    
    this.connections.clear();
    this.cohorts.clear();
    
    logger.info('All devices disconnected');
  }
}

// Singleton instance
const connectionPool = new ConnectionPool();

module.exports = { connectionPool, DeviceConnection };
