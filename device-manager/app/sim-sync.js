/**
 * SIM Sync Service
 * 
 * Periodically syncs SIM cards from SIMPro/Wireless Logic API into the database.
 * Matches SIMs to PowerMon devices by custom_field1 (device name) and assigns
 * them to the correct organization based on the matched device.
 * 
 * Designed to scale to 10,000+ SIMs:
 * - Paginated listing fetches (500 per page)
 * - Detail fetches only for SIMs that match a device or exist in DB
 * - Batch DB lookups and upserts (chunks of 100)
 * - Concurrency-limited detail fetches
 * 
 * Runs on startup and every 10 minutes.
 * 
 * Flow:
 * 1. Fetch all SIMs from SIMPro via paginated listing
 * 2. Load all devices and existing SIMs from DB (two queries)
 * 3. For relevant SIMs missing custom_field1, fetch details (rate-limited)
 * 4. Match custom_field1 to power_mon_devices.device_name
 * 5. Batch upsert SIM records with correct organization_id
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { config } = require('./config');
const logger = require('./logger');
const db = require('./database');

const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const PAGE_SIZE = 500;
const UPSERT_BATCH_SIZE = 100;
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
      simsSkipped: 0,
      detailsFetched: 0,
      pages: 0,
      errors: [],
    };

    try {
      const pool = db.getPool();
      if (!pool) {
        logger.warn('Database not initialized, skipping SIM sync');
        return;
      }

      const allSims = await this.fetchAllSims(result);
      if (!allSims || allSims.length === 0) {
        logger.warn('No SIMs returned from SIMPro');
        return;
      }

      result.simsFound = allSims.length;

      if (allSims.length > 0) {
        const sample = allSims[0];
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

      const devicesByName = new Map();
      const duplicateNames = new Set();
      for (const dev of devicesResult.rows) {
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

      const existingSimsResult = await pool.query(
        `SELECT id, iccid, organization_id, device_id, truck_id,
                simpro_id, msisdn, imsi, eid, device_name,
                status, workflow_status, ip_address
         FROM sims`
      );
      const existingByIccid = new Map();
      for (const row of existingSimsResult.rows) {
        existingByIccid.set(row.iccid, row);
      }

      logger.info('SIM sync context loaded', {
        simCount: allSims.length,
        deviceCount: devicesResult.rows.length,
        existingSimCount: existingSimsResult.rows.length,
        uniqueDeviceNames: devicesByName.size,
      });

      const toCreate = [];
      const toUpdate = [];
      let detailErrors = 0;

      for (const sim of allSims) {
        try {
          let deviceName = sim.custom_field1 || sim.custom_field2 || null;
          const existingSim = existingByIccid.get(sim.iccid);

          if (!deviceName && existingSim && existingSim.device_name) {
            deviceName = existingSim.device_name;
          }

          if (!deviceName && detailErrors < MAX_DETAIL_ERRORS) {
            try {
              await this.delay(DETAIL_FETCH_DELAY_MS);
              const details = await this.fetchSimDetails(sim.msisdn);
              if (details) {
                deviceName = details.custom_field1 || details.custom_field2 || null;
                sim.ip_address = sim.ip_address || details.ip_address || null;
                result.detailsFetched++;
              }
            } catch (err) {
              detailErrors++;
              if (detailErrors <= 3) {
                logger.warn('SIM detail fetch failed', { msisdn: sim.msisdn, error: err.message });
              }
              if (detailErrors >= MAX_DETAIL_ERRORS) {
                logger.warn('Too many detail errors, stopping detail fetches this cycle');
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

          if (!matchedDevice && !existingSim) {
            result.simsSkipped++;
            continue;
          }

          if (existingSim) {
            const newOrgId = matchedDevice ? matchedDevice.organization_id : existingSim.organization_id;
            const newDeviceId = matchedDevice ? matchedDevice.id : existingSim.device_id;
            const newTruckId = matchedDevice ? matchedDevice.truck_id : existingSim.truck_id;
            const newDeviceName = deviceName || existingSim.device_name;

            const changed =
              existingSim.organization_id !== newOrgId ||
              existingSim.device_id !== newDeviceId ||
              existingSim.truck_id !== newTruckId ||
              existingSim.device_name !== newDeviceName ||
              existingSim.simpro_id !== sim.id ||
              existingSim.msisdn !== sim.msisdn ||
              existingSim.imsi !== (sim.imsi || null) ||
              existingSim.status !== sim.status ||
              existingSim.workflow_status !== (sim.workflow_status || null) ||
              existingSim.ip_address !== (sim.ip_address || null);

            if (!changed) {
              result.simsSkipped++;
              continue;
            }

            toUpdate.push({
              existingId: existingSim.id,
              organizationId: newOrgId,
              deviceId: newDeviceId,
              truckId: newTruckId,
              simproId: sim.id,
              msisdn: sim.msisdn,
              imsi: sim.imsi || null,
              eid: sim.eid || existingSim.eid || null,
              deviceName: newDeviceName,
              status: sim.status,
              workflowStatus: sim.workflow_status || null,
              ipAddress: sim.ip_address || null,
            });
          } else {
            const orgId = matchedDevice.organization_id;
            toCreate.push({
              organizationId: orgId,
              deviceId: matchedDevice.id,
              truckId: matchedDevice.truck_id,
              simproId: sim.id,
              iccid: sim.iccid,
              msisdn: sim.msisdn,
              imsi: sim.imsi || null,
              eid: sim.eid || null,
              deviceName: deviceName,
              status: sim.status,
              workflowStatus: sim.workflow_status || null,
              ipAddress: sim.ip_address || null,
            });
          }
        } catch (err) {
          result.errors.push(`${sim.msisdn}: ${err.message}`);
        }
      }

      if (toUpdate.length > 0) {
        for (let i = 0; i < toUpdate.length; i += UPSERT_BATCH_SIZE) {
          const batch = toUpdate.slice(i, i + UPSERT_BATCH_SIZE);
          await this.batchUpdate(pool, batch);
        }
        result.simsUpdated = toUpdate.length;
      }

      if (toCreate.length > 0) {
        for (let i = 0; i < toCreate.length; i += UPSERT_BATCH_SIZE) {
          const batch = toCreate.slice(i, i + UPSERT_BATCH_SIZE);
          await this.batchInsert(pool, batch);
        }
        result.simsCreated = toCreate.length;
      }

      const duration = Date.now() - startTime;
      logger.info('SIM sync complete', {
        simsFound: result.simsFound,
        simsMatched: result.simsMatched,
        simsCreated: result.simsCreated,
        simsUpdated: result.simsUpdated,
        simsSkipped: result.simsSkipped,
        detailsFetched: result.detailsFetched,
        pages: result.pages,
        errorCount: result.errors.length,
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

  async batchUpdate(pool, batch) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of batch) {
        await client.query(
          `UPDATE sims SET
            organization_id = $1, device_id = $2, truck_id = $3,
            simpro_id = $4, msisdn = $5, imsi = $6, eid = $7,
            device_name = $8, status = $9, workflow_status = $10,
            ip_address = $11, is_active = true,
            last_sync_at = NOW(), updated_at = NOW()
          WHERE id = $12`,
          [
            row.organizationId, row.deviceId, row.truckId,
            row.simproId, row.msisdn, row.imsi, row.eid,
            row.deviceName, row.status, row.workflowStatus,
            row.ipAddress, row.existingId,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async batchInsert(pool, batch) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of batch) {
        await client.query(
          `INSERT INTO sims (
            organization_id, device_id, truck_id, simpro_id,
            iccid, msisdn, imsi, eid, device_name,
            status, workflow_status, ip_address, is_active,
            last_sync_at, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,NOW(),NOW(),NOW())
          ON CONFLICT (iccid) DO NOTHING`,
          [
            row.organizationId, row.deviceId, row.truckId, row.simproId,
            row.iccid, row.msisdn, row.imsi, row.eid, row.deviceName,
            row.status, row.workflowStatus, row.ipAddress,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async fetchAllSims(result) {
    const allSims = [];
    let offset = 0;

    while (true) {
      const page = await this.fetchSimPage(offset, PAGE_SIZE);
      if (!page) break;

      result.pages++;
      const sims = page.sims || page;
      if (!Array.isArray(sims) || sims.length === 0) break;

      allSims.push(...sims);

      const totalCount = page.sim_count || page.total || sims.length;
      if (allSims.length >= totalCount || sims.length < PAGE_SIZE) {
        break;
      }

      offset += PAGE_SIZE;
    }

    return allSims;
  }

  async fetchSimPage(offset, limit) {
    const baseUrl = config.simpro.baseUrl.endsWith('/')
      ? config.simpro.baseUrl
      : config.simpro.baseUrl + '/';
    const fullUrl = new URL(`sims?limit=${limit}&offset=${offset}`, baseUrl);
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
              offset,
              response: data.substring(0, 500),
            });
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(data));
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
