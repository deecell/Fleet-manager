/**
 * InHand Networks GPS Location Poller
 * 
 * Polls InHand Networks Device Manager API for GPS location data.
 * Matches InHand devices to our SIM records using the device's mobileNumber
 * field (MSISDN) as the primary identifier, with ICCID/IMSI as fallbacks.
 * 
 * Matching strategy (in priority order):
 * 1. device.mobileNumber -> sims.msisdn (primary — every router has this)
 * 2. info.iccid -> sims.iccid (fallback — only populated when SIM is active)
 * 3. info.imsi -> sims.imsi (fallback — only populated when SIM is active)
 * 
 * When a match is found and the SIM is linked to a truck, update the truck's lat/long.
 * 
 * Runs on a configurable interval (default 2 minutes).
 * 
 * Flow:
 * 1. Fetch all devices from InHand API (GET /api/devices?verbose=100)
 * 2. For each device, extract mobileNumber (MSISDN) and location data
 * 3. Match MSISDN to SIM records in our database
 * 4. If SIM is linked to a truck, update the truck's latitude/longitude
 */

const { config } = require('./config');
const logger = require('./logger');
const db = require('./database');
const { inhandClient } = require('./inhand-client');

class InHandPoller {
  constructor() {
    this.intervalId = null;
    this.isPolling = false;
  }

  start() {
    if (this.intervalId) {
      logger.warn('InHand poller already running');
      return;
    }

    const { username, password } = config.inhand;
    if (!username || !password) {
      logger.warn('InHand API credentials not configured, GPS polling disabled');
      return;
    }

    const pollInterval = config.inhand.pollIntervalMs;
    logger.info('Starting InHand GPS location poller', {
      interval: pollInterval,
      baseUrl: config.inhand.baseUrl,
    });

    this.pollLocations();
    this.intervalId = setInterval(() => this.pollLocations(), pollInterval);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('InHand poller stopped');
    }
  }

  async pollLocations() {
    if (this.isPolling) {
      logger.debug('Previous InHand poll still running, skipping');
      return;
    }

    this.isPolling = true;
    const startTime = Date.now();

    try {
      const pool = db.getPool();
      if (!pool) {
        logger.warn('Database not initialized, skipping InHand poll');
        return;
      }

      const devices = await inhandClient.getDevicesWithLocation();
      if (!devices || devices.length === 0) {
        logger.debug('InHand API: No devices returned');
        return;
      }

      const devicesWithLocation = [];
      for (const device of devices) {
        const location = this._extractLocation(device);
        const identifiers = this._extractIdentifiers(device);

        if (location && (identifiers.iccid || identifiers.imsi || identifiers.msisdn)) {
          devicesWithLocation.push({
            ...identifiers,
            latitude: location.latitude,
            longitude: location.longitude,
            locationTime: location.time,
            locationSource: location.source,
            deviceName: device.name || null,
            deviceSn: device.serialNumber || null,
            online: device.online !== undefined ? device.online : null,
          });
        }
      }

      if (devicesWithLocation.length === 0) {
        logger.info('InHand API: No devices with valid identifiers + location', {
          totalDevices: devices.length,
          devicesWithoutLocation: devices.filter(d => !this._extractLocation(d)).length,
        });
        return;
      }

      const iccids = devicesWithLocation.map(d => d.iccid).filter(Boolean);
      const imsis = devicesWithLocation.map(d => d.imsi).filter(Boolean);
      const msisdns = devicesWithLocation.map(d => d.msisdn).filter(Boolean);

      const simsResult = await pool.query(
        `SELECT s.id, s.msisdn, s.iccid, s.imsi, s.truck_id, s.organization_id, t.truck_number
         FROM sims s
         LEFT JOIN trucks t ON t.id = s.truck_id
         WHERE s.is_active = true
           AND (
             (s.iccid = ANY($1) AND s.iccid IS NOT NULL)
             OR (s.imsi = ANY($2) AND s.imsi IS NOT NULL)
             OR (s.msisdn = ANY($3) AND s.msisdn IS NOT NULL)
           )`,
        [iccids, imsis, msisdns]
      );

      const simsByIccid = new Map();
      const simsByImsi = new Map();
      const simsByMsisdn = new Map();
      for (const sim of simsResult.rows) {
        if (sim.iccid) simsByIccid.set(sim.iccid, sim);
        if (sim.imsi) simsByImsi.set(sim.imsi, sim);
        if (sim.msisdn) simsByMsisdn.set(sim.msisdn, sim);
      }

      let trucksUpdated = 0;
      let simsMatched = 0;
      let unmatched = [];

      for (const device of devicesWithLocation) {
        const sim = (device.iccid && simsByIccid.get(device.iccid))
          || (device.imsi && simsByImsi.get(device.imsi))
          || (device.msisdn && simsByMsisdn.get(device.msisdn));

        if (!sim) {
          unmatched.push({
            name: device.deviceName,
            iccid: device.iccid,
            imsi: device.imsi,
            msisdn: device.msisdn,
          });
          continue;
        }

        simsMatched++;

        if (sim.truck_id) {
          await pool.query(
            `UPDATE trucks SET
              latitude = $1,
              longitude = $2,
              last_location_update = NOW(),
              updated_at = NOW()
            WHERE id = $3`,
            [device.latitude, device.longitude, sim.truck_id]
          );
          trucksUpdated++;
        }
      }

      const duration = Date.now() - startTime;
      logger.info('InHand GPS locations updated', {
        totalDevices: devices.length,
        devicesWithLocation: devicesWithLocation.length,
        simsMatched,
        trucksUpdated,
        unmatchedDevices: unmatched.length > 0 ? unmatched : undefined,
        durationMs: duration,
      });

    } catch (err) {
      logger.error('InHand poll failed', { error: err.message, stack: err.stack });
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Extract all possible identifiers from an InHand device object
   * Primary: device.mobileNumber (MSISDN — always present on every router)
   * Fallback: info.iccid, info.imsi (only populated when SIM is actively connected)
   */
  _extractIdentifiers(device) {
    const info = device.info || {};
    return {
      msisdn: device.mobileNumber || null,
      iccid: info.iccid || null,
      imsi: info.imsi || null,
    };
  }

  /**
   * Extract location data from InHand device object
   * With verbose>=50, location is nested: device.location.{latitude, longitude, time, source}
   */
  _extractLocation(device) {
    const loc = device.location;
    if (!loc) return null;

    const lat = parseFloat(loc.latitude);
    const lng = parseFloat(loc.longitude);

    if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
      return null;
    }

    return {
      latitude: lat,
      longitude: lng,
      time: loc.time || null,
      source: loc.source || null,
    };
  }
}

const inhandPoller = new InHandPoller();

module.exports = { inhandPoller };
