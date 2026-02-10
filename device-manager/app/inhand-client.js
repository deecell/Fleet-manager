/**
 * InHand Networks Device Manager Cloud API Client
 * 
 * OAuth2 authenticated client for InHand Networks' Device Manager platform.
 * Used to fetch GPS location data from InHand routers installed in trucks.
 * 
 * Authentication: OAuth2 password grant. Access tokens valid ~1 hour.
 * Client ID/secret are optional — many InHand instances work with just
 * username/password. If client credentials are provided, they're included.
 * 
 * Key endpoint: GET /api/devices?verbose=50 returns all devices with location data.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { config } = require('./config');
const logger = require('./logger');

class InHandClient {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = 0;
    this.refreshTokenExpiresAt = 0;
  }

  /**
   * Authenticate with InHand API using password grant
   * Tries OAuth2 password grant first, falls back to /api/login if needed
   */
  async authenticate() {
    const { baseUrl, username, password, clientId, clientSecret } = config.inhand;

    logger.info('InHand API: Authenticating', { username, baseUrl });

    const params = {
      grant_type: 'password',
      username,
      password,
    };

    if (clientId) params.client_id = clientId;
    if (clientSecret) params.client_secret = clientSecret;

    const body = new URLSearchParams(params).toString();

    let response = await this._request('POST', '/oauth/token', body, {
      'Content-Type': 'application/x-www-form-urlencoded',
    }, true);

    if (!response || !response.access_token) {
      logger.info('InHand API: OAuth token endpoint failed, trying /api/login');
      const loginBody = JSON.stringify({ username, password });
      response = await this._request('POST', '/api/login', loginBody, {
        'Content-Type': 'application/json',
      }, true);
    }

    if (!response || !response.access_token) {
      throw new Error('InHand API authentication failed: no access token received');
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
   */
  async refreshAccessToken() {
    if (!this.refreshToken) {
      logger.warn('InHand API: No refresh token available, doing full auth');
      return this.authenticate();
    }

    const { clientId, clientSecret } = config.inhand;

    logger.debug('InHand API: Refreshing access token');

    const params = {
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    };
    if (clientId) params.client_id = clientId;
    if (clientSecret) params.client_secret = clientSecret;

    const body = new URLSearchParams(params).toString();

    try {
      const response = await this._request('POST', '/oauth/token', body, {
        'Content-Type': 'application/x-www-form-urlencoded',
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
   * Get all devices with full detail including location data
   * verbose=50 returns location.latitude, location.longitude, location.time, location.source
   */
  async getDevicesWithLocation() {
    await this.ensureAuthenticated();

    const response = await this._request('GET', '/api/devices?verbose=50', null, {
      'Authorization': `Bearer ${this.accessToken}`,
    });

    if (!response) {
      logger.error('InHand API: No response from devices endpoint');
      return [];
    }

    const devices = Array.isArray(response) ? response : (response.data || response.devices || []);

    logger.debug('InHand API: Got devices', { count: devices.length });
    return devices;
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
