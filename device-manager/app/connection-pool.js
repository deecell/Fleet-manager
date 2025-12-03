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

// Load the native addon
let powermon;
try {
  powermon = require(path.join(__dirname, '../build/Release/powermon_addon.node'));
} catch (err) {
  logger.error('Failed to load PowerMon addon', { error: err.message });
  powermon = null;
}

/**
 * Connection state for a single device
 */
class DeviceConnection {
  constructor(deviceInfo) {
    this.deviceId = deviceInfo.device_id;
    this.orgId = deviceInfo.organization_id;
    this.serialNumber = deviceInfo.serial_number;
    this.deviceName = deviceInfo.device_name;
    this.truckId = deviceInfo.truck_id;
    this.applinkUrl = deviceInfo.applink_url;
    this.cohortId = deviceInfo.cohort_id || 0;
    
    this.device = null; // PowerMon device instance
    this.status = 'disconnected'; // disconnected, connecting, connected, reconnecting
    this.lastPollAt = null;
    this.lastSuccessfulPollAt = deviceInfo.last_successful_poll_at;
    this.consecutiveFailures = 0;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    
    this.log = logger.child({ 
      deviceId: this.deviceId, 
      serial: this.serialNumber,
      cohort: this.cohortId 
    });
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
            this.log.info('Connected successfully');
            
            await db.markDeviceConnected(this.deviceId);
            
            // Fetch and update device info on first connection
            await this.fetchAndUpdateDeviceInfo();
            
            resolve(true);
          },
          onDisconnect: (reason) => {
            clearTimeout(timeout);
            if (this.status === 'connecting') {
              this.log.warn('Connection failed during connect', { reason });
              this.status = 'disconnected';
              resolve(false);
            } else {
              this.log.info('Device disconnected', { reason });
              this.status = 'disconnected';
              this.scheduleReconnect();
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
   */
  disconnect() {
    if (this.device) {
      try {
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
      // Get device info using callback API
      this.device.getDeviceInfo((result) => {
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
              this.status = 'disconnected';
              db.markDeviceDisconnected(this.deviceId, this.lastSuccessfulPollAt)
                .then(() => this.scheduleReconnect());
            }

            resolve(null);
            return;
          }

          const data = result.data;
          this.lastSuccessfulPollAt = this.lastPollAt;
          this.consecutiveFailures = 0;

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
            energy: data.energyMeter,
            charge: data.coulombMeter,
            runtime: data.runtime,
            rssi: data.rssi,
            powerStatus: data.powerStatus,
            powerStatusString: data.powerStatusString,
            source: 'poll',
            recordedAt: this.lastPollAt,
          };

          this.log.debug('Poll successful', { soc: data.soc, voltage: data.voltage1 });
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
