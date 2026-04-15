/**
 * Device Manager Worker Process
 * 
 * Each worker manages a single cohort of devices with its own native library instance.
 * If one device corrupts the native library, only this worker crashes — the supervisor
 * respawns it while other workers keep running.
 * 
 * Started by supervisor.js via child_process.fork().
 * Receives cohort ID via WORKER_COHORT_ID environment variable.
 */

const { config, validateConfig } = require('./config');
const logger = require('./logger');
const db = require('./database');
const { connectionPool } = require('./connection-pool');
const { pollingScheduler } = require('./polling-scheduler');
const batchWriter = require('./batch-writer');
const { backfillService } = require('./backfill-service');

const cohortId = parseInt(process.env.WORKER_COHORT_ID, 10);
const totalCohorts = config.polling.cohortCount;

if (isNaN(cohortId)) {
  console.error('WORKER_COHORT_ID environment variable is required');
  process.exit(1);
}

const workerPrefix = `[worker:${cohortId}]`;

let isShuttingDown = false;

async function main() {
  logger.info(`${workerPrefix} Starting`, { cohortId, totalCohorts });

  try {
    validateConfig();
    db.initDatabase();

    const crashData = db.readCrashAttribution(cohortId);
    if (crashData) {
      logger.warn(`${workerPrefix} Crash attribution from previous run`, {
        deviceId: crashData.deviceId,
        deviceName: crashData.deviceName,
        crashTime: crashData.timestamp
      });
      await db.markCrashCulprit(crashData.deviceId);
    }

    const deviceCount = await connectionPool.initializeForCohort(cohortId, totalCohorts);

    if (deviceCount === 0) {
      logger.info(`${workerPrefix} No devices in cohort ${cohortId}`);
    }

    batchWriter.start();

    if (deviceCount > 0) {
      await connectionPool.connectAll();
    }

    pollingScheduler.startForWorker();

    backfillService.start();

    logger.info(`${workerPrefix} Started successfully`, {
      cohortId,
      devices: deviceCount,
    });

    if (process.send) {
      process.send({ type: 'ready', cohortId, devices: deviceCount });
    }

    setInterval(async () => {
      try {
        await connectionPool.checkForNewDevicesInCohort(cohortId, totalCohorts);
      } catch (err) {
        logger.error(`${workerPrefix} Failed to check for new devices`, { error: err.message });
      }
    }, 5 * 60 * 1000);

    setInterval(async () => {
      try {
        await connectionPool.recoverUnstableDevices();
      } catch (err) {
        logger.error(`${workerPrefix} Failed to recover unstable devices`, { error: err.message });
      }
    }, 5 * 60 * 1000);

    setInterval(async () => {
      try {
        await connectionPool.recoverNoPowerDevices();
      } catch (err) {
        logger.error(`${workerPrefix} Failed to recover no_power devices`, { error: err.message });
      }
    }, 30 * 60 * 1000);

  } catch (err) {
    logger.error(`${workerPrefix} Failed to start`, { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${workerPrefix} Shutting down`, { signal, cohortId });

  try {
    pollingScheduler.stop();
    await backfillService.stop();
    await batchWriter.stop();
    connectionPool.disconnectAll();
    await db.closeDatabase();
    logger.info(`${workerPrefix} Shutdown complete`);
    process.exit(0);
  } catch (err) {
    logger.error(`${workerPrefix} Error during shutdown`, { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error(`${workerPrefix} Uncaught exception`, { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error(`${workerPrefix} Unhandled rejection`, { reason: String(reason) });
});

process.on('message', (msg) => {
  if (msg.type === 'shutdown') {
    shutdown('supervisor');
  }
});

main();
