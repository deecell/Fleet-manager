/**
 * Device Manager Supervisor
 * 
 * Forks one worker process per cohort. Each worker loads its own copy of the
 * native C++ library, so a crash in one worker only affects that cohort's devices.
 * The supervisor monitors workers and respawns them on crash.
 * 
 * No_power recovery is handled by solo "probe" workers — one process per device.
 * If the probe crashes, only that one device is affected. Healthy devices in
 * shared cohort workers are never impacted by a bad device's recovery attempt.
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

const NO_POWER_QUARANTINE_MS = 5 * 60 * 1000;
const PROBE_BACKOFF_MINUTES = [5, 15, 60, 240];

class Supervisor {
  constructor() {
    this.workers = new Map();
    this.pendingRestarts = new Map();
    this.isShuttingDown = false;
    this.restartCounts = new Map();
    this.restartTimestamps = new Map();

    this.probeWorkers = new Map();
    this.probeBackoff = new Map();
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
    setInterval(() => this._probeNoPowerDevices(), 60 * 1000);

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

  forkProbeWorker(serial, deviceName) {
    if (this.isShuttingDown) return;
    if (this.probeWorkers.has(serial)) return;

    const workerPath = path.join(__dirname, 'worker.js');
    const env = { ...process.env, WORKER_SOLO_SERIAL: serial };
    const worker = fork(workerPath, [], { env, stdio: 'inherit' });

    this.probeWorkers.set(serial, {
      process: worker,
      pid: worker.pid,
      serial,
      deviceName,
      startedAt: new Date(),
    });

    const green = '\x1b[32m';
    const dim = '\x1b[2m';
    const rst = '\x1b[0m';
    const ts = new Date().toISOString().slice(11, 19);
    const backoff = this.probeBackoff.get(serial);
    const attempt = backoff ? backoff.failures + 1 : 1;
    console.log(`${dim}${ts}${rst} ${green}PROBE${rst} Spawned solo probe for ${deviceName || serial} (attempt #${attempt}, pid ${worker.pid})`);

    worker.on('message', (msg) => {
      if (msg.type === 'probe-success') {
        const sts = new Date().toISOString().slice(11, 19);
        console.log(`${dim}${sts}${rst} ${green}PROBE${rst} \x1b[1m${deviceName || serial} RECOVERED\x1b[0m — will rejoin shared worker on next check`);
        this.probeBackoff.delete(serial);
      }
    });

    worker.on('exit', async (code, signal) => {
      this.probeWorkers.delete(serial);

      if (this.isShuttingDown) return;

      if (code === 0) {
        logger.info(`Supervisor: Probe recovered ${deviceName || serial}`);
        try {
          await db.query(
            `UPDATE power_mon_devices SET connection_status = NULL, marked_unstable_at = NULL, updated_at = NOW() WHERE serial_number = $1 AND connection_status = 'probing'`,
            [serial]
          );
        } catch (e) {
          logger.error(`Supervisor: Failed to clear probing status for ${serial}`, { error: e.message });
        }
      } else {
        try {
          await db.query(
            `UPDATE power_mon_devices SET connection_status = 'no_power', updated_at = NOW() WHERE serial_number = $1 AND connection_status = 'probing'`,
            [serial]
          );
        } catch (e) {
          logger.error(`Supervisor: Failed to reset probing status for ${serial}`, { error: e.message });
        }

        const backoff = this.probeBackoff.get(serial) || { failures: 0 };
        backoff.failures++;
        const backoffIdx = Math.min(backoff.failures - 1, PROBE_BACKOFF_MINUTES.length - 1);
        const nextRetryMinutes = PROBE_BACKOFF_MINUTES[backoffIdx];
        backoff.nextProbeAfter = Date.now() + nextRetryMinutes * 60 * 1000;
        this.probeBackoff.set(serial, backoff);

        const yellow = '\x1b[33m';
        const sts = new Date().toISOString().slice(11, 19);
        console.log(`${dim}${sts}${rst} ${yellow}PROBE${rst} ${deviceName || serial} still offline (attempt #${backoff.failures}, next retry in ${nextRetryMinutes}m)`);
      }
    });

    worker.on('error', (err) => {
      logger.error(`Supervisor: Probe worker error for ${serial}`, { error: err.message });
    });
  }

  async _probeNoPowerDevices() {
    if (this.isShuttingDown) return;

    try {
      const devices = await db.getNoPowerDevicesReadyForRecovery(NO_POWER_QUARANTINE_MS);
      if (devices.length === 0) return;

      for (const device of devices) {
        const serial = device.serial_number;

        if (this.probeWorkers.has(serial)) continue;

        const backoff = this.probeBackoff.get(serial);
        if (backoff && Date.now() < backoff.nextProbeAfter) continue;

        this.forkProbeWorker(serial, device.device_name);
      }
    } catch (err) {
      logger.error('Supervisor: Failed to probe no_power devices', { error: err.message });
    }
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
    const NO_POWER_QUARANTINE_MINUTES = 5;
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
          const backoff = this.probeBackoff.get(d.serial_number);
          if (backoff && Date.now() < backoff.nextProbeAfter) {
            const minutesRemaining = Math.round((backoff.nextProbeAfter - Date.now()) / 60000);
            ttlInfo = ` (probe #${backoff.failures} failed, retry in ${minutesRemaining}m)`;
          } else {
            const minutesRemaining = Math.max(0, Math.round(NO_POWER_QUARANTINE_MINUTES - d.minutes_quarantined));
            ttlInfo = minutesRemaining > 0
              ? ` (retry in ${minutesRemaining}m)`
              : this.probeWorkers.has(d.serial_number)
                ? ' (probe running)'
                : ' (probe on next check)';
          }
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

    logger.info('Supervisor: Shutting down', { signal, workers: this.workers.size, probes: this.probeWorkers.size });

    for (const timer of this.pendingRestarts.values()) {
      clearTimeout(timer);
    }
    this.pendingRestarts.clear();

    simPoller.stop();
    inhandPoller.stop();
    simSync.stop();

    const allWorkers = [
      ...Array.from(this.workers.entries()).map(([id, info]) => ({ id: `cohort-${id}`, info })),
      ...Array.from(this.probeWorkers.entries()).map(([serial, info]) => ({ id: `probe-${serial}`, info })),
    ];

    const shutdownPromises = [];
    for (const { id, info } of allWorkers) {
      shutdownPromises.push(new Promise((resolve) => {
        const timeout = setTimeout(() => {
          logger.warn(`Supervisor: Worker ${id} did not exit in time, killing`);
          info.process.kill('SIGKILL');
          resolve();
        }, 10000);

        info.process.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });

        try {
          info.process.send({ type: 'shutdown' });
        } catch {
          info.process.kill('SIGTERM');
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
    const probes = [];
    for (const [serial, info] of this.probeWorkers) {
      probes.push({
        serial,
        deviceName: info.deviceName,
        pid: info.pid,
        uptime: Date.now() - info.startedAt.getTime(),
      });
    }
    return { workers, probes, isShuttingDown: this.isShuttingDown };
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
