/**
 * InHand Networks Device Manager Cloud API Client
 * 
 * OAuth2 authenticated client for InHand Networks' Device Manager platform.
 * Used to fetch GPS location data from InHand routers installed in trucks.
 * 
 * Authentication: OAuth2 password grant via POST /oauth2/access_token
 * - Password must be MD5-hashed (password_type=2, the default)
 * - Fixed client credentials are required
 * - Access tokens valid ~1 hour, refresh tokens valid ~15 days
 * 
 * Key endpoint: GET /api/devices?verbose=50 returns all devices with location data.
 * Response format: { cursor, limit, total, result: [...devices] }
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { config } = require('./config');
const logger = require('./logger');

const INHAND_CLIENT_ID = '000017953450251798098136';
const INHAND_CLIENT_SECRET = '08E9EC6793345759456CB8BAE52615F3';

class InHandClient {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = 0;
    this.refreshTokenExpiresAt = 0;
  }

  /**
   * MD5 hash the password as required by InHand API (password_type=2)
   */
  _md5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
  }

  /**
   * Authenticate with InHand API using OAuth2 password grant
   * POST /oauth2/access_token with form-urlencoded body
   */
  async authenticate() {
    const { baseUrl, username, password } = config.inhand;

    logger.info('InHand API: Authenticating', { username, baseUrl });

    const md5Password = this._md5(password);

    const params = {
      grant_type: 'password',
      username,
      password: md5Password,
      password_type: '2',
      client_id: INHAND_CLIENT_ID,
      client_secret: INHAND_CLIENT_SECRET,
    };

    const body = new URLSearchParams(params).toString();

    const response = await this._request('POST', '/oauth2/access_token', body, {
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    }, true);

    if (!response || !response.access_token) {
      const fields = response ? JSON.stringify(response).substring(0, 500) : 'null response';
      throw new Error(`InHand API authentication failed: no access token received. Response: ${fields}`);
    }

    this.accessToken = response.access_token;
    this.refreshToken = response.refresh_token || null;
    this.tokenExpiresAt = Date.now() + (response.expires_in || 3600) * 1000 - 60000;
    if (this.refreshToken) {
      this.refreshTokenExpiresAt = Date.now() + 15 * 24 * 60 * 60 * 1000;
    }

    logger.info('InHand API: Authenticated successfully', {
      expiresIn: response.expires_in,
      hasRefreshToken: !!this.refreshToken,
    });
  }

  /**
   * Refresh the access token using the refresh token
   * POST /oauth2/access_token with grant_type=refresh_token
   */
  async refreshAccessToken() {
    if (!this.refreshToken) {
      logger.warn('InHand API: No refresh token available, doing full auth');
      return this.authenticate();
    }

    logger.debug('InHand API: Refreshing access token');

    const params = {
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: INHAND_CLIENT_ID,
      client_secret: INHAND_CLIENT_SECRET,
    };

    const body = new URLSearchParams(params).toString();

    try {
      const response = await this._request('POST', '/oauth2/access_token', body, {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      }, true);

      if (!response || !response.access_token) {
        throw new Error('Token refresh failed');
      }

      this.accessToken = response.access_token;
      if (response.refresh_token) {
        this.refreshToken = response.refresh_token;
        this.refreshTokenExpiresAt = Date.now() + 15 * 24 * 60 * 60 * 1000;
      }
      this.tokenExpiresAt = Date.now() + (response.expires_in || 3600) * 1000 - 60000;

      logger.debug('InHand API: Token refreshed successfully');
    } catch (err) {
      logger.warn('InHand API: Token refresh failed, doing full auth', { error: err.message });
      return this.authenticate();
    }
  }

  /**
   * Ensure we have a valid access token, refreshing/re-authenticating as needed
   */
  async ensureAuthenticated() {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      if (this.refreshToken && Date.now() < this.refreshTokenExpiresAt) {
        await this.refreshAccessToken();
      } else {
        await this.authenticate();
      }
    }
  }

  /**
   * Get all devices with full detail including location and mobileNumber
   * GET /api/devices?verbose=100 returns all fields:
   *   - location.latitude, location.longitude, location.time, location.source
   *   - mobileNumber (MSISDN of the SIM card in the router)
   *   - info.iccid, info.imsi
   * Response: { cursor, limit, total, result: [...devices] }
   * Paginates through all pages if total > limit
   */
  async getDevicesWithLocation() {
    await this.ensureAuthenticated();

    let allDevices = [];
    let cursor = 0;
    const limit = 100;
    let total = Infinity;

    while (cursor < total) {
      const response = await this._request('GET', `/api/devices?verbose=100&cursor=${cursor}&limit=${limit}`, null, {
        'Authorization': `Bearer ${this.accessToken}`,
      });

      if (!response) {
        logger.error('InHand API: No response from devices endpoint');
        break;
      }

      const devices = response.result || [];
      allDevices = allDevices.concat(devices);

      total = response.total || 0;
      const pageLimit = response.limit || limit;
      cursor += pageLimit;

      if (devices.length === 0) break;
    }

    logger.debug('InHand API: Got devices', { count: allDevices.length, total });
    return allDevices;
  }

  /**
   * Fetch the cellular signal time-series for a single device.
   * GET /api/devices/{deviceId}/signal?begin=<ISO-8601>&end=<ISO-8601>
   *
   * Per the InHand Device Manager API doc
   * (attached_assets/Device_Manager_API_-en_1778694184895.pdf, page on
   * "General agreement"), the time parameter may be either a unix timestamp
   * or an ISO 8601 string; we send ISO 8601 (`new Date().toISOString()`)
   * for log-readability and parity with the task spec. The response shape
   * is:
   *   { result: { columns: ["time", "rssi"], values: [[ts, asu], ...] } }
   * where the "rssi" column is actually ASU (0-31, 99 = "no signal" — see
   * doc line 306: "info.rssi — Equipment signal strength value in asu").
   *
   * Returns the most recent { time, asu } pair, or null if the endpoint
   * returns no points / fails. Pass deviceId as the Mongo `_id` string from
   * the bulk /api/devices response — the per-device endpoint does NOT accept
   * the serial number.
   */
  async getDeviceSignal(deviceId, beginIso, endIso) {
    await this.ensureAuthenticated();

    const path = `/api/devices/${encodeURIComponent(deviceId)}/signal?begin=${encodeURIComponent(beginIso)}&end=${encodeURIComponent(endIso)}`;
    const response = await this._request('GET', path, null, {
      'Authorization': `Bearer ${this.accessToken}`,
    });

    if (!response || !response.result) return null;
    const values = response.result.values;
    if (!Array.isArray(values) || values.length === 0) return null;

    const last = values[values.length - 1];
    if (!Array.isArray(last) || last.length < 2) return null;

    const asu = parseInt(last[1], 10);
    if (isNaN(asu)) return null;

    return { time: last[0], asu };
  }

  /**
   * Make an HTTP/HTTPS request to the InHand API
   */
  _request(method, path, body = null, headers = {}, skipAuth = false) {
    return new Promise((resolve) => {
      const fullUrl = new URL(path, config.inhand.baseUrl);
      const isHttps = fullUrl.protocol === 'https:';
      const httpClient = isHttps ? https : http;
      const defaultPort = isHttps ? 443 : 80;

      const options = {
        hostname: fullUrl.hostname,
        port: fullUrl.port || defaultPort,
        path: fullUrl.pathname + fullUrl.search,
        method,
        headers: {
          'Accept': 'application/json',
          ...headers,
        },
        timeout: 30000,
      };

      if (body) {
        options.headers['Content-Length'] = Buffer.byteLength(body);
      }

      const req = httpClient.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 401 && !skipAuth) {
            logger.warn('InHand API: 401 Unauthorized, token may be expired');
            this.accessToken = null;
            this.tokenExpiresAt = 0;
            resolve(null);
            return;
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            logger.error('InHand API error', {
              statusCode: res.statusCode,
              path,
              response: data.substring(0, 500),
            });
            resolve(null);
            return;
          }

          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (parseErr) {
            logger.error('InHand API: Failed to parse response', {
              error: parseErr.message,
              path,
              data: data.substring(0, 200),
            });
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        logger.error('InHand API request failed', { error: err.message, path });
        resolve(null);
      });

      req.on('timeout', () => {
        req.destroy();
        logger.error('InHand API request timeout', { path });
        resolve(null);
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
}

const inhandClient = new InHandClient();

module.exports = { inhandClient, InHandClient };
