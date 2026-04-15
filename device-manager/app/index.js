/**
 * Device Manager - Main Entry Point
 * 
 * Standalone application for managing PowerMon device connections,
 * polling, and data collection. Runs on a separate EC2 instance
 * from the web application.
 * 
 * Architecture modes:
 *   - supervisor (default): Forks one worker per cohort for fault isolation.
 *     A crash in one worker only affects that cohort's devices (~10% blast radius).
 *   - single: Legacy single-process mode. Set DEVICE_MANAGER_MODE=single to use.
 * 
 * Usage:
 *   DATABASE_URL=postgres://... node device-manager/app/index.js
 *   DATABASE_URL=postgres://... DEVICE_MANAGER_MODE=single node device-manager/app/index.js
 */

const mode = process.env.DEVICE_MANAGER_MODE || 'supervisor';

if (mode === 'single') {
  startSingleProcess();
} else {
  startSupervisor();
}

function startSupervisor() {
  require('./supervisor');
}

function startSingleProcess() {
  const { config, validateConfig } = require('./config');
  const logger = require('./logger');
  const db = require('./database');
  const { connectionPool } = require('./connection-pool');
  const { pollingScheduler } = require('./polling-scheduler');
  const batchWriter = require('./batch-writer');
  const { backfillService } = require('./backfill-service');
  const { startMetricsServer, stopMetricsServer } = require('./metrics');
  const { simPoller } = require('./sim-poller');
  const { inhandPoller } = require('./inhand-poller');
  const { simSync } = require('./sim-sync');

  let isShuttingDown = false;

  async function main() {
    logger.info('Device Manager starting (single-process mode)', {
      pollInterval: config.polling.intervalMs,
      cohorts: config.polling.cohortCount,
      batchFlushInterval: config.batchWriter.flushIntervalMs,
    });

    try {
      validateConfig();
      logger.info('Configuration validated');

      db.initDatabase();
      logger.info('Database initialized');

      const crashData = db.readCrashAttribution();
      if (crashData) {
        logger.warn('=== CRASH ATTRIBUTION: Previous crash detected ===', {
          deviceId: crashData.deviceId,
          deviceName: crashData.deviceName,
          crashTime: crashData.timestamp
        });
        await db.markCrashCulprit(crashData.deviceId);
      }

      await db.startupRecoverySweep();

      const deviceCount = await connectionPool.initialize();
      
      if (deviceCount === 0) {
        logger.warn('No active devices found. Waiting for devices to be added...');
      }

      startMetricsServer();
      batchWriter.start();

      if (deviceCount > 0) {
        await connectionPool.connectAll();
      }

      pollingScheduler.start();
      backfillService.start();
      simPoller.start();
      inhandPoller.start();
      simSync.start();

      logger.info('Device Manager started successfully (single-process)', {
        devices: deviceCount,
        status: 'running',
      });

      setInterval(async () => {
        try {
          await connectionPool.refresh();
        } catch (err) {
          logger.error('Failed to refresh device list', { error: err.message });
        }
      }, 5 * 60 * 1000);

      setInterval(async () => {
        try {
          await connectionPool.recoverUnstableDevices();
        } catch (err) {
          logger.error('Failed to recover unstable devices', { error: err.message });
        }
      }, 5 * 60 * 1000);

      setInterval(async () => {
        try {
          await connectionPool.recoverNoPowerDevices();
        } catch (err) {
          logger.error('Failed to recover no_power devices', { error: err.message });
        }
      }, 30 * 60 * 1000);

    } catch (err) {
      logger.error('Failed to start Device Manager', { error: err.message });
      process.exit(1);
    }
  }

  async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Shutting down Device Manager', { signal });

    try {
      pollingScheduler.stop();
      logger.info('Polling scheduler stopped');

      simPoller.stop();
      logger.info('SIM poller stopped');

      inhandPoller.stop();
      logger.info('InHand poller stopped');

      simSync.stop();
      logger.info('SIM sync stopped');

      await backfillService.stop();
      logger.info('Backfill service stopped');

      await batchWriter.stop();
      logger.info('Batch writer stopped');

      connectionPool.disconnectAll();
      logger.info('Device connections closed');

      await stopMetricsServer();
      logger.info('Metrics server stopped');

      await db.closeDatabase();
      logger.info('Database closed');

      logger.info('Device Manager shutdown complete');
      process.exit(0);

    } catch (err) {
      logger.error('Error during shutdown', { error: err.message });
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });

  main();
}
