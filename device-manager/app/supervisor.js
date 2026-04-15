/**
 * Device Manager Supervisor
 * 
 * Forks one worker process per cohort. Each worker loads its own copy of the
 * native C++ library, so a crash in one worker only affects that cohort's devices.
 * The supervisor monitors workers and respawns them on crash.
 * 
 * Shared services (SIM polling, InHand GPS, metrics) run in the supervisor process.
 */

const { fork } = require('child_process');
const path = require('path');
const { config, validateConfig } = require('./config');
const logger = require('./logger');
const db = require('./database');
const { startMetricsServer, stopMetricsServer } = require('./metrics');
const { simPoller } = require('./sim-poller');
const { inhandPoller } = require('./inhand-poller');
const { simSync } = require('./sim-sync');

class Supervisor {
  constructor() {
    this.workers = new Map();
    this.pendingRestarts = new Map();
    this.isShuttingDown = false;
    this.restartCounts = new Map();
    this.restartTimestamps = new Map();
  }

  async start() {
    logger.info('========================================');
    logger.info('Device Manager Supervisor starting');
    logger.info('========================================');

    validateConfig();
    db.initDatabase();
    logger.info('Supervisor: Database initialized');

    await db.startupRecoverySweep();

    const totalCohorts = config.polling.cohortCount;
    const devices = await db.getActiveDevicesWithCredentials();
    logger.info(`Supervisor: ${devices.length} active devices across ${totalCohorts} cohorts`);

    const cohortDeviceCounts = new Map();
    for (const device of devices) {
      const cId = this._hashToCohort(device.serial_number, totalCohorts);
      cohortDeviceCounts.set(cId, (cohortDeviceCounts.get(cId) || 0) + 1);
    }

    for (let i = 0; i < totalCohorts; i++) {
      this.forkWorker(i);
      const count = cohortDeviceCounts.get(i) || 0;
      if (count === 0) {
        logger.info(`Supervisor: Cohort ${i} has no active devices (will handle recovery)`);
      }
    }

    startMetricsServer();
    simPoller.start();
    inhandPoller.start();
    simSync.start();

    setInterval(() => this._checkForNewCohorts(), 5 * 60 * 1000);
    setInterval(() => this._logSkippedDevices(), 60 * 1000);

    logger.info('Supervisor: All services started', {
      workers: this.workers.size,
      totalCohorts,
      totalDevices: devices.length,
    });
  }

  forkWorker(cohortId) {
    if (this.isShuttingDown) return;

    if (this.workers.has(cohortId)) {
      logger.warn(`Supervisor: Worker for cohort ${cohortId} already running, skipping fork`);
      return;
    }

    const pendingTimer = this.pendingRestarts.get(cohortId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.pendingRestarts.delete(cohortId);
    }

    const workerPath = path.join(__dirname, 'worker.js');
    const env = { ...process.env, WORKER_COHORT_ID: String(cohortId) };
    const worker = fork(workerPath, [], { env, stdio: 'inherit' });

    this.workers.set(cohortId, {
      process: worker,
      pid: worker.pid,
      cohortId,
      startedAt: new Date(),
      ready: false,
    });

    logger.info(`Supervisor: Forked worker for cohort ${cohortId}`, { pid: worker.pid });

    worker.on('message', (msg) => {
      if (msg.type === 'ready') {
        const w = this.workers.get(cohortId);
        if (w) w.ready = true;
        logger.info(`Supervisor: Worker cohort ${cohortId} ready`, { 
          pid: worker.pid, 
          devices: msg.devices 
        });
      }
    });

    worker.on('exit', (code, signal) => {
      if (this.isShuttingDown) return;

      const exitReason = signal ? `signal ${signal}` : `code ${code}`;
      logger.error(`Supervisor: Worker cohort ${cohortId} exited (${exitReason})`, {
        pid: worker.pid,
        cohortId,
      });

      this.workers.delete(cohortId);

      const delay = this._getRestartDelay(cohortId);
      logger.info(`Supervisor: Respawning worker cohort ${cohortId} in ${delay}ms`);

      const timer = setTimeout(() => {
        this.pendingRestarts.delete(cohortId);
        if (!this.isShuttingDown) {
          this.forkWorker(cohortId);
        }
      }, delay);
      this.pendingRestarts.set(cohortId, timer);
    });

    worker.on('error', (err) => {
      logger.error(`Supervisor: Worker cohort ${cohortId} error`, { error: err.message });
    });
  }

  _getRestartDelay(cohortId) {
    const now = Date.now();
    const count = this.restartCounts.get(cohortId) || 0;
    const lastRestart = this.restartTimestamps.get(cohortId) || 0;

    if (now - lastRestart > 10 * 60 * 1000) {
      this.restartCounts.set(cohortId, 1);
    } else {
      this.restartCounts.set(cohortId, count + 1);
    }
    this.restartTimestamps.set(cohortId, now);

    const currentCount = this.restartCounts.get(cohortId);
    const delay = Math.min(3000 * Math.pow(2, currentCount - 1), 60000);
    return delay;
  }

