/**
 * Connection Pool Manager
 * 
 * Maintains persistent connections to PowerMon devices.
 * Devices are sharded into cohorts for staggered polling.
 */

const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
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
// Global shutdown flag - set when any device triggers a circuit breaker crash.
// Prevents ALL devices from making native library calls during the graceful exit window,
// since the native C++ library's global state is corrupted and any call can SIGABRT.
let nativeLibraryShutdown = false;

// Module-level pool reference for circuit breaker to null out ALL native device refs
let poolInstance = null;

// Circuit breaker configuration
const RAPID_DISCONNECT_THRESHOLD_MS = 5000; // Disconnect within 5s of connect = rapid
const MAX_RAPID_DISCONNECTS = 3; // After 3 rapid disconnects, mark as unstable/no_power
const UNSTABLE_BACKOFF_MS = 300000; // 5 minutes backoff for unstable devices
const NO_POWER_QUARANTINE_MS = 5 * 60 * 1000; // 5 minutes quarantine for no_power devices
const NO_POWER_RETRY_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const OFFLINE_BACKOFF_MS = 600000; // 10 minutes backoff for offline devices
const NO_POWER_INSTANT_THRESHOLD_MS = 200; // Connection shorter than this = "instant" (was 100ms)
const POST_ERROR_RECONNECT_DELAY_MS = 5000; // Longer delay after a poll failure before reconnecting
const RAPID_DISCONNECT_GRACE_RECONNECTS = 2; // Don't count rapid disconnects for the first N reconnects after a poll failure

/**
 * Ping an applink URL to check if the device router is reachable
 * This is used before attempting to connect to an offline device
 * to avoid crashing the native library on unreachable devices
 * 
 * @param {string} applinkUrl - The applink URL to ping
 * @param {number} timeoutMs - Timeout in milliseconds (default 5000)
 * @returns {Promise<boolean>} - True if reachable, false otherwise
 */
