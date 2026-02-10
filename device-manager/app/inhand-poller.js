/**
 * InHand Networks GPS Location Poller
 * 
 * Polls InHand Networks Device Manager API for GPS location data.
 * Matches InHand devices to our SIM records using the Phone number (MSISDN)
 * as the common identifier, then updates the linked truck's lat/long.
 * 
 * Runs on a configurable interval (default 2 minutes).
 * 
 * Flow:
 * 1. Fetch all devices from InHand API (GET /api/devices?verbose=50)
 * 2. For each device, extract Phone number and location data
 * 3. Match Phone number to SIM record's MSISDN in our database
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
        const phoneNumber = this._extractPhoneNumber(device);
        const location = this._extractLocation(device);

        if (phoneNumber && location) {
          devicesWithLocation.push({
            phoneNumber,
            latitude: location.latitude,
            longitude: location.longitude,
            locationTime: location.time,
            locationSource: location.source,
            deviceName: device.device_name || device.name || null,
            deviceSn: device.sn || device.serial_number || null,
            online: device.online !== undefined ? device.online : null,
          });
        }
      }

      if (devicesWithLocation.length === 0) {
        logger.debug('InHand API: No devices with valid phone number + location');
        return;
      }

      const phoneNumbers = devicesWithLocation.map(d => d.phoneNumber);
      const simsResult = await pool.query(
        `SELECT s.id, s.msisdn, s.truck_id, s.organization_id, t.truck_number
         FROM sims s
         LEFT JOIN trucks t ON t.id = s.truck_id
         WHERE s.msisdn = ANY($1) AND s.is_active = true`,
        [phoneNumbers]
      );

      const msisdnToSim = new Map();
      for (const sim of simsResult.rows) {
        msisdnToSim.set(sim.msisdn, sim);
      }

      let trucksUpdated = 0;
      let simsMatched = 0;
      let unmatched = [];

      for (const device of devicesWithLocation) {
        const sim = msisdnToSim.get(device.phoneNumber);
        if (!sim) {
          unmatched.push(device.phoneNumber);
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
        unmatchedPhones: unmatched.length > 0 ? unmatched : undefined,
        durationMs: duration,
      });

    } catch (err) {
      logger.error('InHand poll failed', { error: err.message, stack: err.stack });
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Extract phone number (MSISDN) from InHand device object
   * InHand calls this "phone" or "phone_num" depending on API version
   */
  _extractPhoneNumber(device) {
    const phone = device.phone || device.phone_num || device.phone_number || null;
    if (!phone) return null;
    const cleaned = String(phone).replace(/\D/g, '');
    return cleaned || null;
  }

  /**
   * Extract location data from InHand device object
   * With verbose=50, location is nested: device.location.{latitude, longitude, time, source}
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
