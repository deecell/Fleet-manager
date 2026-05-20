/**
 * Device Manager Worker Process
 * 
 * Each worker manages a single cohort of devices with its own native library instance.
 * If one device corrupts the native library, only this worker crashes — the supervisor
 * respawns it while other workers keep running.
 * 
 * Modes:
 *   Cohort mode (WORKER_COHORT_ID): Manages all devices in a hash-based cohort.
 *   Solo probe mode (WORKER_SOLO_SERIAL): Tests one flapping device in isolation.
 *     Connects, polls for 30 seconds, exits 0 on success. If circuit breaker fires,
 *     only this process dies — no other devices affected.
 * 
 * Started by supervisor.js via child_process.fork().
 */

const { config, validateConfig } = require('./config');
const logger = require('./logger');
const db = require('./database');
const { connectionPool } = require('./connection-pool');
const { pollingScheduler } = require('./polling-scheduler');
const batchWriter = require('./batch-writer');
const { backfillService } = require('./backfill-service');

const soloSerial = process.env.WORKER_SOLO_SERIAL;
const cohortId = soloSerial ? null : parseInt(process.env.WORKER_COHORT_ID, 10);
const totalCohorts = config.polling.cohortCount;

if (!soloSerial && isNaN(cohortId)) {
  console.error('WORKER_COHORT_ID or WORKER_SOLO_SERIAL environment variable is required');
  process.exit(1);
}

let isShuttingDown = false;

async function runProbe() {
  const probePrefix = `[probe:${soloSerial}]`;
  logger.info(`${probePrefix} Starting solo probe`);

  try {
    validateConfig();
    db.initDatabase();

    const deviceCount = await connectionPool.initializeForSoloDevice(soloSerial);
    if (deviceCount === 0) {
      logger.error(`${probePrefix} Device not found or not in flapping state`);
      process.exit(1);
    }

    batchWriter.start();
    await connectionPool.connectAll();
    pollingScheduler.startForWorker();

    logger.info(`${probePrefix} Connected, monitoring for 30 seconds`);

    if (process.send) {
      process.send({ type: 'ready', serial: soloSerial, devices: 1 });
    }

    let checkCount = 0;
    const probeCheck = setInterval(async () => {
      checkCount++;
      if (connectionPool.hasAnySuccessfulPoll()) {
        clearInterval(probeCheck);
        logger.info(`${probePrefix} Probe successful - device polled successfully`);
        if (process.send) {
          process.send({ type: 'probe-success', serial: soloSerial });
        }
        try {
          pollingScheduler.stop();
          await batchWriter.stop();
          connectionPool.disconnectAll();
          await db.closeDatabase();
        } catch (e) {
          logger.warn(`${probePrefix} Cleanup error`, { error: e.message });
        }
        process.exit(0);
      }

      if (checkCount >= 6) {
        clearInterval(probeCheck);
        logger.warn(`${probePrefix} Probe timed out - no successful poll in 30s`);
        try {
          await db.markDeviceUnstable(
            Array.from(connectionPool.connections.keys())[0],
            'flapping'
          );
          pollingScheduler.stop();
          await batchWriter.stop();
          connectionPool.disconnectAll();
          await db.closeDatabase();
        } catch (e) {
          logger.warn(`${probePrefix} Cleanup error`, { error: e.message });
        }
        process.exit(1);
      }
    }, 5000);

  } catch (err) {
    logger.error(`${probePrefix} Probe failed`, { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

async function main() {
  const workerPrefix = `[worker:${cohortId}]`;
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

    // Re-arm devices that exhausted their reconnect budget (e.g. router was
    // unplugged for >30 s and burned through all 5 backoff attempts). Without
    // this loop those devices sit dead until the worker process is restarted.
    setInterval(async () => {
      try {
        await connectionPool.recoverDisconnectedDevices();
      } catch (err) {
        logger.error(`${workerPrefix} Failed to recover disconnected devices`, { error: err.message });
      }
    }, 5 * 60 * 1000);

  } catch (err) {
    logger.error(`${workerPrefix} Failed to start`, { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const prefix = soloSerial ? `[probe:${soloSerial}]` : `[worker:${cohortId}]`;
  logger.info(`${prefix} Shutting down`, { signal });

  try {
    pollingScheduler.stop();
    await backfillService.stop();
    await batchWriter.stop();
    connectionPool.disconnectAll();
    await db.closeDatabase();
    logger.info(`${prefix} Shutdown complete`);
    process.exit(0);
  } catch (err) {
    logger.error(`${prefix} Error during shutdown`, { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  const prefix = soloSerial ? `[probe:${soloSerial}]` : `[worker:${cohortId}]`;
  logger.error(`${prefix} Uncaught exception`, { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  const prefix = soloSerial ? `[probe:${soloSerial}]` : `[worker:${cohortId}]`;
  logger.error(`${prefix} Unhandled rejection`, { reason: String(reason) });
});

process.on('message', (msg) => {
  if (msg.type === 'shutdown') {
    shutdown('supervisor');
  }
});

if (soloSerial) {
  runProbe();
} else {
  main();
}
