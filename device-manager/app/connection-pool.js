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
// Defensive flag — historically set to true to block all native calls during a
// "graceful exit" window after a circuit breaker fired. The exit-on-circuit-break
// behaviour was removed in 2026-05 (30+ days of prod logs showed ZERO SIGABRT /
// SIGSEGV / core dumps; every "crash" was our own process.exit(1)). The flag is
// kept as cheap defense-in-depth: if a real native abort ever materializes,
// existing `if (nativeLibraryShutdown)` guards still bail out before touching
// native state. Nothing currently sets it.
let nativeLibraryShutdown = false;

// Module-level pool reference (used by the singleton at the bottom of this file).
let poolInstance = null;

// Circuit breaker configuration
const RAPID_DISCONNECT_THRESHOLD_MS = 5000; // Disconnect within 5s of connect = rapid
const MAX_RAPID_DISCONNECTS = 3; // After 3 rapid disconnects, mark as unstable/flapping
const UNSTABLE_BACKOFF_MS = 300000; // 5 minutes backoff for unstable devices
const FLAPPING_QUARANTINE_MS = 5 * 60 * 1000; // 5 minutes quarantine for flapping devices
const FLAPPING_RETRY_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const OFFLINE_BACKOFF_MS = 600000; // 10 minutes backoff for offline devices
const FLAPPING_INSTANT_THRESHOLD_MS = 200; // Connection shorter than this = "instant" disconnect
const INSTANT_DISCONNECTS_TO_OPEN_CIRCUIT = 3; // Open breaker after this many instant disconnects in a row.
                                               // Raised from 2 to 3 on 2026-05-25: PowerMon-E fw 1.4 reliably
                                               // produces a "close → 1-2 instant rejects → recover" dance after
                                               // a long stable session. 23h of prod logs on GFR-69 showed every
                                               // cascade had exactly 2 instants then recovered, so a threshold of
                                               // 2 was eating self-healing devices. A genuinely dead device still
                                               // trips on the 3rd instant within milliseconds.
