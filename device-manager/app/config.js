/**
 * Device Manager Configuration
 * 
 * Environment variables for the standalone Device Manager application.
 * This runs on a separate EC2 instance from the web app.
 */

const config = {
  // Database connection
  database: {
    url: process.env.DATABASE_URL,
    poolSize: parseInt(process.env.DB_POOL_SIZE || '10', 10),
  },

  // Polling configuration
  polling: {
    intervalMs: parseInt(process.env.POLL_INTERVAL_MS || '10000', 10), // 10 seconds
    jitterMs: parseInt(process.env.POLL_JITTER_MS || '250', 10), // ±250ms jitter
    cohortCount: parseInt(process.env.COHORT_COUNT || '10', 10), // Number of polling cohorts
    maxConcurrentPolls: parseInt(process.env.MAX_CONCURRENT_POLLS || '100', 10),
    timeoutMs: parseInt(process.env.POLL_TIMEOUT_MS || '8000', 10), // 8 second timeout
  },

  // Connection management
  connection: {
    maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '5', 10),
    baseReconnectDelayMs: parseInt(process.env.BASE_RECONNECT_DELAY_MS || '1000', 10),
    maxReconnectDelayMs: parseInt(process.env.MAX_RECONNECT_DELAY_MS || '60000', 10),
  },

  // Batch writer configuration
  batchWriter: {
    flushIntervalMs: parseInt(process.env.BATCH_FLUSH_INTERVAL_MS || '2000', 10), // 2 seconds
    maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || '500', 10),
    maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '10000', 10),
  },

  // Backfill configuration
  backfill: {
    gapThresholdMs: parseInt(process.env.GAP_THRESHOLD_MS || '30000', 10), // 30 seconds = 3 missed polls
    maxConcurrentBackfills: parseInt(process.env.MAX_CONCURRENT_BACKFILLS || '5', 10),
    batchSize: parseInt(process.env.BACKFILL_BATCH_SIZE || '1000', 10),
  },

  // Health check / metrics server
  server: {
    port: parseInt(process.env.DM_PORT || '3001', 10),
    metricsPath: '/metrics',
    healthPath: '/health',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json', // json or text
  },
};

/**
 * Validate required configuration
 */
function validateConfig() {
  const errors = [];

  if (!config.database.url) {
    errors.push('DATABASE_URL environment variable is required');
  }

  if (config.polling.intervalMs < 1000) {
    errors.push('POLL_INTERVAL_MS must be at least 1000ms');
  }

  if (config.polling.cohortCount < 1) {
    errors.push('COHORT_COUNT must be at least 1');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

module.exports = { config, validateConfig };
