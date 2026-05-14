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

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

const US_STATE_ABBRS = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};

let lastGeoRequestTime = 0;
const geocodeCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function geoCacheKey(lat, lng) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function hasCoordsMoved(oldLat, oldLng, newLat, newLng, thresholdKm = 1) {
  if (oldLat == null || oldLng == null) return true;
  const R = 6371;
  const dLat = (newLat - oldLat) * Math.PI / 180;
  const dLng = (newLng - oldLng) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(oldLat * Math.PI / 180) * Math.cos(newLat * Math.PI / 180) *
    Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) >= thresholdKm;
}

async function reverseGeocode(lat, lng) {
  const key = geoCacheKey(lat, lng);
  const cached = geocodeCache.get(key);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.desc;
  }

  try {
    const now = Date.now();
    const wait = 1100 - (now - lastGeoRequestTime);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastGeoRequestTime = Date.now();

    const response = await fetch(
      `${NOMINATIM_URL}?lat=${lat}&lon=${lng}&format=json&zoom=10&addressdetails=1`,
      { headers: { 'User-Agent': 'DeecellFleetDashboard/1.0 (admin@deecell.com)' } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.address) return null;
    const addr = data.address;
    const city = addr.city || addr.town || addr.village || addr.hamlet || addr.suburb || addr.neighbourhood || addr.county;
    const state = addr.state;
    let desc = null;
    if (city && state) {
      const stateAbbr = US_STATE_ABBRS[state] || state;
      desc = `${city}, ${stateAbbr}`;
    } else {
      desc = city || state || null;
    }
    if (desc) {
      if (geocodeCache.size >= 500) geocodeCache.delete(geocodeCache.keys().next().value);
      geocodeCache.set(key, { desc, ts: Date.now() });
    }
    return desc;
  } catch (error) {
    logger.warn('Reverse geocoding failed', { lat, lng, error: error.message });
    return null;
  }
}

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

      // We collect every device that has at least one identifier — even ones
      // without GPS — because router signal strength is meaningful on its own
      // (an offline-with-coords-but-weak-signal router still tells us "the
      // router is reachable"). Location is treated as optional per device.
      const devicesWithIds = [];
      for (const device of devices) {
        const identifiers = this._extractIdentifiers(device);
        const deviceName = device.name || null;
        // Keep a device if it has any identifier OR a name we can match on.
        // The DB-side fallback uses LOWER(s.device_name) = ANY($4) so a
        // device with no SIM identifiers but a known name can still be
        // linked + receive Router Sig updates.
        if (!identifiers.iccid && !identifiers.imsi && !identifiers.msisdn && !deviceName) {
          continue;
        }
        const location = this._extractLocation(device);
        const rssi = this._extractRssi(device);
        devicesWithIds.push({
          ...identifiers,
          inhandId: device._id || null,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
          locationTime: location?.time ?? null,
          locationSource: location?.source ?? null,
          rssi, // dBm, or null if InHand didn't report a signal field
          deviceName: device.name || null,
          deviceSn: device.serialNumber || null,
          online: device.online !== undefined ? device.online : null,
        });
      }

      // Bulk /api/devices?verbose=100 does not carry signal for IR302 routers
      // (and is intermittently empty for other models), so for every online
      // device with a Mongo `_id` we hit the per-device signal endpoint —
      // GET /api/devices/{_id}/signal?begin=&end= — which returns ASU
      // (0–31, 99 = no signal). Convert to dBm via -113 + 2*asu and override
      // whatever the bulk extraction produced. ≤10 in-flight at a time so we
      // don't hammer InHand's API. Failures are logged at debug and leave
      // device.rssi as-is (typically null).
      await this._enrichSignalFromPerDevice(devicesWithIds);

      if (devicesWithIds.length === 0) {
        logger.info('InHand API: No devices with valid identifiers', {
          totalDevices: devices.length,
        });
        return;
      }

      const iccids = devicesWithIds.map(d => d.iccid).filter(Boolean);
      const imsis = devicesWithIds.map(d => d.imsi).filter(Boolean);
      const msisdns = devicesWithIds.map(d => d.msisdn).filter(Boolean);
      // Belt-and-suspenders fallback (Task #21): also pull SIMs whose
      // device_name (= Wireless Logic custom_field1) matches an InHand
      // device's name. Once registration enforces SIM linkage at creation
      // time this rarely fires, but it cleanly catches any legacy device
      // that's named consistently across all three systems but missing
      // ICCID/IMSI/MSISDN.
      const deviceNamesLower = devicesWithIds
        .map(d => (d.deviceName ? d.deviceName.toLowerCase() : null))
        .filter(Boolean);

      const simsResult = await pool.query(
        `SELECT s.id, s.msisdn, s.iccid, s.imsi, s.device_name, s.truck_id, s.organization_id, t.truck_number
         FROM sims s
         LEFT JOIN trucks t ON t.id = s.truck_id
         WHERE s.is_active = true
           AND (
             (s.iccid = ANY($1) AND s.iccid IS NOT NULL)
             OR (s.imsi = ANY($2) AND s.imsi IS NOT NULL)
             OR (s.msisdn = ANY($3) AND s.msisdn IS NOT NULL)
             OR (LOWER(s.device_name) = ANY($4) AND s.device_name IS NOT NULL)
           )`,
        [iccids, imsis, msisdns, deviceNamesLower]
      );

      const simsByIccid = new Map();
      const simsByImsi = new Map();
      const simsByMsisdn = new Map();
      const simsByDeviceName = new Map();
      for (const sim of simsResult.rows) {
        if (sim.iccid) simsByIccid.set(sim.iccid, sim);
        if (sim.imsi) simsByImsi.set(sim.imsi, sim);
        if (sim.msisdn) simsByMsisdn.set(sim.msisdn, sim);
        if (sim.device_name) simsByDeviceName.set(sim.device_name.toLowerCase(), sim);
      }

      let trucksUpdated = 0;
      let simsMatched = 0;
      let simsRssiUpdated = 0;
      let unmatched = [];

      for (const device of devicesWithIds) {
        const sim = (device.iccid && simsByIccid.get(device.iccid))
          || (device.imsi && simsByImsi.get(device.imsi))
          || (device.msisdn && simsByMsisdn.get(device.msisdn))
          || (device.deviceName && simsByDeviceName.get(device.deviceName.toLowerCase()));

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

        // Always persist the latest router signal — independent of GPS.
        // If InHand omitted a signal field, device.rssi is null and we still
        // bump router_signal_updated_at so the freshness clock matches the
        // poll cadence (the UI/SignalCell shows "—" for null anyway).
        await pool.query(
          `UPDATE sims SET
            router_rssi = $1,
            router_signal_updated_at = NOW(),
            updated_at = NOW()
          WHERE id = $2`,
          [device.rssi, sim.id]
        );
        if (device.rssi != null) simsRssiUpdated++;

        // Truck-side GPS update — only when this device actually reported
        // coords AND the SIM is assigned to a truck.
        if (sim.truck_id && device.latitude != null && device.longitude != null) {
          const truckResult = await pool.query(
            'SELECT latitude, longitude, location_description FROM trucks WHERE id = $1',
            [sim.truck_id]
          );
          const currentTruck = truckResult.rows[0];
          const moved = hasCoordsMoved(
            currentTruck?.latitude, currentTruck?.longitude,
            device.latitude, device.longitude
          );
          
          let locationDesc = currentTruck?.location_description || null;
          if (moved || !locationDesc) {
            locationDesc = await reverseGeocode(device.latitude, device.longitude);
          }

          await pool.query(
            `UPDATE trucks SET
              latitude = $1,
              longitude = $2,
              location_description = COALESCE($4, location_description),
              last_location_update = NOW(),
              updated_at = NOW()
            WHERE id = $3`,
            [device.latitude, device.longitude, sim.truck_id, locationDesc]
          );
          trucksUpdated++;
        }
      }

      const duration = Date.now() - startTime;
      logger.info('InHand poll complete', {
        totalDevices: devices.length,
        devicesWithIds: devicesWithIds.length,
        simsMatched,
        simsRssiUpdated,
        trucksUpdated,
        unmatchedDevices: unmatched.length > 0 ? unmatched.map(d => `${d.name}(msisdn=${d.msisdn},iccid=${d.iccid})`).join('; ') : undefined,
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
   * Extract cellular signal strength from an InHand device object, normalized
   * to dBm (negative integer). Returns null when no recognizable field is
   * present.
   *
   * InHand's verbose=100 response field naming varies by firmware/model. We
   * try the most common locations in order:
   *   1. Already-in-dBm fields: device.rssi, info.signalStrength,
   *      device.signalStrength. Accept negative values in (-200, 0).
   *   2. ASU/CSQ scale (0-31, 99 = "no signal"): info.rssi (per the InHand
   *      API doc, this field is in ASU not dBm — line 306 of
   *      Device_Manager_API_-en.pdf), info.signalLevel, info.csq,
   *      device.signalLevel, info.signal. Convert via dBm = -113 + 2 * asu.
   * If neither is present, return null and let the SignalCell render as "—".
   */
  _extractRssi(device) {
    const info = device.info || {};

    // Newer firmware returns signalStrength as a nested object on the bulk
    // /api/devices?verbose=100 response, e.g.:
    //   "signalStrength": { "radio":"4G", "rssi":-77, "asu":26, ... }
    // Older firmware returned it as a flat negative dBm number. We handle
    // both: if it's an object, prefer .rssi (already in dBm), otherwise
    // accept the scalar.
    const sigObj = (device.signalStrength && typeof device.signalStrength === 'object')
      ? device.signalStrength : null;
    const sigObjInfo = (info.signalStrength && typeof info.signalStrength === 'object')
      ? info.signalStrength : null;

    const dbmCandidates = [
      device.rssi,
      sigObj && sigObj.rssi,
      sigObjInfo && sigObjInfo.rssi,
      typeof device.signalStrength === 'number' || typeof device.signalStrength === 'string' ? device.signalStrength : null,
      typeof info.signalStrength === 'number' || typeof info.signalStrength === 'string' ? info.signalStrength : null,
    ];
    for (const v of dbmCandidates) {
      if (v == null || v === '') continue;
      const n = parseFloat(v);
      if (!isNaN(n) && n < 0 && n > -200) {
        return Math.round(n);
      }
    }

    // Some firmware reports ASU inside the nested signalStrength object too.
    if (sigObj && sigObj.asu != null) {
      const asu = parseInt(sigObj.asu, 10);
      if (!isNaN(asu) && asu >= 0 && asu <= 31) {
        return -113 + 2 * asu;
      }
    }

    const csqCandidates = [
      info.rssi,
      info.signalLevel,
      info.csq,
      device.signalLevel,
      info.signal,
    ];
    for (const v of csqCandidates) {
      if (v == null || v === '') continue;
      const n = parseInt(v, 10);
      // Skip 99 — InHand uses it as "no signal / unknown".
      if (!isNaN(n) && n >= 0 && n <= 31) {
        return -113 + 2 * n;
      }
    }

    return null;
  }

  /**
   * For every device that's online and has an InHand `_id`, hit the
   * per-device signal endpoint and override `device.rssi` with the freshest
   * value. Caps in-flight requests at 10 by processing in chunks. Failures
   * are tolerated — a single device's missing signal doesn't sink the batch.
   */
  async _enrichSignalFromPerDevice(devicesWithIds) {
    const targets = devicesWithIds.filter(d => d.inhandId && d.online === 1);
    if (targets.length === 0) return;

    // ISO 8601 timestamps per the task spec and the InHand API doc
    // ("General agreement" — time params accept ISO 8601 strings like
    // 2019-09-19T14:07:06Z). 5-minute window per the spec.
    const now = new Date();
    const begin = new Date(now.getTime() - 5 * 60 * 1000);
    const endIso = now.toISOString();
    const beginIso = begin.toISOString();
    const CONCURRENCY = 10;
    let enriched = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const chunk = targets.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (device) => {
        try {
          const point = await inhandClient.getDeviceSignal(device.inhandId, beginIso, endIso);
          if (!point) return;
          const asu = point.asu;
          // Skip 99 (InHand "no signal") and out-of-range values.
          if (asu === 99 || asu < 0 || asu > 31) return;
          device.rssi = -113 + 2 * asu;
          enriched++;
        } catch (err) {
          failed++;
          logger.debug('InHand per-device signal fetch failed', {
            inhandId: device.inhandId,
            deviceName: device.deviceName,
            error: err.message,
          });
        }
      }));
    }

    logger.debug('InHand per-device signal enrichment complete', {
      eligible: targets.length,
      enriched,
      failed,
    });
  }

  /**
   * Extract location data from an InHand device object.
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