const POST_ERROR_RECONNECT_DELAY_MS = 5000; // Longer delay after a poll failure before reconnecting
const POST_FIRMWARE_CLOSE_DELAY_MS = 2000; // Delay before reconnecting after the firmware closes a real session
                                           // (reason=2 with connDurationMs >= 200ms). Without this, we knock
                                           // on the door within ~1s and the firmware's session state hasn't
                                           // cleared yet — it accepts the TCP socket then closes it in 2-3ms.
                                           // 2s is enough to let the session state on the device clear.
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
// FLAPPING DIAGNOSTIC verdict matrix (Task #25).
// Inputs are minutes-since values (null = unknown), produced from the new
// db.getDeviceLivenessSnapshot helper. The truthiness of each input maps to
// the three-bucket verdict below.
//
//   | Router signal fresh (<10 min)? | PowerMon reported recently (<6 h)? | Verdict                           |
//   | Yes                            | Yes                                 | PowerMon-side flap                |
//   | Yes                            | No                                  | PowerMon offline — verify         |
//   | No                             | (any)                               | Router/cellular outage            |
//
// Router signal freshness is now trustworthy (Task #24 gated those writes on
// InHand's online flag), so "router fresh" honestly means "the router was
// online within the last 10 min." When router is fresh but PowerMon has been
// silent for >6 h, the device is either powered off or firmware-wedged — the
// operator needs to physically verify (the DCL-Epler / DCL-Moeck-Shop case
// the previous verdict misclassified as "PowerMon-side firmware issue").
const FLAPPING_ROUTER_FRESH_THRESHOLD_MINUTES = 10;
const FLAPPING_POWERMON_RECENT_THRESHOLD_MINUTES = 6 * 60;
function classifyFlappingVerdict(routerSignalMinutesAgo, lastReportedMinutesAgo) {
  const routerFresh = routerSignalMinutesAgo != null
    && routerSignalMinutesAgo < FLAPPING_ROUTER_FRESH_THRESHOLD_MINUTES;
  const powerMonRecent = lastReportedMinutesAgo != null
    && lastReportedMinutesAgo < FLAPPING_POWERMON_RECENT_THRESHOLD_MINUTES;
  if (!routerFresh) return 'Router/cellular outage — truck unreachable';
  if (powerMonRecent) return 'PowerMon-side flap — actively connecting + failing (likely firmware/RF/USB)';
  return 'PowerMon offline — verify physically (powered off OR firmware-wedged)';
}

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
    this.firmwareClosedAfterSession = false; // Set when firmware closes a non-instant session (reason=2, >=200ms).
                                              // scheduleReconnect consumes this once to apply POST_FIRMWARE_CLOSE_DELAY_MS,
                                              // giving the device time to clear its session state before we reconnect.
    
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

            // If the firmware closed a real (non-instant) session with reason=2, flag the
            // next reconnect for a longer cooldown so the device's session state can clear.
            // We skip this for intentional disconnects (our own poll-completion teardown)
            // and for instant rejects (those are handled by the rapid/breaker logic below).
            if (
              !wasIntentional &&
              reason === 2 &&
              connDurationMs !== null &&
              connDurationMs >= FLAPPING_INSTANT_THRESHOLD_MS
            ) {
              this.firmwareClosedAfterSession = true;
            }
            
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
              
              // Instant disconnect (< 200ms) = device's session dies the moment it's
              // established. We treat ≥2 instant disconnects as "flapping" (was previously
              // split into weak_signal/no_power); ≥3 rapid-but-not-instant as "unstable".
              // The state is causally honest about what we OBSERVED — we don't claim it's
              // a power issue, signal issue, or anything else without evidence.
              const isInstantDisconnect = connDurationMs < FLAPPING_INSTANT_THRESHOLD_MS;
              const instantDisconnectCount = (this.rapidDisconnectDurations || []).filter(d => d < FLAPPING_INSTANT_THRESHOLD_MS).length;
              
              // Log every pre-trip instant disconnect as an early warning, no DB write.
              // The state only changes when the circuit breaker opens.
              if (isInstantDisconnect && instantDisconnectCount < INSTANT_DISCONNECTS_TO_OPEN_CIRCUIT) {
                this.log.warn(`Instant disconnect detected (${instantDisconnectCount}/${INSTANT_DISCONNECTS_TO_OPEN_CIRCUIT}) — early warning, device stays in pool`, {
                  connectionDurationMs: connDurationMs,
                  deviceName: this.deviceName,
                });
              }
              
              const shouldOpenCircuit = (isInstantDisconnect && instantDisconnectCount >= INSTANT_DISCONNECTS_TO_OPEN_CIRCUIT) || 
                this.rapidDisconnectCount >= MAX_RAPID_DISCONNECTS;
              
              if (shouldOpenCircuit) {
                this.isCircuitOpen = true;
                this.circuitResetAt = Date.now() + UNSTABLE_BACKOFF_MS;
                
                // ≥N instant disconnects → 'flapping' (causally honest: connection won't stay up).
                // ≥MAX_RAPID rapid-but-not-instant → 'unstable' (slightly less severe).
                const status = (isInstantDisconnect && instantDisconnectCount >= INSTANT_DISCONNECTS_TO_OPEN_CIRCUIT) ? 'flapping' : 'unstable';
                
                if (status === 'flapping') {
                  this.log.error(`Circuit breaker OPEN - flapping (≥${INSTANT_DISCONNECTS_TO_OPEN_CIRCUIT} instant disconnects)`, {
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
                
                // Null out THIS device's native ref so any pending callback finds
                // `this.device === null` and bails out before touching native state.
                // We do NOT null other pool members anymore: 30+ days of prod logs
                // showed zero SIGABRT/SIGSEGV/core-dumps caused by "global C++ corruption",
                // so the cohort-wide blast radius isn't justified. The bad device is
                // isolated locally; the supervisor will spawn a solo probe worker
                // (one process, one device) to attempt recovery after FLAPPING_QUARANTINE_MS.
                this.device = null;
                this.status = 'disconnected';
                
                // Clear any pending reconnect timer for this device
                if (this.reconnectTimer) {
                  clearTimeout(this.reconnectTimer);
                  this.reconnectTimer = null;
                }
                
                // Persist status to database
                db.markDeviceUnstable(this.deviceId, status)
                  .catch(err => this.log.error('Failed to mark device status in database', { error: err.message }));
                
                // Diagnostic: check router reachability + GPS freshness so the
                // operator has evidence to triage WHY this device is flapping.
                (async () => {
                  try {
                    const routerReachable = this.applinkUrl ? await pingApplinkUrl(this.applinkUrl, 3000) : null;
                    const gpsData = await db.getTruckLastGpsUpdate(this.truckId);
                    const liveness = await db.getDeviceLivenessSnapshot(this.deviceId, this.truckId);
                    const gpsAge = gpsData?.last_location_update
                      ? Math.round((Date.now() - new Date(gpsData.last_location_update).getTime()) / 60000)
                      : null;
                    // Math.floor (not round) so the threshold comparisons in
                    // classifyFlappingVerdict respect strict-less-than boundaries:
                    // 9m59s → 9 (fresh), 10m00s → 10 (stale). Rounding flipped
                    // 9m31s to 10 and crossed the boundary the wrong way.
                    const routerSignalMinutesAgo = liveness?.routerSignalUpdatedAt
                      ? Math.floor((Date.now() - new Date(liveness.routerSignalUpdatedAt).getTime()) / 60000)
                      : null;
                    const lastReportedMinutesAgo = liveness?.powerMonLastReportedAt
                      ? Math.floor((Date.now() - new Date(liveness.powerMonLastReportedAt).getTime()) / 60000)
                      : null;
                    const verdict = classifyFlappingVerdict(routerSignalMinutesAgo, lastReportedMinutesAgo);
                    logger.warn('FLAPPING DIAGNOSTIC', {
                      deviceId: this.deviceId,
                      deviceName: this.deviceName,
                      truckId: this.truckId,
                      status,
                      routerReachable,
                      gpsLastUpdate: gpsData?.last_location_update || null,
                      gpsAgeMinutes: gpsAge,
                      gpsLocation: gpsData?.location_description || null,
                      routerSignalMinutesAgo,
                      lastReportedMinutesAgo,
                      verdict,
                    });
                  } catch (err) {
                    logger.warn('FLAPPING DIAGNOSTIC failed', { error: err.message });
                  }
                })();
                
                // No process.exit — the worker stays alive. The supervisor's
                // _probeFlappingDevices loop will pick this device up after the
                // FLAPPING_QUARANTINE_MS window and spawn a solo probe.
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
          this.firmwareClosedAfterSession = false;
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

    // After a real (non-instant) firmware-initiated close, give the device's
    // session state time to clear before we knock again. Without this, the next
    // TCP socket gets accepted then closed in 2-3ms, repeatedly, until the
    // circuit breaker trips. One-shot: consume the flag here so subsequent
    // reconnects in this cascade fall back to normal backoff.
    if (this.firmwareClosedAfterSession && this.reconnectAttempts === 0) {
      delay = Math.max(delay, POST_FIRMWARE_CLOSE_DELAY_MS);
      this.log.info('Using firmware-close cooldown delay', { delayMs: delay });
      this.firmwareClosedAfterSession = false;
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

    if (device.device_connection_status !== 'flapping') {
      logger.warn(`Solo device status is ${device.device_connection_status}, not flapping — aborting probe`, { serial });
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
   * Re-arm devices in this worker's pool that are silently not working.
   *
   * Liveness-based, not budget-based — the budget-based version we shipped
   * first only caught one of three real failure modes. Logs from the
   * 2026-05-20 GFR-70 / GFR-69 outage showed two cases the budget filter
   * misses entirely:
   *
   *   1. Poll-timeout flip-flop: the per-poll watchdog calls
   *      `disconnect(false) + scheduleReconnect()`. Next tick reconnects
   *      successfully and the `onConnect` handler resets `reconnectAttempts`
   *      to 0 (line 269). Poll times out again. Loop repeats forever and
   *      `reconnectAttempts` never reaches the budget — but no poll ever
   *      lands either, so the device looks "Stale" on the dashboard for
   *      hours. (GFR-69 stopped polling at 22:15 and sat dead 19+ hours.)
   *   2. Cohort↔supervisor handoff stranding: a device gets flagged
   *      `flapping`, the supervisor moves it to a solo-probe worker, then
   *      something goes wrong and it's no longer being actively polled by
   *      either side — but the stale `DeviceConnection` object stays in
   *      our pool. (GFR-70's path.)
   *   3. Classic exhausted budget: clean prolonged outage (>30 s router
   *      power-off) burns through all 5 reconnect attempts and stops.
   *
   * The fix: ignore `reconnectAttempts` and look at `lastSuccessfulPollAt`
   * instead. If a device hasn't produced a successful poll in
   * `STALE_POLL_THRESHOLD_MS` (5 min), force a hard reset:
   * `disconnect(true)` to cleanly null out the native device, clear every
   * counter, then call `connect()`. Healthy devices poll every ~10 s so
   * 5 min staleness is unambiguous.
   *
   * We still skip `isCircuitOpen` devices — those are the supervisor's
   * solo-probe responsibility and stealing them back would race the probe
   * worker.
   *
   * In-process; the DeviceConnection is already in `this.connections`,
   * we just kick it. Runs every 5 min from worker.js.
   */
  async recoverDisconnectedDevices() {
    if (nativeLibraryShutdown) return { attempted: 0, recovered: 0 };

    const STALE_POLL_THRESHOLD_MS = 5 * 60 * 1000;
    const maxAttempts = config.connection.maxReconnectAttempts;
    const now = Date.now();
    const stuck = [];

    for (const [deviceId, conn] of this.connections.entries()) {
      if (conn.intentionalDisconnect) continue;
      // Supervisor solo-probe owns flapping/unstable devices — don't steal.
      if (conn.isCircuitOpen) continue;

      // Case A: classic budget-exhausted (clean prolonged outage).
      const exhaustedBudget =
        conn.status !== 'connected' &&
        conn.status !== 'connecting' &&
        conn.reconnectAttempts >= maxAttempts;

      // Case B: silent stall — no successful poll in N minutes regardless
      // of what `status` claims.
      //
      // Reference time selection is critical: an earlier iteration used
      // `max(lastSuccessfulPollAt, lastConnectedAt)` to avoid false-positives
      // on a brand-new connection. That was wrong and caused an infinite
      // re-arm loop in prod overnight: when the silent-stall failure mode
      // re-occurs, `conn.connect()` succeeds at the TCP/native layer
      // (bumping lastConnectedAt to now) but the device never actually
      // produces a poll. The max() reset the staleness clock to 0 every
      // re-arm, so we'd "recover" the device every 5 min forever without
      // ever getting a real poll back, and the dashboard sat on "No data"
      // all night.
      //
      // Correct rule: if the device has ever polled successfully, ONLY
      // `lastSuccessfulPollAt` matters — a fresh connect that doesn't
      // produce polls is exactly the failure we're trying to detect, not a
      // reason to extend grace. For devices that have never polled
      // (genuinely new connections), grace 60 s after `lastConnectedAt` to
      // let the first poll land, then treat as stalled.
      const lastGoodPoll = conn.lastSuccessfulPollAt
        ? conn.lastSuccessfulPollAt.getTime()
        : 0;
      const lastConnect = conn.lastConnectedAt || 0;
      const NEW_CONNECTION_GRACE_MS = 60 * 1000;
      let silentlyStalled = false;
      if (lastGoodPoll > 0) {
        silentlyStalled = now - lastGoodPoll > STALE_POLL_THRESHOLD_MS;
      } else if (lastConnect > 0) {
        silentlyStalled = now - lastConnect > NEW_CONNECTION_GRACE_MS;
      }
      const referenceTime = lastGoodPoll > 0 ? lastGoodPoll : lastConnect;

      if (!exhaustedBudget && !silentlyStalled) continue;
      stuck.push({
        deviceId,
        conn,
        reason: exhaustedBudget ? 'budget_exhausted' : 'silent_stall',
        stalledForMs: referenceTime > 0 ? now - referenceTime : null,
      });
    }

    if (stuck.length === 0) return { attempted: 0, recovered: 0 };

    logger.info('Re-arming stalled devices', {
      count: stuck.length,
      // JSON-stringify because our logger flattens objects with toString(),
      // which turns an array-of-objects into useless "[object Object]".
      devices: JSON.stringify(stuck.map(s => ({
        name: s.conn.deviceName || s.conn.serialNumber,
        reason: s.reason,
        stalledForMs: s.stalledForMs,
      }))),
    });

    let recovered = 0;
    for (const { conn, reason } of stuck) {
      try {
        // Hard reset. disconnect(true) = intentional so the *old* onDisconnect
        // closure (which fires async from the native lib) sees
        // `wasIntentional=true` and takes the safe path at line 446 —
        // no rapidDisconnectCount++, no scheduleReconnect, no status
        // clobber-back-to-disconnected after our new connect() lands.
        //
        // CRITICAL: do NOT clear `intentionalDisconnect` ourselves here.
        // onDisconnect at line 303 clears it on its own. If we cleared it
        // synchronously, the late callback would race and take the error
        // path, double-firing scheduleReconnect alongside our own connect().
        //
        // The 250 ms settle gives the native callback time to drain before
        // we kick off a fresh connect() on the new generation — empirically
        // these callbacks fire within a few ms after disconnect().
        conn.disconnect(true);
        await new Promise(r => setTimeout(r, 250));
        if (conn.reconnectTimer) {
          clearTimeout(conn.reconnectTimer);
          conn.reconnectTimer = null;
        }
        conn.reconnectAttempts = 0;
        conn.consecutiveFailures = 0;
        conn.hadRecentPollFailure = false;

        const result = await conn.connect();
        if (result.success) {
          recovered++;
          logger.info('Stalled device recovered via re-arm', {
            deviceId: conn.deviceId,
            serial: conn.serialNumber,
            name: conn.deviceName,
            reason,
            durationMs: result.durationMs,
          });
        } else if (!result.skipped) {
          logger.warn('Re-arm connect failed, scheduleReconnect will retry', {
            deviceId: conn.deviceId,
            serial: conn.serialNumber,
            name: conn.deviceName,
          });
        }
      } catch (err) {
        logger.error('Error re-arming stalled device', {
          deviceId: conn.deviceId,
          serial: conn.serialNumber,
          name: conn.deviceName,
          error: err.message,
        });
      }
    }

    logger.info('Stalled-device re-arm complete', {
      attempted: stuck.length,
      recovered,
    });
    return { attempted: stuck.length, recovered };
  }

  /**
   * Periodically retry flapping devices whose quarantine has expired.
   * Tries them one at a time with a 5-second gap between attempts to avoid
   * overwhelming the native library. If the device connects and gets a good
   * first poll, it stays in the pool. If it fails, the quarantine timer resets.
   */
  async recoverFlappingDevices() {
    try {
      const allFlapping = await db.getFlappingDevicesReadyForRecovery(FLAPPING_QUARANTINE_MS);

      const workerCohort = process.env.WORKER_COHORT_ID != null ? parseInt(process.env.WORKER_COHORT_ID, 10) : null;
      const totalCohorts = config.polling.cohortCount;
      const devices = workerCohort != null
        ? allFlapping.filter(d => this.hashToCohort(d.serial_number, totalCohorts) === workerCohort)
        : allFlapping;
      
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
      console.log(`${dim}${ts}${rst} ${green}AUTO ${rst} ${bold}Retrying ${devices.length} flapping device(s) (quarantine expired after 5m):${rst}`);
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
          logger.warn('flapping device already in pool, skipping', { deviceId: device.device_id });
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
          // Pre-retry diagnostic: fetch the same liveness signals the
          // FLAPPING DIAGNOSTIC log uses so the CLI verdict matches what
          // gets written to the journal. Router ping is kept for log
          // parity but no longer drives the verdict.
          const [pingResult, livenessResult] = await Promise.allSettled([
            device.applink_url ? pingApplinkUrl(device.applink_url, 3000) : Promise.resolve(null),
            db.getDeviceLivenessSnapshot(device.device_id, device.truck_id),
          ]);
          const routerReachable = pingResult.status === 'fulfilled' ? pingResult.value : null;
          const liveness = livenessResult.status === 'fulfilled' ? livenessResult.value : null;
          // Math.floor to preserve strict-less-than boundary semantics in
          // classifyFlappingVerdict (see comment at structured-log call site).
          const routerSignalMinutesAgo = liveness?.routerSignalUpdatedAt
            ? Math.floor((Date.now() - new Date(liveness.routerSignalUpdatedAt).getTime()) / 60000)
            : null;
          const lastReportedMinutesAgo = liveness?.powerMonLastReportedAt
            ? Math.floor((Date.now() - new Date(liveness.powerMonLastReportedAt).getTime()) / 60000)
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

            await db.markDeviceUnstable(device.device_id, 'flapping');

            const tag = '[still off]'.padEnd(12);
            const name = (device.device_name || device.serial_number).padEnd(41);
            const verdict = classifyFlappingVerdict(routerSignalMinutesAgo, lastReportedMinutesAgo);
            // Color-code by severity: router outage = dim (waiting on network),
            // PowerMon-offline = yellow (operator action needed), PowerMon-flap = yellow.
            const verdictColored = verdict.startsWith('Router/cellular')
              ? `${dim}${verdict}${rst}`
              : `${yellow}${verdict}${rst}`;
            const pingNote = routerReachable === true
              ? `${dim} (applink ping OK)${rst}`
              : routerReachable === false
                ? `${dim} (applink ping FAIL)${rst}`
                : '';
            console.log(`${dim}${rts}${rst} ${yellow}AUTO ${rst} ${yellow}${tag}${rst}${dim}${name}will retry in 5m | ${rst}${verdictColored}${pingNote}`);
          }
        } catch (err) {
          this.connections.delete(device.device_id);
          this.cohorts.get(cohortId)?.delete(device.device_id);
          logger.error('flapping recovery failed for device', { deviceId: device.device_id, error: err.message });
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
      console.log(`${dim}${sts}${rst} ${green}AUTO ${rst} ${bold}Flapping retry complete:${rst} ${summary}${failedText}`);
      console.log('');
      
      return { attempted: devices.length, recovered };
    } catch (err) {
      logger.error('Error recovering flapping devices', { error: err.message });
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