  _hashToCohort(serialNumber, totalCohorts) {
    let hash = 0;
    for (let i = 0; i < serialNumber.length; i++) {
      hash = ((hash << 5) - hash) + serialNumber.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % totalCohorts;
  }

  async _logSkippedDevices() {
    const NO_POWER_QUARANTINE_MINUTES = 30;
    try {
      const result = await db.query(`
        SELECT d.serial_number, d.device_name, d.connection_status, d.consecutive_disconnects,
          d.marked_unstable_at,
          EXTRACT(EPOCH FROM (NOW() - d.marked_unstable_at)) / 60 as minutes_quarantined
        FROM power_mon_devices d
        INNER JOIN device_credentials c ON c.device_id = d.id AND c.is_active = true
        WHERE d.connection_status IN ('unstable', 'offline', 'no_power')
      `);

      if (result.rows.length === 0) return;

      const red = '\x1b[31m';
      const dim = '\x1b[2m';
      const rst = '\x1b[0m';
      console.log(`Skipping ${result.rows.length} offline/unstable devices:`);
      for (const d of result.rows) {
        const status = `[${d.connection_status}]`.padEnd(12);
        const name = (d.device_name || d.serial_number).padEnd(41);
        let ttlInfo = '';
        if (d.connection_status === 'no_power' && d.minutes_quarantined != null) {
          const minutesRemaining = Math.max(0, Math.round(NO_POWER_QUARANTINE_MINUTES - d.minutes_quarantined));
          ttlInfo = minutesRemaining > 0
            ? ` (retry in ${minutesRemaining}m)`
            : ' (retry on next check)';
        }
        console.log(`                  ${red}${status}${rst}${dim}${name}(${d.consecutive_disconnects} disconnects)${ttlInfo}${rst}`);
      }
    } catch (err) {
      logger.error('Supervisor: Failed to log skipped devices', { error: err.message });
    }
  }

  async _checkForNewCohorts() {
    try {
      const devices = await db.getActiveDevicesWithCredentials();
      const totalCohorts = config.polling.cohortCount;
      const activeCohorts = new Set();

      for (const device of devices) {
        activeCohorts.add(this._hashToCohort(device.serial_number, totalCohorts));
      }

      for (const cohortId of activeCohorts) {
        if (!this.workers.has(cohortId)) {
          logger.info(`Supervisor: New devices found in cohort ${cohortId}, forking worker`);
          this.forkWorker(cohortId);
        }
      }
    } catch (err) {
      logger.error('Supervisor: Failed to check for new cohorts', { error: err.message });
    }
  }

  async shutdown(signal) {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info('Supervisor: Shutting down', { signal, workers: this.workers.size });

    for (const timer of this.pendingRestarts.values()) {
      clearTimeout(timer);
    }
    this.pendingRestarts.clear();

    simPoller.stop();
    inhandPoller.stop();
    simSync.stop();

    const shutdownPromises = [];
    for (const [cohortId, workerInfo] of this.workers) {
      shutdownPromises.push(new Promise((resolve) => {
        const timeout = setTimeout(() => {
          logger.warn(`Supervisor: Worker cohort ${cohortId} did not exit in time, killing`);
          workerInfo.process.kill('SIGKILL');
          resolve();
        }, 10000);

        workerInfo.process.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });

        try {
          workerInfo.process.send({ type: 'shutdown' });
        } catch {
          workerInfo.process.kill('SIGTERM');
        }
      }));
    }

    await Promise.all(shutdownPromises);
    logger.info('Supervisor: All workers stopped');

    await stopMetricsServer();
    await db.closeDatabase();

    logger.info('Supervisor: Shutdown complete');
    process.exit(0);
  }

  getStatus() {
    const workers = [];
    for (const [cohortId, info] of this.workers) {
      workers.push({
        cohortId,
        pid: info.pid,
        ready: info.ready,
        uptime: Date.now() - info.startedAt.getTime(),
      });
    }
    return { workers, isShuttingDown: this.isShuttingDown };
  }
}

const supervisor = new Supervisor();

async function main() {
  try {
    await supervisor.start();
  } catch (err) {
    logger.error('Supervisor: Failed to start', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

process.on('SIGTERM', () => supervisor.shutdown('SIGTERM'));
process.on('SIGINT', () => supervisor.shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Supervisor: Uncaught exception', { error: err.message, stack: err.stack });
  supervisor.shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error('Supervisor: Unhandled rejection', { reason: String(reason) });
});

main();

module.exports = { supervisor };
