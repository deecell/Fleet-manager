/**
 * Device Manager - Main Entry Point
 * 
 * Standalone application for managing PowerMon device connections,
 * polling, and data collection. Runs on a separate EC2 instance
 * from the web application.
 * 
 * Usage:
 *   DATABASE_URL=postgres://... node device-manager/app/index.js
 */

const { config, validateConfig } = require('./config');
const logger = require('./logger');
const db = require('./database');
const { connectionPool } = require('./connection-pool');
const { pollingScheduler } = require('./polling-scheduler');
const batchWriter = require('./batch-writer');
const { backfillService } = require('./backfill-service');
const { startMetricsServer, stopMetricsServer } = require('./metrics');

let isShuttingDown = false;

/**
 * Main startup function
 */
async function main() {
  logger.info('Device Manager starting', {
    pollInterval: config.polling.intervalMs,
    cohorts: config.polling.cohortCount,
    batchFlushInterval: config.batchWriter.flushIntervalMs,
  });

  try {
    // Validate configuration
    validateConfig();
    logger.info('Configuration validated');

    // Initialize database
    db.initDatabase();
    logger.info('Database initialized');

    // Initialize connection pool with devices from database
    const deviceCount = await connectionPool.initialize();
    
    if (deviceCount === 0) {
      logger.warn('No active devices found. Waiting for devices to be added...');
    }

    // Start metrics server
    startMetricsServer();

    // Start batch writer
    batchWriter.start();

    // Connect to all devices
    if (deviceCount > 0) {
      await connectionPool.connectAll();
    }

    // Start polling scheduler
    pollingScheduler.start();

    // Start backfill service
    backfillService.start();

    logger.info('Device Manager started successfully', {
      devices: deviceCount,
      status: 'running',
    });

    // Set up periodic device list refresh (every 5 minutes)
    setInterval(async () => {
      try {
        await connectionPool.refresh();
      } catch (err) {
        logger.error('Failed to refresh device list', { error: err.message });
      }
    }, 5 * 60 * 1000);

  } catch (err) {
    logger.error('Failed to start Device Manager', { error: err.message });
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 * 
 * Order matters: Stop polling first, then wait for backfills,
 * then flush data, then close connections and database.
 */
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info('Shutting down Device Manager', { signal });

  try {
    // 1. Stop polling scheduler (no new polls)
    pollingScheduler.stop();
    logger.info('Polling scheduler stopped');

    // 2. Wait for active backfill operations to complete
    await backfillService.stop();
    logger.info('Backfill service stopped');

    // 3. Flush remaining measurements to database
    await batchWriter.stop();
    logger.info('Batch writer stopped');

    // 4. Disconnect all device connections
    connectionPool.disconnectAll();
    logger.info('Device connections closed');

    // 5. Stop metrics server
    await stopMetricsServer();
    logger.info('Metrics server stopped');

    // 6. Close database pool (last, after all writes complete)
    await db.closeDatabase();
    logger.info('Database closed');

    logger.info('Device Manager shutdown complete');
    process.exit(0);

  } catch (err) {
    logger.error('Error during shutdown', { error: err.message });
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

// Start the application
main();
