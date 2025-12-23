/**
 * SIM Location Poller
 * 
 * Polls SIMPro API for SIM card location data (country, network, MCC/MNC).
 * Runs on a 60-second interval to update all active SIMs across all organizations.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { config } = require('./config');
const logger = require('./logger');
const db = require('./database');

const POLL_INTERVAL_MS = 60 * 1000; // 1 minute

class SimPoller {
  constructor() {
    this.intervalId = null;
    this.isPolling = false;
  }

  /**
   * Start the SIM location polling loop
   */
  start() {
    if (this.intervalId) {
      logger.warn('SIM poller already running');
      return;
    }

    if (!config.simpro.apiClient || !config.simpro.apiKey) {
      logger.warn('SIMPro API credentials not configured, SIM polling disabled');
      return;
    }

    logger.info('Starting SIM location poller', {
      interval: POLL_INTERVAL_MS,
      baseUrl: config.simpro.baseUrl,
    });

    // Run immediately, then every minute
    this.pollLocations();
    this.intervalId = setInterval(() => this.pollLocations(), POLL_INTERVAL_MS);
  }

  /**
   * Stop the SIM location polling loop
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('SIM poller stopped');
    }
  }

  /**
   * Poll SIMPro for all active SIMs
   */
  async pollLocations() {
    if (this.isPolling) {
      logger.debug('Previous SIM poll still running, skipping');
      return;
    }

    this.isPolling = true;
    const startTime = Date.now();

    try {
      const pool = db.getPool();
      if (!pool) {
        logger.warn('Database not initialized, skipping SIM poll');
        return;
      }

      // Get all active SIMs with ICCIDs
      const simsResult = await pool.query(
        `SELECT id, organization_id, iccid, truck_id 
         FROM sims 
         WHERE is_active = true AND iccid IS NOT NULL`
      );

      const sims = simsResult.rows;
      if (sims.length === 0) {
        return; // Silent return if no SIMs
      }

      // Extract ICCIDs for batch API call
      const iccids = sims.map(s => s.iccid);

      // Call SIMPro usage-location API
      const locationData = await this.fetchLocations(iccids);
      if (!locationData || locationData.length === 0) {
        return;
      }

      // Create lookup map
      const locationMap = new Map();
      for (const loc of locationData) {
        locationMap.set(loc.iccid, loc);
      }

      // Update each SIM
      let locationsUpdated = 0;
      let trucksUpdated = 0;

      for (const sim of sims) {
        const loc = locationMap.get(sim.iccid);
        if (!loc) continue;

        // Update SIM record
        await pool.query(
          `UPDATE sims SET
            country = $1,
            network_name = $2,
            mcc = $3,
            mnc = $4,
            last_location_update = NOW(),
            updated_at = NOW()
          WHERE id = $5`,
          [loc.country || null, loc.network || null, loc.mcc || null, loc.mnc || null, sim.id]
        );
        locationsUpdated++;

        // Update truck country if linked
        if (sim.truck_id && loc.country) {
          await pool.query(
            `UPDATE trucks SET
              country = $1,
              last_location_update = NOW(),
              updated_at = NOW()
            WHERE id = $2`,
            [loc.country, sim.truck_id]
          );
          trucksUpdated++;
        }
      }

      const duration = Date.now() - startTime;
      if (locationsUpdated > 0) {
        logger.info('SIM locations updated', {
          simsPolled: sims.length,
          locationsUpdated,
          trucksUpdated,
          durationMs: duration,
        });
      }

    } catch (err) {
      logger.error('SIM poll failed', { error: err.message });
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Fetch location data from SIMPro API
   */
  async fetchLocations(iccids) {
    const identifiers = iccids.join(',');
    
    // Parse base URL from config to support custom endpoints
    // Ensure base URL ends with / for proper URL joining
    const baseUrlString = config.simpro.baseUrl.endsWith('/') 
      ? config.simpro.baseUrl 
      : config.simpro.baseUrl + '/';
    const fullUrl = new URL(`sims/usage-location?identifiers=${encodeURIComponent(identifiers)}`, baseUrlString);
    
    const isHttps = fullUrl.protocol === 'https:';
    const httpClient = isHttps ? https : http;
    const defaultPort = isHttps ? 443 : 80;

    return new Promise((resolve) => {
      const options = {
        hostname: fullUrl.hostname,
        port: fullUrl.port || defaultPort,
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

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode !== 200) {
            logger.error('SIMPro API error', {
              statusCode: res.statusCode,
              response: data.substring(0, 500),
            });
            resolve(null);
            return;
          }

          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (parseErr) {
            logger.error('Failed to parse SIMPro response', { error: parseErr.message });
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        logger.error('Failed to fetch SIM locations from SIMPro', { error: err.message });
        resolve(null);
      });

      req.on('timeout', () => {
        req.destroy();
        logger.error('SIMPro API request timeout');
        resolve(null);
      });

      req.end();
    });
  }
}

const simPoller = new SimPoller();

module.exports = { simPoller };
