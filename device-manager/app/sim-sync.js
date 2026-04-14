/**
 * SIM Sync Service
 * 
 * Periodically syncs SIM cards from SIMPro/Wireless Logic API into the database.
 * Matches SIMs to PowerMon devices by custom_field1 (device name) and assigns
 * them to the correct organization based on the matched device.
 * 
 * Runs on startup and every 10 minutes.
 * 
 * Flow:
 * 1. Fetch all SIMs from SIMPro listing API (GET /sims?limit=2000)
 * 2. For SIMs missing custom_field1, fetch individual details (rate-limited)
 * 3. Match custom_field1 to power_mon_devices.device_name
 * 4. Create or update SIM records with correct organization_id
 * 5. Only create new records for SIMs that match a known device
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { config } = require('./config');
const logger = require('./logger');
const db = require('./database');

const SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const DETAIL_FETCH_DELAY_MS = 300;
const MAX_DETAIL_ERRORS = 5;

class SimSync {
  constructor() {
    this.intervalId = null;
    this.isSyncing = false;
  }

  start() {
    if (this.intervalId) {
      logger.warn('SIM sync already running');
      return;
    }

    if (!config.simpro.apiClient || !config.simpro.apiKey) {
      logger.warn('SIMPro API credentials not configured, SIM sync disabled');
      return;
    }

    logger.info('Starting SIM sync service', {
      interval: SYNC_INTERVAL_MS,
      baseUrl: config.simpro.baseUrl,
    });

    setTimeout(() => this.sync(), 5000);
    this.intervalId = setInterval(() => this.sync(), SYNC_INTERVAL_MS);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('SIM sync stopped');
    }
  }

  async sync() {
    if (this.isSyncing) {
      logger.debug('Previous SIM sync still running, skipping');
      return;
    }

    this.isSyncing = true;
    const startTime = Date.now();

    const result = {
      simsFound: 0,
      simsMatched: 0,
      simsCreated: 0,
      simsUpdated: 0,
      detailsFetched: 0,
      detailErrors: 0,
      errors: [],
    };

    try {
      const pool = db.getPool();
      if (!pool) {
        logger.warn('Database not initialized, skipping SIM sync');
        return;
      }

      const simProSims = await this.fetchSimListing();
      if (!simProSims) {
        logger.error('Failed to fetch SIM listing from SIMPro');
        return;
      }

      result.simsFound = simProSims.length;

      if (simProSims.length > 0) {
        const sample = simProSims[0];
        logger.info('SIM listing sample', {
          keys: Object.keys(sample),
          id: sample.id,
          iccid: sample.iccid,
          msisdn: sample.msisdn,
          custom_field1: sample.custom_field1 || null,
          custom_field2: sample.custom_field2 || null,
          status: sample.status,
        });
      }

      const devicesResult = await pool.query(
        `SELECT d.id, d.device_name, d.organization_id, d.truck_id
         FROM power_mon_devices d
         WHERE d.device_name IS NOT NULL`
      );
      const devices = devicesResult.rows;

      const devicesByName = new Map();
      const duplicateNames = new Set();
      for (const dev of devices) {
        const key = dev.device_name.toLowerCase();
        if (devicesByName.has(key)) {
          duplicateNames.add(key);
          logger.warn('Duplicate device name across orgs, skipping matches', {
            deviceName: dev.device_name,
            org1: devicesByName.get(key).organization_id,
            org2: dev.organization_id,
          });
        }
        devicesByName.set(key, dev);
      }
      for (const dup of duplicateNames) {
        devicesByName.delete(dup);
      }

      logger.info('SIM sync matching', {
        simCount: simProSims.length,
        deviceCount: devices.length,
        deviceNames: devices.map(d => d.device_name),
      });

      for (const sim of simProSims) {
        try {
          let deviceName = sim.custom_field1 || sim.custom_field2 || null;

          if (!deviceName && result.detailErrors < MAX_DETAIL_ERRORS) {
            try {
              await this.delay(DETAIL_FETCH_DELAY_MS);
              const details = await this.fetchSimDetails(sim.msisdn);
              if (details) {
                deviceName = details.custom_field1 || details.custom_field2 || null;
                sim.ip_address = sim.ip_address || details.ip_address;
                result.detailsFetched++;
                if (result.detailsFetched <= 3) {
                  logger.debug('SIM detail fetched', {
                    msisdn: sim.msisdn,
                    custom_field1: details.custom_field1 || null,
                    custom_field2: details.custom_field2 || null,
                  });
                }
              }
            } catch (err) {
              result.detailErrors++;
              if (result.detailErrors <= 3) {
                logger.warn('SIM detail fetch failed', {
                  msisdn: sim.msisdn,
                  error: err.message,
                });
              }
              if (result.detailErrors >= MAX_DETAIL_ERRORS) {
                logger.warn('Too many detail fetch errors, stopping detail fetches');
              }
            }
          }

          let matchedDevice = null;
          if (deviceName) {
            matchedDevice = devicesByName.get(deviceName.toLowerCase());
            if (matchedDevice) {
              result.simsMatched++;
            }
          }

          const existingResult = await pool.query(
            'SELECT id, organization_id FROM sims WHERE iccid = $1',
            [sim.iccid]
          );
          const existingSim = existingResult.rows[0];

          if (!matchedDevice && !existingSim) {
            continue;
          }

          const orgId = matchedDevice ? matchedDevice.organization_id : existingSim.organization_id;
          if (!orgId) continue;

          let truckId = matchedDevice ? matchedDevice.truck_id : null;
          if (!truckId && existingSim) {
            const truckResult = await pool.query(
              'SELECT truck_id FROM sims WHERE id = $1',
              [existingSim.id]
            );
            truckId = truckResult.rows[0]?.truck_id || null;
          }

          if (existingSim) {
            await pool.query(
              `UPDATE sims SET
                organization_id = $1,
                device_id = $2,
                truck_id = $3,
                simpro_id = $4,
                msisdn = $5,
                imsi = $6,
                eid = $7,
                device_name = $8,
                status = $9,
                workflow_status = $10,
                ip_address = $11,
                is_active = true,
                last_sync_at = NOW(),
                updated_at = NOW()
              WHERE id = $12`,
              [
                orgId,
                matchedDevice?.id || null,
                truckId,
                sim.id,
                sim.msisdn,
                sim.imsi || null,
                sim.eid || null,
                deviceName || null,
                sim.status,
                sim.workflow_status || null,
                sim.ip_address || null,
                existingSim.id,
              ]
            );
            result.simsUpdated++;
          } else {
            await pool.query(
              `INSERT INTO sims (
                organization_id, device_id, truck_id, simpro_id,
                iccid, msisdn, imsi, eid, device_name,
                status, workflow_status, ip_address, is_active,
                last_sync_at, created_at, updated_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,NOW(),NOW(),NOW())`,
              [
                orgId,
                matchedDevice?.id || null,
                truckId,
                sim.id,
                sim.iccid,
                sim.msisdn,
                sim.imsi || null,
                sim.eid || null,
                deviceName || null,
                sim.status,
                sim.workflow_status || null,
                sim.ip_address || null,
              ]
            );
            result.simsCreated++;
          }
        } catch (err) {
          result.errors.push(`${sim.msisdn}: ${err.message}`);
        }
      }

      const duration = Date.now() - startTime;
      logger.info('SIM sync complete', {
        ...result,
        errors: result.errors.length,
        durationMs: duration,
      });

      if (result.errors.length > 0) {
        logger.warn('SIM sync errors', { errors: result.errors.slice(0, 10) });
      }

    } catch (err) {
      logger.error('SIM sync failed', { error: err.message, stack: err.stack });
    } finally {
      this.isSyncing = false;
    }
  }

  async fetchSimListing() {
    const baseUrl = config.simpro.baseUrl.endsWith('/')
      ? config.simpro.baseUrl
      : config.simpro.baseUrl + '/';
    const fullUrl = new URL('sims?limit=2000', baseUrl);
    const isHttps = fullUrl.protocol === 'https:';
    const httpClient = isHttps ? https : http;

    return new Promise((resolve) => {
      const options = {
        hostname: fullUrl.hostname,
        port: fullUrl.port || (isHttps ? 443 : 80),
        path: fullUrl.pathname + fullUrl.search,
        method: 'GET',
        headers: {
          'x-api-client': config.simpro.apiClient,
          'x-api-key': config.simpro.apiKey,
          'Accept': 'application/json',
        },
        timeout: 30000,
      };

      const req = httpClient.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            logger.error('SIMPro listing API error', {
              statusCode: res.statusCode,
              response: data.substring(0, 500),
            });
            resolve(null);
            return;
          }
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.sims || parsed);
          } catch (parseErr) {
            logger.error('Failed to parse SIMPro listing', { error: parseErr.message });
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        logger.error('SIMPro listing request failed', { error: err.message });
        resolve(null);
      });
      req.on('timeout', () => {
        req.destroy();
        logger.error('SIMPro listing request timeout');
        resolve(null);
      });
      req.end();
    });
  }

  async fetchSimDetails(msisdn) {
    const baseUrl = config.simpro.baseUrl.endsWith('/')
      ? config.simpro.baseUrl
      : config.simpro.baseUrl + '/';
    const fullUrl = new URL(`sim/${msisdn}/details`, baseUrl);
    const isHttps = fullUrl.protocol === 'https:';
    const httpClient = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: fullUrl.hostname,
        port: fullUrl.port || (isHttps ? 443 : 80),
        path: fullUrl.pathname,
        method: 'GET',
        headers: {
          'x-api-client': config.simpro.apiClient,
          'x-api-key': config.simpro.apiKey,
          'Accept': 'application/json',
        },
        timeout: 10000,
      };

      const req = httpClient.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`SIMPro API ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (parseErr) {
            reject(new Error(`Parse error: ${parseErr.message}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const simSync = new SimSync();

module.exports = { simSync };