async function pingApplinkUrl(applinkUrl, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const url = new URL(applinkUrl);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;
      const defaultPort = isHttps ? 443 : 80;
      
      const req = httpModule.request({
        hostname: url.hostname,
        port: url.port || defaultPort,
        path: url.pathname + url.search,
        method: 'HEAD',
        timeout: timeoutMs,
        rejectUnauthorized: false, // Accept self-signed certs
      }, (res) => {
        // Any response means the server is reachable
        resolve(true);
      });
      
      req.on('error', (err) => {
        logger.debug('Ping failed', { url: applinkUrl, error: err.message });
        resolve(false);
      });
      
      req.on('timeout', () => {
        req.destroy();
        logger.debug('Ping timed out', { url: applinkUrl });
        resolve(false);
      });
      
      req.end();
    } catch (err) {
      logger.debug('Ping exception', { url: applinkUrl, error: err.message });
      resolve(false);
    }
  });
}

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
    this.graceReconnectsRemaining = 0; // Grace period after poll failure — don't count rapid disconnects
    this.hadRecentPollFailure = false; // Track if last disconnect was preceded by a poll failure
    
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
   * @returns {Promise<{success: boolean, durationMs: number}>} Connection result with timing
   */
  connect() {
    const connectStartTime = Date.now();
    
    if (!powermon) {
      this.log.error('PowerMon addon not available');
      return Promise.resolve({ success: false, durationMs: Date.now() - connectStartTime });
    }

    if (nativeLibraryShutdown) {
      this.log.debug('Skipping connection - native library shutdown in progress');
      return Promise.resolve({ success: false, durationMs: 0, skipped: true });
    }

    if (this.status === 'connected') {
      return Promise.resolve({ success: true, durationMs: 0 });
    }
    
    // Circuit breaker check
    if (this.shouldSkipConnection()) {
      this.log.debug('Skipping connection - circuit breaker open', {
        rapidDisconnects: this.rapidDisconnectCount,
        resetAt: this.circuitResetAt
      });
      return Promise.resolve({ success: false, durationMs: 0, skipped: true });
    }

    this.status = 'connecting';
    this.log.info('Connecting to device');

    return new Promise((resolve) => {
      try {
        // Record active device for crash attribution
        // If the native library crashes during connect, the next startup
        // can identify this device as the culprit
        db.recordActiveDevice(this.deviceId, this.deviceName);
        
        // Parse applink URL to get access key
        const parsed = powermon.PowermonDevice.parseAccessURL(this.applinkUrl);
        
        // Create device instance
        this.device = new powermon.PowermonDevice();
        
        // Set connection timeout
        const timeout = setTimeout(() => {
          const durationMs = Date.now() - connectStartTime;
          this.log.warn('Connection timeout', { durationMs });
          this.status = 'disconnected';
          if (this.device) {
            if (nativeLibraryShutdown) {
              this.device = null;
            } else {
              this.intentionalDisconnect = false;
              this.device.disconnect();
              this.device = null;
            }
          }
          resolve({ success: false, durationMs, timedOut: true });
        }, 15000);
        
        // Connect via WiFi using the parsed access key
        this.device.connect({
          accessKey: parsed.accessKey,
          onConnect: async () => {
            clearTimeout(timeout);
            db.recordActiveDevice(null);
            const durationMs = Date.now() - connectStartTime;
            this.status = 'connected';
            this.consecutiveFailures = 0;
            this.reconnectAttempts = 0;
            this.lastConnectedAt = Date.now();
            this.log.info('Connected successfully', { durationMs });
            
            await db.markDeviceConnected(this.deviceId);
            
            // Fetch and update device info on first connection
            // Guard: skip if device already disconnected or circuit breaker opened
            if (this.device && this.status === 'connected' && !this.isCircuitOpen) {
              await this.fetchAndUpdateDeviceInfo();
            }
            
            resolve({ success: true, durationMs });
          },
          onDisconnect: (reason) => {
            clearTimeout(timeout);
            db.recordActiveDevice(null);
            
            const connDurationMs = this.lastConnectedAt ? Date.now() - this.lastConnectedAt : null;
            const hadSuccessfulPoll = this.lastSuccessfulPollAt && this.lastConnectedAt && 
              this.lastSuccessfulPollAt.getTime() >= this.lastConnectedAt;
            
            this.log.info('onDisconnect fired', {
              reason: reason || 'none',
              connDurationMs,
              hadSuccessfulPoll: !!hadSuccessfulPoll,
              wasConnected: this.status === 'connected',
              consecutiveFailures: this.consecutiveFailures,
              rapidDisconnects: this.rapidDisconnectCount,
            });
            
            // Check if this was an intentional disconnect (normal poll completion)
            // If intentional, don't count toward rapid disconnect threshold
            const wasIntentional = this.intentionalDisconnect;
            this.intentionalDisconnect = false; // Reset flag
            
            // Check for rapid disconnect (disconnect within threshold of connect)
            // Only count as rapid if NOT intentional (error/unexpected disconnects)
            const isRapidDisconnect = !wasIntentional && this.lastConnectedAt && 
              connDurationMs !== null && connDurationMs < RAPID_DISCONNECT_THRESHOLD_MS;
            
            if (isRapidDisconnect) {
              if (this.graceReconnectsRemaining > 0) {
                this.graceReconnectsRemaining--;
                this.log.info('Rapid disconnect during grace period, not counting', {
                  reason,
                  connectionDurationMs: connDurationMs,
                  graceRemaining: this.graceReconnectsRemaining,
                });
                this.status = 'disconnected';
                db.markDeviceDisconnected(this.deviceId, this.lastSuccessfulPollAt, reason)
                  .catch(err => this.log.error('Failed to update disconnect status', { error: err.message }));
                this.scheduleReconnect();
                return;
              }

              this.rapidDisconnectCount++;
              if (!this.rapidDisconnectDurations) this.rapidDisconnectDurations = [];
              this.rapidDisconnectDurations.push(connDurationMs);
              this.log.warn('Rapid disconnect detected (error)', { 
                reason, 
                rapidDisconnects: this.rapidDisconnectCount,
                connectionDurationMs: connDurationMs
              });
              
              // Instant disconnect (< 200ms) = likely connectivity/power issue.
              // 1st instant disconnect → weak_signal (yellow warning, device stays in pool)
              // 2nd instant disconnect → no_power (circuit breaker, process restart)
              const isInstantDisconnect = connDurationMs < NO_POWER_INSTANT_THRESHOLD_MS;
              const instantDisconnectCount = (this.rapidDisconnectDurations || []).filter(d => d < NO_POWER_INSTANT_THRESHOLD_MS).length;
              
              // Mark as weak_signal on first instant disconnect (early warning)
              if (isInstantDisconnect && instantDisconnectCount === 1) {
                this.log.warn('Weak signal detected - 1st instant disconnect, marking weak_signal', {
                  connectionDurationMs: connDurationMs,
                  deviceName: this.deviceName,
                });
                db.markDeviceWeakSignal(this.deviceId)
                  .catch(err => this.log.error('Failed to mark device weak_signal', { error: err.message }));
                
                // Run diagnostic but don't open circuit breaker — device stays in pool
                (async () => {
                  try {
                    const routerReachable = this.applinkUrl ? await pingApplinkUrl(this.applinkUrl, 3000) : null;
                    const gpsData = await db.getTruckLastGpsUpdate(this.truckId);
                    const gpsAge = gpsData?.last_location_update 
                      ? Math.round((Date.now() - new Date(gpsData.last_location_update).getTime()) / 60000)
                      : null;
                    logger.warn('WEAK_SIGNAL DIAGNOSTIC', {
                      deviceId: this.deviceId,
                      deviceName: this.deviceName,
                      truckId: this.truckId,
                      routerReachable,
                      gpsLastUpdate: gpsData?.last_location_update || null,
                      gpsAgeMinutes: gpsAge,
                      gpsLocation: gpsData?.location_description || null,
                    });
                  } catch (err) {
                    logger.warn('WEAK_SIGNAL DIAGNOSTIC failed', { error: err.message });
                  }
                })();
              }
              
              const shouldOpenCircuit = (isInstantDisconnect && instantDisconnectCount >= 2) || 
                this.rapidDisconnectCount >= MAX_RAPID_DISCONNECTS;
              
              if (shouldOpenCircuit) {
                this.isCircuitOpen = true;
                this.circuitResetAt = Date.now() + UNSTABLE_BACKOFF_MS;
                
                const status = (isInstantDisconnect && instantDisconnectCount >= 2) ? 'no_power' : 'unstable';
                
                if (isInstantDisconnect && instantDisconnectCount >= 2) {
                  this.log.error('Circuit breaker OPEN - 2 instant disconnects, device appears powered off', {
                    rapidDisconnects: this.rapidDisconnectCount,
                    instantDisconnects: instantDisconnectCount,
                    connectionDurationMs: connDurationMs,
                    backoffMinutes: UNSTABLE_BACKOFF_MS / 60000,
                    resetAt: new Date(this.circuitResetAt).toISOString()
                  });
                } else {
                  this.log.error('Circuit breaker OPEN - too many rapid disconnects', {
                    rapidDisconnects: this.rapidDisconnectCount,
                    backoffMinutes: UNSTABLE_BACKOFF_MS / 60000,
                    resetAt: new Date(this.circuitResetAt).toISOString()
                  });
                }
                
                this.rapidDisconnectDurations = [];
                
                // CRITICAL: Immediately null out native device references for ALL
                // devices in the pool, not just the one that triggered the circuit breaker.
                // The native C++ library corruption is GLOBAL — any pending callback
                // from any device can trigger SIGABRT. Nulling the device reference
                // causes pending callbacks to find `this.device === null` and bail out
                // before touching the corrupted native state.
                this.device = null;
                this.status = 'disconnected';
                
                if (poolInstance) {
                  let nulledCount = 0;
                  for (const conn of poolInstance.connections.values()) {
                    if (conn.deviceId !== this.deviceId && conn.device) {
                      conn.device = null;
                      conn.status = 'disconnected';
                      if (conn.reconnectTimer) {
                        clearTimeout(conn.reconnectTimer);
                        conn.reconnectTimer = null;
                      }
                      nulledCount++;
                    }
                  }
                  logger.warn('Nulled native references for all pool devices', { 
                    nulledCount, 
                    triggerDevice: this.deviceId 
                  });
                }
                
                // Clear any pending reconnect timer for the trigger device
                if (this.reconnectTimer) {
                  clearTimeout(this.reconnectTimer);
                  this.reconnectTimer = null;
                }
                
                // Persist status to database immediately
                // This ensures the device is skipped on process restart
                // CRITICAL: Schedule graceful process exit after circuit breaker.
                // Any rapid connect/disconnect cycle corrupts the native C++ library's
                // global state. The corruption is cumulative and manifests asynchronously
                // on later native callbacks (SIGABRT crash). The ONLY safe action is to
                // exit the process so systemd restarts it with a clean native library.
                // We delay 3 seconds to allow the DB write and any in-flight writes to complete.
                nativeLibraryShutdown = true;
                logger.error('NATIVE LIBRARY COMPROMISED - blocking all native calls, scheduling graceful restart', {
                  deviceId: this.deviceId,
                  deviceName: this.deviceName,
                  status,
                  restartInMs: 3000
                });
                
                db.markDeviceUnstable(this.deviceId, status)
                  .catch(err => this.log.error('Failed to mark device status in database', { error: err.message }));
                
                // Diagnostic: check if router is reachable and if GPS is still reporting
                // This helps determine if no_power is truly a power issue or a connectivity issue
                (async () => {
                  try {
                    const routerReachable = this.applinkUrl ? await pingApplinkUrl(this.applinkUrl, 3000) : null;
                    const gpsData = await db.getTruckLastGpsUpdate(this.truckId);
                    const gpsAge = gpsData?.last_location_update 
                      ? Math.round((Date.now() - new Date(gpsData.last_location_update).getTime()) / 60000)
                      : null;
                    logger.warn('NO_POWER DIAGNOSTIC', {
                      deviceId: this.deviceId,
                      deviceName: this.deviceName,
                      truckId: this.truckId,
                      routerReachable,
                      gpsLastUpdate: gpsData?.last_location_update || null,
                      gpsAgeMinutes: gpsAge,
                      gpsLocation: gpsData?.location_description || null,
                      verdict: routerReachable 
                        ? 'ROUTER REACHABLE - likely connectivity issue, NOT power loss'
                        : gpsAge != null && gpsAge < 5
                          ? 'GPS recent (<5m) but router unreachable - likely transient network issue'
                          : 'Router unreachable, no recent GPS - could be actual power loss'
                    });
                  } catch (err) {
                    logger.warn('NO_POWER DIAGNOSTIC failed', { error: err.message });
                  }
                })();
                
                // Exit regardless of DB write success — corrupted native state MUST be discarded
                setTimeout(() => {
                  logger.error('Exiting process for clean native library restart');
                  process.exit(1);
                }, 3000);
                
                // Return early — do NOT fall through to reconnect/disconnect handling
                return;
              }
            } else if (wasIntentional) {
              this.log.debug('Intentional disconnect (normal poll completion)', { reason });
            }
            
            if (this.status === 'connecting') {
              const durationMs = Date.now() - connectStartTime;
              this.log.warn('Connection failed during connect', { reason, durationMs });
              this.status = 'disconnected';
              // Track disconnect reason even during connection phase (not intentional)
              db.markDeviceDisconnected(this.deviceId, this.lastSuccessfulPollAt, reason)
                .catch(err => this.log.error('Failed to update disconnect status', { error: err.message }));
              resolve({ success: false, durationMs, reason });
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
        db.recordActiveDevice(null);
        const durationMs = Date.now() - connectStartTime;
        this.status = 'disconnected';
        this.log.error('Connection failed', { error: err.message, durationMs });
        resolve({ success: false, durationMs, error: err.message });
      }
    });
  }

  /**
   * Disconnect from the device
   * @param {boolean} intentional - If true, this is a normal disconnect (not an error)
   */
  disconnect(intentional = true) {
    if (this.device) {
      if (nativeLibraryShutdown) {
        this.device = null;
      } else {
        try {
          this.intentionalDisconnect = intentional;
          this.device.disconnect();
        } catch (err) {
          this.log.warn('Error during disconnect', { error: err.message });
        }
        this.device = null;
      }
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
    if (nativeLibraryShutdown || !this.device || this.status !== 'connected' || this.isCircuitOpen) return;
    
    try {
      const device = this.device;
      // Get device info using callback API (method is 'getInfo' not 'getDeviceInfo')
      device.getInfo((result) => {
        if (!this.device || this.isCircuitOpen) return;
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
    if (nativeLibraryShutdown || this.status !== 'connected' || !this.device) {
      return Promise.resolve(null);
    }

    this.lastPollAt = new Date();

    return new Promise((resolve) => {
      try {
        // Get monitor data from device using callback API
        const device = this.device;
        device.getMonitorData((result) => {
          // Bail immediately if native library was compromised while callback was in-flight
          if (nativeLibraryShutdown || !this.device) {
            resolve(null);
            return;
          }
          if (!result.success) {
            this.consecutiveFailures++;
            this.log.warn('Poll failed', { 
              code: result.code, 
              failures: this.consecutiveFailures 
            });

            // Mark as disconnected if too many failures
            if (this.consecutiveFailures >= 3) {
              this.hadRecentPollFailure = true;
              this.graceReconnectsRemaining = RAPID_DISCONNECT_GRACE_RECONNECTS;
              this.log.info('Poll failure threshold reached, granting reconnect grace period', {
                graceReconnects: RAPID_DISCONNECT_GRACE_RECONNECTS,
              });
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
          this.hadRecentPollFailure = false;
          this.graceReconnectsRemaining = 0;
          
          // Reset rapid disconnect counter and durations on successful poll
          // This gives the device a clean slate after stable operation
          // Always persist to DB to ensure memory/DB parity across restarts
          if (this.rapidDisconnectCount > 0) {
            this.log.debug('Resetting rapid disconnect count after successful poll', {
              previousCount: this.rapidDisconnectCount,
              previousDurations: this.rapidDisconnectDurations
            });
            this.rapidDisconnectCount = 0;
            this.rapidDisconnectDurations = [];
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
    if (nativeLibraryShutdown) return;

    if (this.reconnectAttempts >= config.connection.maxReconnectAttempts) {
      this.log.error('Max reconnect attempts reached');
      return;
    }

    let delay = Math.min(
      config.connection.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts),
      config.connection.maxReconnectDelayMs
    );

    if (this.hadRecentPollFailure && this.reconnectAttempts === 0) {
      delay = Math.max(delay, POST_ERROR_RECONNECT_DELAY_MS);
      this.log.info('Using longer reconnect delay after poll failure', { delayMs: delay });
    }

    this.status = 'reconnecting';
    this.reconnectAttempts++;

    this.log.info('Scheduling reconnect', { 
      attempt: this.reconnectAttempts, 
      delayMs: delay 
    });

    this.reconnectTimer = setTimeout(async () => {
      const result = await this.connect();
      if (!result.success) {
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
    poolInstance = this;
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
   * Initialize the connection pool for a specific cohort only (worker mode).
   * Queries all active devices, filters to devices that hash to this cohort.
   */
  async initializeForCohort(cohortId, totalCohorts) {
    logger.info(`Initializing connection pool for cohort ${cohortId}/${totalCohorts}`);

    const allDevices = await db.getActiveDevicesWithCredentials();
    const myDevices = allDevices.filter(d => this.hashToCohort(d.serial_number, totalCohorts) === cohortId);

    logger.info(`Cohort ${cohortId}: ${myDevices.length} devices (of ${allDevices.length} total)`);

    for (const device of myDevices) {
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
    }

    logger.info(`Connection pool initialized for cohort ${cohortId}`, {
      devices: this.connections.size,
    });

    return this.connections.size;
  }

  async initializeForSoloDevice(serial) {
    logger.info(`Initializing connection pool for solo device`, { serial });

    const device = await db.getDeviceForRecovery(serial);
    if (!device) {
      logger.error(`Solo device not found in database`, { serial });
      return 0;
    }

    if (device.device_connection_status !== 'no_power') {
      logger.warn(`Solo device status is ${device.device_connection_status}, not no_power — aborting probe`, { serial });
      return 0;
    }

    await db.query(
      `UPDATE power_mon_devices SET connection_status = 'probing', consecutive_disconnects = 0, updated_at = NOW() WHERE id = $1`,
      [device.device_id]
    );

    const cohortId = this.hashToCohort(device.serial_number);
    const conn = new DeviceConnection({
      ...device,
      cohort_id: cohortId,
      consecutive_disconnects: 0,
    });

    this.connections.set(device.device_id, conn);
    if (!this.cohorts.has(cohortId)) {
      this.cohorts.set(cohortId, new Set());
    }
    this.cohorts.get(cohortId).add(device.device_id);

    await db.upsertDeviceSyncStatus(device.device_id, device.organization_id, cohortId);

    logger.info(`Solo device initialized`, {
      serial,
      deviceId: device.device_id,
      deviceName: device.device_name,
    });
    return 1;
  }

  /**
   * Check for new devices that belong to this worker's cohort
   */
  async checkForNewDevicesInCohort(cohortId, totalCohorts) {
    const allDevices = await db.getActiveDevicesWithCredentials();
    const myDevices = allDevices.filter(d => this.hashToCohort(d.serial_number, totalCohorts) === cohortId);

    let added = 0;
    for (const device of myDevices) {
      if (this.connections.has(device.device_id)) continue;

      logger.info('Found newly activated device in cohort', {
        serialNumber: device.serial_number,
        deviceName: device.device_name,
        cohortId,
      });

      const conn = new DeviceConnection({
        ...device,
        cohort_id: cohortId,
        consecutive_disconnects: 0,
      });

      this.connections.set(device.device_id, conn);
      if (!this.cohorts.has(cohortId)) {
        this.cohorts.set(cohortId, new Set());
      }
      this.cohorts.get(cohortId).add(device.device_id);

      await db.upsertDeviceSyncStatus(device.device_id, device.organization_id, cohortId);

      const result = await conn.connect();
      if (result.success) {
        logger.info('New device connected', {
          serialNumber: device.serial_number,
          deviceName: device.device_name,
          durationMs: result.durationMs,
        });
      }
      added++;
    }

    const currentIds = new Set(this.connections.keys());
    const activeIds = new Set(myDevices.map(d => d.device_id));
    for (const id of currentIds) {
      if (!activeIds.has(id)) {
        const conn = this.connections.get(id);
        if (conn) {
          logger.info('Device removed from cohort, disconnecting', {
            deviceId: id,
            deviceName: conn.deviceName,
          });
          conn.disconnect(true);
          this.connections.delete(id);
          this.cohorts.get(cohortId)?.delete(id);
        }
      }
    }

    if (added > 0) {
      logger.info(`Added ${added} new device(s) to cohort ${cohortId}`);
    }
  }

  /**
   * Hash a serial number to a cohort ID
   */
  hashToCohort(serialNumber, totalCohorts) {
    totalCohorts = totalCohorts || config.polling.cohortCount;
    let hash = 0;
    for (let i = 0; i < serialNumber.length; i++) {
      hash = ((hash << 5) - hash) + serialNumber.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % totalCohorts;
  }

  /**
   * Connect to all devices with detailed timing logs
   */
  async connectAll() {
    const totalStartTime = Date.now();
    const deviceCount = this.connections.size;
    
    logger.info('=== STARTUP: Connecting to all devices ===', { 
      deviceCount,
      timestamp: new Date().toISOString()
    });
    
    const results = { 
      success: 0, 
      failed: 0, 
      skipped: 0,
      timedOut: 0,
      totalDurationMs: 0,
      deviceTimings: []
    };
    
    let deviceIndex = 0;
    for (const conn of this.connections.values()) {
      deviceIndex++;
      const deviceStartTime = Date.now();
      
      logger.info(`Connecting device ${deviceIndex}/${deviceCount}`, {
        serialNumber: conn.serialNumber,
        deviceName: conn.deviceName,
        cohort: conn.cohortId
      });
      
      const result = await conn.connect();
      const deviceDuration = result.durationMs || 0;
      
      // Track timing for summary
      results.deviceTimings.push({
        serialNumber: conn.serialNumber,
        deviceName: conn.deviceName,
        success: result.success,
        durationMs: deviceDuration,
        skipped: result.skipped || false,
        timedOut: result.timedOut || false
      });
      
      if (result.success) {
        results.success++;
        logger.info(`Device ${deviceIndex}/${deviceCount} connected`, {
          serialNumber: conn.serialNumber,
          durationMs: deviceDuration
        });
      } else if (result.skipped) {
        results.skipped++;
        logger.info(`Device ${deviceIndex}/${deviceCount} skipped (circuit breaker)`, {
          serialNumber: conn.serialNumber
        });
      } else if (result.timedOut) {
        results.timedOut++;
        results.failed++;
        logger.warn(`Device ${deviceIndex}/${deviceCount} timed out`, {
          serialNumber: conn.serialNumber,
          durationMs: deviceDuration
        });
      } else {
        results.failed++;
        logger.warn(`Device ${deviceIndex}/${deviceCount} failed to connect`, {
          serialNumber: conn.serialNumber,
          durationMs: deviceDuration,
          reason: result.reason || result.error
        });
      }
      
    }

    results.totalDurationMs = Date.now() - totalStartTime;
    
    // Log summary
    logger.info('=== STARTUP COMPLETE: Connection Summary ===', {
      success: results.success,
      failed: results.failed,
      skipped: results.skipped,
      timedOut: results.timedOut,
      totalDurationMs: results.totalDurationMs,
      averageDurationMs: results.deviceTimings.length > 0 
        ? Math.round(results.deviceTimings.reduce((sum, d) => sum + d.durationMs, 0) / results.deviceTimings.length)
        : 0
    });
    
    // Log slow devices (took > 5 seconds)
    const slowDevices = results.deviceTimings.filter(d => d.durationMs > 5000);
    if (slowDevices.length > 0) {
      logger.warn('Slow connections detected', {
        count: slowDevices.length,
        devices: slowDevices.map(d => ({
          serialNumber: d.serialNumber,
          deviceName: d.deviceName,
          durationMs: d.durationMs
        }))
      });
    }
    
    return results;
  }

  /**
   * Get devices in a specific cohort
   */
  getCohortDevices(cohortId) {
    const deviceIds = this.cohorts.get(cohortId) || new Set();
    return Array.from(deviceIds).map(id => this.connections.get(id)).filter(Boolean);
  }

  getAllConnections() {
    return Array.from(this.connections.values());
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
   * Lightweight check for device changes
   * Called at the start of each polling cycle to quickly detect:
   * - Newly activated devices (add to pool)
   * - Newly deactivated/offline devices (remove from pool)
   * - Devices reset to online from admin dashboard (reconnect without restart)
   */
  async checkForNewDevices() {
    const devices = await db.getActiveDevicesWithCredentials();
    const currentIds = new Set(this.connections.keys());
    const activeIds = new Set(devices.map(d => d.device_id));
    
    let added = 0;
    let removed = 0;
    let reconnected = 0;
    
    // Remove devices that are no longer in the active query
    // This handles: credentials deactivated, or device marked offline/unstable from admin
    for (const id of currentIds) {
      if (!activeIds.has(id)) {
        const conn = this.connections.get(id);
        if (conn) {
          logger.info('Removing device from pool (no longer active)', { 
            deviceId: id,
            serialNumber: conn.serialNumber,
            deviceName: conn.deviceName
          });
          conn.disconnect();
          this.connections.delete(id);
          for (const cohort of this.cohorts.values()) {
            cohort.delete(id);
          }
          removed++;
        }
      }
    }
    
    for (const device of devices) {
      if (!currentIds.has(device.device_id)) {
        // Device not in pool at all — add and connect
        logger.info('Found newly activated device', { 
          serialNumber: device.serial_number,
          deviceName: device.device_name
        });
        
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
        
        const startTime = Date.now();
        const result = await conn.connect();
        const durationMs = Date.now() - startTime;
        
        logger.info('New device connection result', { 
          serialNumber: device.serial_number,
          deviceName: device.device_name,
          success: result.success,
          durationMs,
          cohort: cohortId
        });
        
        if (result.success) {
          added++;
        }
      } else {
        // Device already in pool — check if it needs reconnection
        // This handles admin resetting a device from offline back to online
        const conn = this.connections.get(device.device_id);
        if (conn && conn.status === 'disconnected' && !conn.reconnectTimer) {
          logger.info('Reconnecting device reset to online from admin dashboard', {
            deviceId: device.device_id,
            serialNumber: conn.serialNumber,
            deviceName: conn.deviceName
          });
          
          conn.rapidDisconnectCount = 0;
          conn.isCircuitOpen = false;
          conn.circuitResetAt = null;
          conn.consecutiveFailures = 0;
          
          const result = await conn.connect();
          
          logger.info('Reconnection result', {
            serialNumber: conn.serialNumber,
            deviceName: conn.deviceName,
            success: result.success,
            durationMs: result.durationMs
          });
          
          if (result.success) {
            reconnected++;
          }
        }
      }
    }
    
    return { added, removed, reconnected };
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
    const newDevices = [];
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
        
        // Attempt to connect with timing
        logger.info('Connecting new device', { 
          serialNumber: device.serial_number,
          deviceName: device.device_name,
          cohort: cohortId
        });
        
        const result = await conn.connect();
        const durationMs = result.durationMs || 0;
        
        newDevices.push({
          serialNumber: device.serial_number,
          deviceName: device.device_name,
          success: result.success,
          durationMs
        });
        
        logger.info('New device connection result', { 
          serialNumber: device.serial_number,
          deviceName: device.device_name,
          success: result.success,
          durationMs,
          cohort: cohortId
        });
      }
    }

    logger.info('Device list refreshed', { 
      total: this.connections.size,
      added: newDevices.length,
      removed: currentIds.size - newIds.size,
      newDevices: newDevices.map(d => ({
        serialNumber: d.serialNumber,
        success: d.success,
        durationMs: d.durationMs
      }))
    });
  }

  /**
   * Attempt to recover unstable devices that have been waiting long enough
   * Called periodically to give unstable devices a chance to reconnect
   */
  async recoverUnstableDevices() {
    logger.debug('Checking for unstable devices ready for recovery');
    
    try {
      const allUnstable = await db.getUnstableDevicesReadyForRecovery(UNSTABLE_BACKOFF_MS);

      const workerCohort = process.env.WORKER_COHORT_ID != null ? parseInt(process.env.WORKER_COHORT_ID, 10) : null;
      const totalCohorts = config.polling.cohortCount;
      const unstableDevices = workerCohort != null
        ? allUnstable.filter(d => this.hashToCohort(d.serial_number, totalCohorts) === workerCohort)
        : allUnstable;
      
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
        const result = await conn.connect();
        
        if (result.success) {
          // Connection successful - stability will be reset by markDeviceConnected
          recovered++;
          logger.info('Unstable device recovered successfully', { 
            deviceId: device.device_id,
            serial: device.serial_number,
            durationMs: result.durationMs
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
   * Periodically retry no_power devices whose 4-hour quarantine has expired.
   * Tries them one at a time with a 5-second gap between attempts to avoid
   * overwhelming the native library. If the device connects and gets a good
   * first poll, it stays in the pool. If it fails, the quarantine timer resets.
   */
  async recoverNoPowerDevices() {
    try {
      const allNoPower = await db.getNoPowerDevicesReadyForRecovery(NO_POWER_QUARANTINE_MS);

      const workerCohort = process.env.WORKER_COHORT_ID != null ? parseInt(process.env.WORKER_COHORT_ID, 10) : null;
      const totalCohorts = config.polling.cohortCount;
      const devices = workerCohort != null
        ? allNoPower.filter(d => this.hashToCohort(d.serial_number, totalCohorts) === workerCohort)
        : allNoPower;
      
      if (devices.length === 0) {
        return { attempted: 0, recovered: 0 };
      }
      
      const green = '\x1b[32m';
      const yellow = '\x1b[33m';
      const dim = '\x1b[2m';
      const bold = '\x1b[1m';
      const rst = '\x1b[0m';
      const ts = new Date().toISOString().slice(11, 19);
      
      console.log('');
      console.log(`${dim}${ts}${rst} ${green}AUTO ${rst} ${bold}Retrying ${devices.length} no_power device(s) (quarantine expired after 5m):${rst}`);
      for (const d of devices) {
        const tag = '[retry]'.padEnd(12);
        const name = (d.device_name || d.serial_number).padEnd(41);
        const mins = d.marked_unstable_at 
          ? Math.round((Date.now() - new Date(d.marked_unstable_at).getTime()) / 60000)
          : '?';
        console.log(`                  ${green}${tag}${rst}${dim}${name}${rst}${dim}(quarantined ${mins}m ago)${rst}`);
      }
      
      let recovered = 0;
      
      for (const device of devices) {
        if (this.connections.has(device.device_id)) {
          logger.warn('no_power device already in pool, skipping', { deviceId: device.device_id });
          continue;
        }
        
        const cohortId = this.hashToCohort(device.serial_number);
        
        const conn = new DeviceConnection({
          ...device,
          cohort_id: cohortId,
          consecutive_disconnects: 0,
        });
        
        this.connections.set(device.device_id, conn);
        
        if (!this.cohorts.has(cohortId)) {
          this.cohorts.set(cohortId, new Set());
        }
        this.cohorts.get(cohortId).add(device.device_id);
        
        try {
          // Pre-retry diagnostic: check router reachability and GPS status
          const [pingResult, gpsResult] = await Promise.allSettled([
            device.applink_url ? pingApplinkUrl(device.applink_url, 3000) : Promise.resolve(null),
            db.getTruckLastGpsUpdate(device.truck_id)
          ]);
          const routerReachable = pingResult.status === 'fulfilled' ? pingResult.value : null;
          const gpsData = gpsResult.status === 'fulfilled' ? gpsResult.value : null;
          const gpsAge = gpsData?.last_location_update 
            ? Math.round((Date.now() - new Date(gpsData.last_location_update).getTime()) / 60000)
            : null;
          
          const result = await conn.connect();
          const rts = new Date().toISOString().slice(11, 19);
          
          if (result.success) {
            recovered++;
            const tag = '[recovered]'.padEnd(12);
            const name = (device.device_name || device.serial_number).padEnd(41);
            console.log(`${dim}${rts}${rst} ${green}AUTO ${rst} ${green}${tag}${rst}${bold}${name}${rst}${dim}connected in ${result.durationMs}ms${rst}`);
            
            await db.resetDeviceStability(device.device_id);
          } else {
            this.connections.delete(device.device_id);
            this.cohorts.get(cohortId)?.delete(device.device_id);
            
            await db.markDeviceUnstable(device.device_id, 'no_power');
            
            const tag = '[still off]'.padEnd(12);
            const name = (device.device_name || device.serial_number).padEnd(41);
            const diag = routerReachable 
              ? `${yellow}router UP${rst}${dim} (connectivity issue)${rst}` 
              : gpsAge != null && gpsAge < 5 
                ? `${dim}router down, GPS ${gpsAge}m ago (transient?)${rst}` 
                : `${dim}router down, no recent GPS${rst}`;
            console.log(`${dim}${rts}${rst} ${yellow}AUTO ${rst} ${yellow}${tag}${rst}${dim}${name}will retry in 5m | ${rst}${diag}`);
          }
        } catch (err) {
          this.connections.delete(device.device_id);
          this.cohorts.get(cohortId)?.delete(device.device_id);
          logger.error('no_power recovery failed for device', { deviceId: device.device_id, error: err.message });
        }
        
        if (devices.indexOf(device) < devices.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      const sts = new Date().toISOString().slice(11, 19);
      const failed = devices.length - recovered;
      const summary = recovered > 0 
        ? `${green}${recovered} recovered${rst}` 
        : `${yellow}0 recovered${rst}`;
      const failedText = failed > 0 ? `, ${dim}${failed} still offline${rst}` : '';
      console.log(`${dim}${sts}${rst} ${green}AUTO ${rst} ${bold}No-power retry complete:${rst} ${summary}${failedText}`);
      console.log('');
      
      return { attempted: devices.length, recovered };
    } catch (err) {
      logger.error('Error recovering no_power devices', { error: err.message });
      return { attempted: 0, recovered: 0, error: err.message };
    }
  }

  /**
   * Attempt to recover offline devices that have been waiting long enough
   * 
   * NOTE: 'offline' status is now admin-initiated only (set via dashboard).
   * Admin must use "Set Online" button to bring devices back.
   * This function is kept but disabled — offline = intentional admin action.
   */
  async recoverOfflineDevices() {
    // Offline status is admin-set only — do not auto-recover
    // Admin must use "Set Online" button from the dashboard
    return { attempted: 0, recovered: 0, unreachable: 0 };
  }

  hasAnySuccessfulPoll() {
    for (const conn of this.connections.values()) {
      if (conn.lastSuccessfulPollAt && conn.lastConnectedAt &&
          conn.lastSuccessfulPollAt.getTime() >= conn.lastConnectedAt) {
        return true;
      }
    }
    return false;
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
